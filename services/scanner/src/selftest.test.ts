import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { Readiness } from "#clamav"
import { loadConfig } from "#config"
import type { ScannerConfig } from "#config"
import { createLogger } from "#log"
import { createScannerServer } from "#server"
import type { Admission, ServerContext } from "#server"
import { runScanPipeline } from "#scan-runner"
import type { PipelineDeps, PipelineReport, ScanJob } from "#scan-runner"
import {
  SELFTEST_DEADLINE_MS,
  SELFTEST_MAX_BYTES,
  createSelftestJob,
  createSelftestLock,
  timeoutResult,
  toSelftestResult,
  validateSelftestRequest,
} from "#selftest"
import type { SelftestRunner } from "#selftest"

const SHARED_SECRET = `shared-${"a".repeat(40)}`
const CALLBACK_SECRET = `callback-${"b".repeat(40)}`
const CALLBACK_ORIGIN = "https://app.affilova.test"
const DOWNLOAD_URL = "https://bucket.r2.cloudflarestorage.com/selftest/abc/hello.txt"

const READY: Readiness = { ready: true, clamd: true, signatureAgeHours: 3 }

function config(): ScannerConfig {
  return loadConfig({
    SCANNER_SHARED_SECRET: SHARED_SECRET,
    SCANNER_CALLBACK_SECRET: CALLBACK_SECRET,
    ALLOWED_CALLBACK_ORIGINS: CALLBACK_ORIGIN,
  })
}

function validBody(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    downloadUrl: DOWNLOAD_URL,
    expectedSizeBytes: 64,
    extension: "txt",
    ...overrides,
  }
}

type RunningServer = {
  readonly baseUrl: string
  readonly logs: string[]
  readonly close: () => Promise<void>
}

const running: RunningServer[] = []
const temporary: string[] = []

afterEach(async () => {
  while (running.length > 0) {
    const server = running.pop()

    if (server !== undefined) {
      await server.close()
    }
  }

  while (temporary.length > 0) {
    const directory = temporary.pop()

    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

async function workDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "scanner-selftest-"))
  temporary.push(directory)

  return directory
}

function pipeline(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    workDir: "/tmp/scanner-selftest-unused",
    maxFileBytes: SELFTEST_MAX_BYTES,
    fetch: async () => {
      throw new Error("not used")
    },
    download: async () => {
      throw new Error("not used")
    },
    runCommand: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
    scanFile: async () => ({ kind: "clean" }),
    readClamavInfo: async () => ({ engine: "1.4.6", signatureVersion: "28186" }),
    now: () => 0,
    log: createLogger(() => undefined),
    ...overrides,
  }
}

function report(overrides: Partial<PipelineReport["payload"]> = {}): PipelineReport {
  return {
    payload: {
      scanId: "6af469de-05d7-4ae1-9d69-b68600000001",
      fileId: "6af469de-05d7-4ae1-9d69-b68600000002",
      verdict: "clean",
      detail: "clean",
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      detectedMime: "text/plain",
      engine: "clamav",
      signatureVersion: "28186",
      scannedAt: "2026-11-18T05:00:00.000Z",
      ...overrides,
    },
    stages: { download: 1 },
    durationMs: 12,
  }
}

async function start(
  options: {
    readonly selftestRun?: SelftestRunner
    readonly pipeline?: PipelineDeps
    readonly deadlineMs?: number
  } = {},
): Promise<RunningServer> {
  const logs: string[] = []

  const context: ServerContext = {
    config: config(),
    admission: (): Admission => ({ accepted: true }),
    readiness: async (): Promise<Readiness> => READY,
    log: createLogger((line: string) => {
      logs.push(line)
    }),
    selftest: {
      pipeline: options.pipeline ?? pipeline(),
      run: options.selftestRun ?? (async (): Promise<PipelineReport> => report()),
      lock: createSelftestLock(),
      deadlineMs: options.deadlineMs,
    },
  }

  const server = createScannerServer(context)

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve()
    })
  })

  const address = server.address()

  if (address === null || typeof address === "string") {
    throw new Error("the test server did not bind to a TCP port")
  }

  const result: RunningServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        // A test may leave a handler waiting on purpose; closing the sockets
        // keeps that from stalling the hook.
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }

  running.push(result)

  return result
}

function authorized(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { authorization: `Bearer ${SHARED_SECRET}`, "content-type": "application/json", ...extra }
}

async function postSelftest(
  server: RunningServer,
  body: unknown,
  headers: Readonly<Record<string, string>> = authorized(),
): Promise<Response> {
  return fetch(`${server.baseUrl}/selftest`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

type RawResponse = {
  readonly status: number
  readonly body: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

/**
 * Posts over a fresh socket (`agent: false`). Two of these are genuinely in
 * flight at once, which is what the single-flight check is about: `fetch` may
 * reuse one connection and serialise them.
 */
function rawPost(server: RunningServer, body: unknown): Promise<RawResponse> {
  const payload = JSON.stringify(body)
  const url = new URL("/selftest", server.baseUrl)

  return new Promise<RawResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        agent: false,
        headers: {
          authorization: `Bearer ${SHARED_SECRET}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks: Buffer[] = []

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })

        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          })
        })
      },
    )

    request.on("error", reject)
    request.end(payload)
  })
}

describe("POST /selftest authentication", () => {
  it("answers 401 without an authorization header", async () => {
    const server = await start()
    const response = await fetch(`${server.baseUrl}/selftest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("answers 401 with the wrong secret and no detail", async () => {
    const server = await start()
    const response = await postSelftest(server, validBody(), authorized({ authorization: "Bearer wrong" }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("checks the secret before reading the body", async () => {
    const server = await start()
    const oversized = JSON.stringify(validBody({ padding: "x".repeat(9_000) }))
    const response = await postSelftest(server, oversized, { authorization: "Bearer wrong" })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("never logs the secret or the download URL", async () => {
    const server = await start()
    await postSelftest(server, validBody(), authorized({ authorization: "Bearer wrong" }))
    await postSelftest(server, validBody())

    const lines = server.logs.join("")

    expect(lines).not.toContain("wrong")
    expect(lines).not.toContain(DOWNLOAD_URL)
    expect(lines).not.toContain("r2.cloudflarestorage.com")
  })
})

describe("POST /selftest validation", () => {
  it("answers 400 for a body that is not JSON", async () => {
    const server = await start()
    const response = await postSelftest(server, "{")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_json" })
  })

  it("answers 400 for an array body", async () => {
    const server = await start()
    const response = await postSelftest(server, [validBody()])

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_request", field: "body" })
  })

  it.each([
    ["downloadUrl", { downloadUrl: "http://bucket.r2.cloudflarestorage.com/f.txt" }],
    ["downloadUrl", { downloadUrl: "https://evil.test/f.txt" }],
    ["downloadUrl", { downloadUrl: "https://a.r2.cloudflarestorage.com@evil.test/f.txt" }],
    ["downloadUrl", { downloadUrl: "https://2130706433/f.txt" }],
    ["downloadUrl", { downloadUrl: "https://bucket.r2.cloudflarestorage.com:8443/f.txt" }],
    ["downloadUrl", { downloadUrl: 42 }],
    ["expectedSizeBytes", { expectedSizeBytes: 0 }],
    ["expectedSizeBytes", { expectedSizeBytes: -1 }],
    ["expectedSizeBytes", { expectedSizeBytes: 1.5 }],
    ["expectedSizeBytes", { expectedSizeBytes: SELFTEST_MAX_BYTES + 1 }],
    ["expectedSizeBytes", { expectedSizeBytes: "64" }],
    ["extension", { extension: "exe" }],
    ["extension", { extension: "TXT" }],
    ["extension", { extension: ".txt" }],
  ])("answers 400 for an invalid %s", async (field, overrides) => {
    const server = await start()
    const response = await postSelftest(server, validBody(overrides))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_request", field })
  })

  it("answers 413 for a body over 8 KB", async () => {
    const server = await start()
    const response = await postSelftest(server, JSON.stringify(validBody({ padding: "x".repeat(9_000) })))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "payload_too_large" })
  })

  it("accepts the largest allowed size", async () => {
    const server = await start()
    const response = await postSelftest(server, validBody({ expectedSizeBytes: SELFTEST_MAX_BYTES }))

    expect(response.status).toBe(200)
  })

  it("accepts the smallest allowed size", async () => {
    const server = await start()
    const response = await postSelftest(server, validBody({ expectedSizeBytes: 1 }))

    expect(response.status).toBe(200)
  })
})

describe("POST /selftest answer", () => {
  it("answers 200 with the documented body", async () => {
    const server = await start()
    const response = await postSelftest(server, validBody())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      verdict: "clean",
      detail: "clean",
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      detectedMime: "text/plain",
      engine: "clamav",
      signatureVersion: "28186",
      durationMs: 12,
    })
  })

  it("passes the validated fields to the runner", async () => {
    const jobs: ScanJob[] = []
    const server = await start({
      selftestRun: async (job: ScanJob): Promise<PipelineReport> => {
        jobs.push(job)

        return report()
      },
    })

    await postSelftest(server, validBody({ extension: "pdf", expectedSizeBytes: 900 }))

    expect(jobs).toHaveLength(1)
    expect(jobs[0].downloadUrl).toBe(DOWNLOAD_URL)
    expect(jobs[0].expectedSizeBytes).toBe(900)
    expect(jobs[0].extension).toBe("pdf")
  })

  it("gives the runner the pipeline deps it was configured with", async () => {
    const configured = pipeline()
    let received: PipelineDeps | null = null

    const server = await start({
      pipeline: configured,
      selftestRun: async (_job: ScanJob, deps: PipelineDeps): Promise<PipelineReport> => {
        received = deps

        return report()
      },
    })

    await postSelftest(server, validBody())

    expect(received).toBe(configured)
  })

  it("reports an infected verdict as a 200, not an error status", async () => {
    const server = await start({
      selftestRun: async (): Promise<PipelineReport> =>
        report({ verdict: "infected", detail: "Eicar-Test-Signature" }),
    })

    const response = await postSelftest(server, validBody())

    expect(response.status).toBe(200)
    expect((await response.json()).verdict).toBe("infected")
  })

  it("reports a rejected verdict with its detail code", async () => {
    const server = await start({
      selftestRun: async (): Promise<PipelineReport> =>
        report({ verdict: "rejected", detail: "executable_type" }),
    })

    const body = await (await postSelftest(server, validBody())).json()

    expect(body.verdict).toBe("rejected")
    expect(body.detail).toBe("executable_type")
  })
})

describe("POST /selftest concurrency", () => {
  it("answers 429 to a second call while one is running, then serves the next", async () => {
    let openGate: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    let started = 0

    const server = await start({
      selftestRun: async (): Promise<PipelineReport> => {
        started += 1

        await gate

        return report()
      },
    })

    const first = rawPost(server, validBody())

    // Wait until the first call is inside the runner.
    while (started === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const second = await rawPost(server, validBody())

    expect(second.status).toBe(429)
    expect(JSON.parse(second.body)).toEqual({ error: "selftest_busy" })
    expect(second.headers["retry-after"]).toBeDefined()
    expect(started).toBe(1)

    openGate()

    const finished = await first

    expect(finished.status).toBe(200)
    expect(JSON.parse(finished.body).verdict).toBe("clean")

    // The lock was released, so the next call runs.
    const third = await postSelftest(server, validBody())

    expect(third.status).toBe(200)
  })
})

describe("POST /selftest deadline", () => {
  it("answers 200 with verdict error and detail timeout when the pipeline hangs", async () => {
    const server = await start({
      deadlineMs: 30,
      selftestRun: async (): Promise<PipelineReport> =>
        new Promise<PipelineReport>(() => {
          // Never settles: the deadline must answer instead.
        }),
    })

    const response = await postSelftest(server, validBody())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.verdict).toBe("error")
    expect(body.detail).toBe("timeout")
    expect(body.sha256).toBeNull()
    expect(body.detectedMime).toBeNull()
    expect(body.engine).toBe("clamav")
    expect(typeof body.durationMs).toBe("number")
  })

  it("releases the lock after a timeout", async () => {
    const server = await start({
      deadlineMs: 20,
      selftestRun: async (): Promise<PipelineReport> =>
        new Promise<PipelineReport>(() => {
          // Never settles.
        }),
    })

    await postSelftest(server, validBody())

    const again = await postSelftest(server, validBody())

    expect(again.status).toBe(200)
    expect((await again.json()).detail).toBe("timeout")
  })

  it("defaults to a 25 second deadline", () => {
    expect(SELFTEST_DEADLINE_MS).toBe(25_000)
  })
})

describe("POST /selftest reuses the scan pipeline", () => {
  it("runs the real pipeline, including its temporary file cleanup", async () => {
    const directory = await workDir()
    const destination: string[] = []
    const removed: string[] = []

    const deps = pipeline({
      workDir: directory,
      maxFileBytes: SELFTEST_MAX_BYTES,
      download: async (options) => {
        destination.push(options.destination)
        await writeFile(options.destination, "Affilova scanner self-test", { flag: "wx" })

        return {
          sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          bytes: 28,
          detectedContentLength: 28,
        }
      },
      runCommand: async (command) => {
        if (command === "file") {
          return { code: 0, stdout: "text/plain\n", stderr: "", timedOut: false }
        }

        return { code: 0, stdout: "", stderr: "", timedOut: false }
      },
      scanFile: async () => ({ kind: "clean" }),
      removeFile: async (filePath: string) => {
        removed.push(filePath)
        await rm(filePath, { force: true })
      },
    })

    const server = await start({ pipeline: deps, selftestRun: runScanPipeline })
    const response = await postSelftest(server, validBody())

    expect(response.status).toBe(200)
    expect((await response.json()).verdict).toBe("clean")
    expect(destination).toHaveLength(1)
    expect(removed).toEqual(destination)

    // The temporary file is gone, which is the same finally block a scan uses.
    await expect(readFile(destination[0], "utf8")).rejects.toThrow()
  })

  it("cleans the temporary file up when the pipeline rejects the type", async () => {
    const directory = await workDir()
    const removed: string[] = []

    const deps = pipeline({
      workDir: directory,
      download: async (options) => {
        await writeFile(options.destination, "MZ", { flag: "wx" })

        return { sha256: "00", bytes: 2, detectedContentLength: 2 }
      },
      runCommand: async () => ({
        code: 0,
        stdout: "application/x-dosexec\n",
        stderr: "",
        timedOut: false,
      }),
      removeFile: async (filePath: string) => {
        removed.push(filePath)
        await rm(filePath, { force: true })
      },
    })

    const server = await start({ pipeline: deps, selftestRun: runScanPipeline })
    const body = await (await postSelftest(server, validBody({ extension: "pdf" }))).json()

    expect(body.verdict).toBe("rejected")
    expect(body.detail).toBe("executable_type")
    expect(removed).toHaveLength(1)
  })

  it("never writes into the work directory when the download fails", async () => {
    const directory = await workDir()

    const deps = pipeline({
      workDir: directory,
      download: async () => {
        throw new Error("storage answered 404")
      },
      removeFile: async () => undefined,
    })

    const server = await start({ pipeline: deps, selftestRun: runScanPipeline })
    const body = await (await postSelftest(server, validBody())).json()

    expect(body.verdict).toBe("error")
    expect(body.detail).toBe("download_failed")
  })
})

describe("validateSelftestRequest", () => {
  it("accepts the documented body", () => {
    expect(validateSelftestRequest(validBody(), config()).ok).toBe(true)
  })

  it("rejects null and a string body", () => {
    expect(validateSelftestRequest(null, config()).ok).toBe(false)
    expect(validateSelftestRequest("selftest", config()).ok).toBe(false)
  })

  it("normalises the download URL", () => {
    const result = validateSelftestRequest(
      validBody({ downloadUrl: "https://BUCKET.R2.CLOUDFLARESTORAGE.COM/selftest/abc/hello.txt" }),
      config(),
    )

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.request.downloadUrl).toBe(DOWNLOAD_URL)
    }
  })
})

describe("selftest helpers", () => {
  it("mints fresh identifiers per job", () => {
    const first = createSelftestJob({ downloadUrl: DOWNLOAD_URL, expectedSizeBytes: 1, extension: "txt" })
    const second = createSelftestJob({ downloadUrl: DOWNLOAD_URL, expectedSizeBytes: 1, extension: "txt" })

    expect(first.scanId).not.toBe(second.scanId)
    expect(first.scanId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.callbackUrl).toBe("")
  })

  it("maps a payload without leaking the identifiers", () => {
    const result = toSelftestResult(report().payload, 5)

    expect(Object.keys(result).sort()).toEqual([
      "detail",
      "detectedMime",
      "durationMs",
      "engine",
      "sha256",
      "signatureVersion",
      "verdict",
    ])
  })

  it("describes a timeout as an error verdict", () => {
    expect(timeoutResult(25_000)).toEqual({
      verdict: "error",
      detail: "timeout",
      sha256: null,
      detectedMime: null,
      engine: "clamav",
      signatureVersion: null,
      durationMs: 25_000,
    })
  })

  it("lets exactly one caller hold the lock", () => {
    const lock = createSelftestLock()

    expect(lock.tryAcquire()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)

    lock.release()

    expect(lock.tryAcquire()).toBe(true)
  })
})
