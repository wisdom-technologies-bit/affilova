import { afterEach, describe, expect, it } from "vitest"

import type { Readiness } from "#clamav"
import { loadConfig } from "#config"
import type { ScannerConfig } from "#config"
import { createLogger } from "#log"
import { MAX_REQUEST_BODY_BYTES, RETRY_AFTER_SECONDS, createScannerServer, validateScanRequest } from "#server"
import type { Admission, ServerContext } from "#server"
import { runScanPipeline } from "#scan-runner"
import type { PipelineDeps, PipelineReport, ScanJob } from "#scan-runner"
import { createSelftestLock } from "#selftest"
import type { SelftestRunner } from "#selftest"

const SHARED_SECRET = `shared-${"a".repeat(40)}`
const CALLBACK_SECRET = `callback-${"b".repeat(40)}`
const CALLBACK_ORIGIN = "https://app.affilova.test"

const READY: Readiness = { ready: true, clamd: true, signatureAgeHours: 3 }
const NOT_READY: Readiness = { ready: false, clamd: false, signatureAgeHours: null }

const SCAN_ID = "6af469de-05d7-4ae1-9d69-b68600000001"
const FILE_ID = "6af469de-05d7-4ae1-9d69-b68600000002"
const DOWNLOAD_URL = "https://bucket.r2.cloudflarestorage.com/vendor/file.pdf"
const CALLBACK_URL = `${CALLBACK_ORIGIN}/api/internal/scan-result`

function config(): ScannerConfig {
  return loadConfig({
    SCANNER_SHARED_SECRET: SHARED_SECRET,
    SCANNER_CALLBACK_SECRET: CALLBACK_SECRET,
    ALLOWED_CALLBACK_ORIGINS: CALLBACK_ORIGIN,
  })
}

function validBody(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    scanId: SCAN_ID,
    fileId: FILE_ID,
    downloadUrl: DOWNLOAD_URL,
    expectedSizeBytes: 1234,
    extension: "pdf",
    callbackUrl: CALLBACK_URL,
    ...overrides,
  }
}

const PIPELINE: PipelineDeps = {
  workDir: "/tmp/selftest-unused",
  maxFileBytes: 2_097_152,
  fetch: async () => {
    throw new Error("the pipeline is not reached by these tests")
  },
  download: async () => {
    throw new Error("the pipeline is not reached by these tests")
  },
  runCommand: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
  scanFile: async () => ({ kind: "clean" }),
  readClamavInfo: async () => ({ engine: "1.4.6", signatureVersion: "28186" }),
  now: () => 0,
  log: createLogger(() => undefined),
}

const NEVER_RUNS: SelftestRunner = async (): Promise<PipelineReport> => {
  throw new Error("no self-test is expected in this test")
}

type RunningServer = {
  readonly baseUrl: string
  readonly jobs: ScanJob[]
  readonly logs: string[]
  readonly close: () => Promise<void>
}

const running: RunningServer[] = []

afterEach(async () => {
  while (running.length > 0) {
    const server = running.pop()

    if (server !== undefined) {
      await server.close()
    }
  }
})

async function start(
  options: {
    readonly admission?: Admission
    readonly readiness?: Readiness
    readonly selftestRun?: SelftestRunner
  } = {},
): Promise<RunningServer> {
  const jobs: ScanJob[] = []
  const logs: string[] = []

  const context: ServerContext = {
    config: config(),
    admission: (job: ScanJob): Admission => {
      jobs.push(job)

      return options.admission ?? { accepted: true }
    },
    readiness: async (): Promise<Readiness> => options.readiness ?? READY,
    log: createLogger((line: string) => {
      logs.push(line)
    }),
    selftest: {
      pipeline: PIPELINE,
      run: options.selftestRun ?? NEVER_RUNS,
      lock: createSelftestLock(),
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
    jobs,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
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

async function postScan(
  server: RunningServer,
  body: unknown,
  headers: Readonly<Record<string, string>> = authorized(),
): Promise<Response> {
  return fetch(`${server.baseUrl}/scan`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("POST /scan", () => {
  it("accepts a valid request with 202", async () => {
    const server = await start()
    const response = await postScan(server, validBody())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true })
    expect(server.jobs).toHaveLength(1)
    expect(server.jobs[0].scanId).toBe(SCAN_ID)
    expect(server.jobs[0].expectedSizeBytes).toBe(1234)
    expect(server.jobs[0].extension).toBe("pdf")
  })

  it("answers 401 without an authorization header and queues nothing", async () => {
    const server = await start()
    const response = await fetch(`${server.baseUrl}/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
    expect(server.jobs).toHaveLength(0)
  })

  it("answers 401 with the wrong secret and gives no detail", async () => {
    const server = await start()
    const response = await postScan(server, validBody(), authorized({ authorization: "Bearer wrong" }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
    expect(server.jobs).toHaveLength(0)
  })

  it("answers 401 with no detail even when the body is also invalid", async () => {
    const server = await start()
    const response = await postScan(server, "not json", { authorization: "Bearer nope" })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("answers 400 for a body that is not JSON", async () => {
    const server = await start()
    const response = await postScan(server, "{")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_json" })
    expect(server.jobs).toHaveLength(0)
  })

  it.each([
    ["scanId", { scanId: "not-a-uuid" }],
    ["scanId", { scanId: 42 }],
    ["fileId", { fileId: "123" }],
    ["downloadUrl", { downloadUrl: "http://bucket.r2.cloudflarestorage.com/f.pdf" }],
    ["downloadUrl", { downloadUrl: "https://a.r2.cloudflarestorage.com@evil.com/f.pdf" }],
    ["downloadUrl", { downloadUrl: "https://evil.com/f.pdf" }],
    ["expectedSizeBytes", { expectedSizeBytes: 1.5 }],
    ["expectedSizeBytes", { expectedSizeBytes: -1 }],
    ["expectedSizeBytes", { expectedSizeBytes: "1234" }],
    ["extension", { extension: "exe" }],
    ["extension", { extension: "PDF" }],
    ["extension", { extension: ".pdf" }],
    ["callbackUrl", { callbackUrl: "https://evil.test/api/internal/scan-result" }],
    ["callbackUrl", { callbackUrl: `http://app.affilova.test/api/internal/scan-result` }],
    ["callbackUrl", { callbackUrl: `${CALLBACK_ORIGIN}/api/other` }],
  ])("answers 400 for an invalid %s", async (field, overrides) => {
    const server = await start()
    const response = await postScan(server, validBody(overrides))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_request", field })
    expect(server.jobs).toHaveLength(0)
  })

  it("answers 400 for an array body", async () => {
    const server = await start()
    const response = await postScan(server, [validBody()])

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_request", field: "body" })
  })

  it("answers 413 for a body over 8 KB", async () => {
    const server = await start()
    const oversized = JSON.stringify(validBody({ padding: "x".repeat(MAX_REQUEST_BODY_BYTES) }))
    const response = await postScan(server, oversized)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "payload_too_large" })
    expect(server.jobs).toHaveLength(0)
  })

  it("accepts a body just under the limit", async () => {
    const server = await start()
    const base = JSON.stringify(validBody())
    const padding = "x".repeat(MAX_REQUEST_BODY_BYTES - base.length - 16)
    const response = await postScan(server, JSON.stringify(validBody({ padding })))

    expect(response.status).toBe(202)
  })

  it("answers 429 with Retry-After when the queue is full", async () => {
    const server = await start({ admission: { accepted: false, reason: "full" } })
    const response = await postScan(server, validBody())

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: "queue_full" })
    expect(response.headers.get("retry-after")).toBe(String(RETRY_AFTER_SECONDS))
  })

  it("answers 503 while shutting down", async () => {
    const server = await start({ admission: { accepted: false, reason: "closed" } })
    const response = await postScan(server, validBody())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "shutting_down" })
  })

  it("answers 503 when ClamAV is not ready", async () => {
    const server = await start({ readiness: NOT_READY })
    const response = await postScan(server, validBody())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "not_ready" })
    expect(server.jobs).toHaveLength(0)
  })

  it("normalises the URLs it queues", async () => {
    const server = await start()
    await postScan(server, validBody({ downloadUrl: "https://BUCKET.R2.CLOUDFLARESTORAGE.COM/vendor/file.pdf" }))

    expect(server.jobs[0].downloadUrl).toBe(DOWNLOAD_URL)
  })

  it("logs nothing sensitive about a rejected request", async () => {
    const server = await start()
    await postScan(server, validBody(), authorized({ authorization: "Bearer wrong" }))

    expect(server.logs.join("")).not.toContain("wrong")
    expect(server.logs.join("")).not.toContain(DOWNLOAD_URL)
  })

  it("accepts every allowed extension", async () => {
    const server = await start()
    const extensions = [
      "pdf",
      "epub",
      "mobi",
      "zip",
      "7z",
      "rar",
      "mp4",
      "mov",
      "mp3",
      "wav",
      "m4a",
      "docx",
      "xlsx",
      "pptx",
      "txt",
      "csv",
      "png",
      "jpg",
      "jpeg",
      "psd",
      "ai",
      "eps",
      "ttf",
      "otf",
    ]

    for (const extension of extensions) {
      const response = await postScan(server, validBody({ extension }))

      expect(response.status).toBe(202)
    }

    expect(server.jobs).toHaveLength(extensions.length)
  })
})

describe("GET /healthz", () => {
  it("answers 200 with the documented shape when ready", async () => {
    const server = await start({ readiness: READY })
    const response = await fetch(`${server.baseUrl}/healthz`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, clamd: true, signatureAgeHours: 3 })
  })

  it("answers 503 with the same shape when clamd is down", async () => {
    const server = await start({ readiness: NOT_READY })
    const response = await fetch(`${server.baseUrl}/healthz`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, clamd: false, signatureAgeHours: null })
  })

  it("answers 503 when the signatures are stale but clamd is up", async () => {
    const server = await start({ readiness: { ready: false, clamd: true, signatureAgeHours: 100 } })
    const response = await fetch(`${server.baseUrl}/healthz`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, clamd: true, signatureAgeHours: 100 })
  })

  it("needs no authorization", async () => {
    const server = await start()

    expect((await fetch(`${server.baseUrl}/healthz`)).status).toBe(200)
  })
})

describe("other paths", () => {
  it.each(["/", "/scan", "/healthz/", "/api/internal/scan-result", "/scan/extra"])(
    "answers 404 for %s",
    async (path) => {
      const server = await start()
      const response = await fetch(`${server.baseUrl}${path}`)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "not_found" })
    },
  )

  it("answers 404 for a GET on /scan", async () => {
    const server = await start()
    const response = await fetch(`${server.baseUrl}/scan`)

    expect(response.status).toBe(404)
    expect(server.jobs).toHaveLength(0)
  })

  it("answers 404 for a POST on /healthz", async () => {
    const server = await start()
    const response = await fetch(`${server.baseUrl}/healthz`, { method: "POST" })

    expect(response.status).toBe(404)
  })
})

describe("validateScanRequest", () => {
  it("accepts the documented body", () => {
    const result = validateScanRequest(validBody(), config())

    expect(result.ok).toBe(true)
  })

  it("rejects a missing field", () => {
    const result = validateScanRequest({}, config())

    expect(result.ok).toBe(false)
  })

  it("rejects null", () => {
    expect(validateScanRequest(null, config()).ok).toBe(false)
  })

  it("rejects a string body", () => {
    expect(validateScanRequest("scan", config()).ok).toBe(false)
  })

  it("accepts a zero byte file", () => {
    expect(validateScanRequest(validBody({ expectedSizeBytes: 0 }), config()).ok).toBe(true)
  })

  it("accepts an uppercase uuid", () => {
    expect(validateScanRequest(validBody({ scanId: SCAN_ID.toUpperCase() }), config()).ok).toBe(true)
  })
})
