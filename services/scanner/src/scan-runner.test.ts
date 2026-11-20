import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { BOUNCER_ENGINE } from "#bouncer"
import type { BouncerOutcome } from "#bouncer"
import type { CallbackPayload } from "#callback"
import { DownloadFailure } from "#download"
import type { DownloadOptions, DownloadResult } from "#download"
import type { CommandResult } from "#exec"
import { createLogger } from "#log"
import { runScan } from "#scan-runner"
import type { CallbackDelivery, ScanJob, ScanRunnerDeps } from "#scan-runner"

/** Real `7z l -slt` shape for a plain zip. */
const PLAIN_LISTING = `7-Zip [64] 26.02

Listing archive: fixture.zip

--
Path = fixture.zip
Type = zip
Physical Size = 4096

----------
Path = a.txt
Folder = -
Size = 12
Packed Size = 14
Attributes =  -rw-r--r--
Encrypted = -
Method = Deflate
`

const ENCRYPTED_LISTING = `7-Zip [64] 26.02

----------
Path = a.txt
Folder = -
Size = 12
Packed Size = 40
Attributes =  -rw-r--r--
Encrypted = +
Method = AES-256 Store
`

const EXECUTABLE_LISTING = `7-Zip [64] 26.02

----------
Path = a.txt
Folder = -
Size = 12
Packed Size = 14
Attributes =  -rw-r--r--
Encrypted = -

Path = setup.exe
Folder = -
Size = 900
Packed Size = 800
Attributes =  -rw-r--r--
Encrypted = -
`

const TRAVERSAL_LISTING = `7-Zip [64] 26.02

----------
Path = a.txt
Folder = -
Size = 12
Packed Size = 14

Path = ../../etc/passwd
Size = 5
Packed Size = 7
`

const JOB: ScanJob = {
  scanId: "6af469de-05d7-4ae1-9d69-b68600000001",
  fileId: "6af469de-05d7-4ae1-9d69-b68600000002",
  downloadUrl: "https://bucket.r2.cloudflarestorage.com/vendor/file.pdf",
  expectedSizeBytes: 11,
  extension: "pdf",
  callbackUrl: "https://app.affilova.test/api/internal/scan-result",
}

const BODY = new TextEncoder().encode("hello world")

const created: string[] = []

afterEach(async () => {
  while (created.length > 0) {
    const directory = created.pop()

    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

type HarnessOptions = {
  readonly extension?: string
  readonly detectedMime?: string
  readonly archiveListing?: string
  readonly archiveExitCode?: number
  readonly bouncer?: BouncerOutcome
  readonly download?: (options: DownloadOptions) => Promise<DownloadResult>
  readonly downloadThrows?: boolean
  readonly callbackThrows?: boolean
  readonly detectedExitCode?: number
  readonly overallTimeoutMs?: number
}

type Harness = {
  readonly job: ScanJob
  readonly deps: ScanRunnerDeps
  readonly callbacks: CallbackPayload[]
  readonly commands: string[]
  readonly lines: string[]
  readonly workDir: string
}

function commandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return { code: 0, stdout: "", stderr: "", timedOut: false, ...overrides }
}

async function build(options: HarnessOptions = {}): Promise<Harness> {
  const workDir = await mkdtemp(join(tmpdir(), "scanner-run-"))
  created.push(workDir)

  const callbacks: CallbackPayload[] = []
  const commands: string[] = []
  const lines: string[] = []

  const job: ScanJob = {
    ...JOB,
    extension: options.extension ?? "pdf",
    expectedSizeBytes: BODY.byteLength,
  }

  const download =
    options.download ??
    (async (downloadOptions: DownloadOptions): Promise<DownloadResult> => {
      await writeFile(downloadOptions.destination, BODY, { flag: "wx" })

      return {
        sha256: createHash("sha256").update(BODY).digest("hex"),
        bytes: BODY.byteLength,
        detectedContentLength: BODY.byteLength,
      }
    })

  const deps: ScanRunnerDeps = {
    workDir,
    maxFileBytes: 1024 * 1024,
    fetch: async () => {
      throw new Error("the runner must not fetch directly")
    },
    download: async (downloadOptions: DownloadOptions): Promise<DownloadResult> => {
      if (options.downloadThrows === true) {
        throw new DownloadFailure("download_failed", "storage answered 500")
      }

      return download(downloadOptions)
    },
    runCommand: async (command: string): Promise<CommandResult> => {
      commands.push(command)

      if (command === "file") {
        return commandResult({
          code: options.detectedExitCode ?? 0,
          stdout: `${options.detectedMime ?? "application/pdf"}\n`,
        })
      }

      if (command === "7z") {
        const code = options.archiveExitCode ?? 0

        return commandResult({
          code,
          stdout: code === 0 ? (options.archiveListing ?? PLAIN_LISTING) : "",
          stderr: code === 0 ? "" : "Can not open the file as archive",
        })
      }

      return commandResult({ code: 1, stderr: `unexpected command ${command}` })
    },
    scanFile: async (): Promise<BouncerOutcome> => options.bouncer ?? { kind: "clean" },
    sendCallback: async (payload: CallbackPayload): Promise<CallbackDelivery> => {
      callbacks.push(payload)

      if (options.callbackThrows === true) {
        throw new Error("callback down")
      }

      return { delivered: true, attempts: 1 }
    },
    now: Date.now,
    log: createLogger((line: string) => {
      lines.push(line)
    }),
    overallTimeoutMs: options.overallTimeoutMs,
  }

  return { job, deps, callbacks, commands, lines, workDir }
}

async function scan(options: HarnessOptions = {}): Promise<{ harness: Harness; payload: CallbackPayload; delivered: boolean }> {
  const harness = await build(options)
  const report = await runScan(harness.job, harness.deps)

  return { harness, payload: report.payload, delivered: report.delivery.delivered }
}

async function leftovers(workDir: string): Promise<string[]> {
  return readdir(workDir)
}

describe("runScan", () => {
  it("reports a clean pdf", async () => {
    const { harness, payload, delivered } = await scan()

    expect(payload.verdict).toBe("clean")
    expect(payload.detail).toBe("clean")
    expect(payload.sha256).toBe(createHash("sha256").update(BODY).digest("hex"))
    expect(payload.detectedMime).toBe("application/pdf")
    expect(payload.engine).toBe(BOUNCER_ENGINE)
    expect(payload.signatureVersion).toBeNull()
    expect(payload.scanId).toBe(JOB.scanId)
    expect(payload.fileId).toBe(JOB.fileId)
    expect(payload.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(delivered).toBe(true)
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("sends exactly one result on the callback", async () => {
    const { harness } = await scan()

    expect(harness.callbacks).toHaveLength(1)
    expect(harness.callbacks[0].verdict).toBe("clean")
  })

  it("logs the identifiers, the verdict and durations only", async () => {
    const { harness } = await scan()

    expect(harness.lines).toHaveLength(1)

    const parsed = JSON.parse(harness.lines[0]) as Record<string, unknown>

    expect(parsed.scanId).toBe(JOB.scanId)
    expect(parsed.fileId).toBe(JOB.fileId)
    expect(parsed.verdict).toBe("clean")
    expect(typeof parsed.durationMs).toBe("number")
    expect(harness.lines[0]).not.toContain("cloudflarestorage")
    expect(harness.lines[0]).not.toContain("vendor")
    expect(harness.lines[0]).not.toContain(harness.workDir)
  })

  it("reports an infection with the threat name Bouncer returned", async () => {
    const { harness, payload } = await scan({
      bouncer: { kind: "infected", detail: "Eicar-Test-Signature" },
    })

    expect(payload.verdict).toBe("infected")
    expect(payload.detail).toBe("Eicar-Test-Signature")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("rejects a size mismatch from the download", async () => {
    const { harness, payload } = await scan({
      download: async () => {
        throw new DownloadFailure("size_mismatch", "downloaded size differs")
      },
    })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("size_mismatch")
    expect(payload.sha256).toBeNull()
    expect(harness.commands).toEqual([])
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("rejects a text file renamed as a zip", async () => {
    const { harness, payload } = await scan({ extension: "zip", detectedMime: "text/plain" })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("type_mismatch")
    expect(payload.detectedMime).toBe("text/plain")
    expect(harness.commands).not.toContain("7z")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("rejects an executable renamed as a pdf", async () => {
    const { harness, payload } = await scan({ detectedMime: "application/x-dosexec" })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("executable_type")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("rejects a shell script renamed as csv", async () => {
    const { payload } = await scan({ extension: "csv", detectedMime: "text/x-shellscript" })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("executable_type")
  })

  it("rejects an encrypted archive before Bouncer runs", async () => {
    const { harness, payload } = await scan({
      extension: "zip",
      detectedMime: "application/zip",
      archiveListing: ENCRYPTED_LISTING,
    })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("encrypted_archive")
    expect(harness.commands).toEqual(["file", "7z"])
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("rejects an archive with a traversal entry", async () => {
    const { payload } = await scan({
      extension: "zip",
      detectedMime: "application/zip",
      archiveListing: TRAVERSAL_LISTING,
    })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("path_traversal")
  })

  it("sends an archive containing an executable for review", async () => {
    const { harness, payload } = await scan({
      extension: "zip",
      detectedMime: "application/zip",
      archiveListing: EXECUTABLE_LISTING,
    })

    expect(payload.verdict).toBe("needs_review")
    expect(payload.detail).toBe("archive_contains_executable")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("sends an unlistable rar for review", async () => {
    const { harness, payload } = await scan({
      extension: "rar",
      detectedMime: "application/vnd.rar",
      archiveExitCode: 2,
    })

    expect(payload.verdict).toBe("needs_review")
    expect(payload.detail).toBe("archive_unlistable")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("sends an unparseable listing for review", async () => {
    const { payload } = await scan({
      extension: "7z",
      detectedMime: "application/x-7z-compressed",
      archiveListing: "not a listing at all",
    })

    expect(payload.verdict).toBe("needs_review")
    expect(payload.detail).toBe("archive_unlistable")
  })

  it("accepts a clean archive after listing it", async () => {
    const { harness, payload } = await scan({ extension: "zip", detectedMime: "application/zip" })

    expect(payload.verdict).toBe("clean")
    expect(harness.commands).toEqual(["file", "7z"])
  })

  it("checks the openxml formats as archives", async () => {
    const { harness } = await scan({
      extension: "docx",
      detectedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })

    expect(harness.commands).toEqual(["file", "7z"])
  })

  it("does not run the archive policy on a pdf", async () => {
    const { harness } = await scan()

    expect(harness.commands).toEqual(["file"])
  })

  it("reports a download failure as an error", async () => {
    const { harness, payload } = await scan({ downloadThrows: true })

    expect(payload.verdict).toBe("error")
    expect(payload.detail).toBe("download_failed")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("reports a scanner error when Bouncer fails the scan", async () => {
    const { payload } = await scan({ bouncer: { kind: "error", detail: "scanner_error" } })

    expect(payload.verdict).toBe("error")
    expect(payload.detail).toBe("scanner_error")
  })

  it("reports a Bouncer timeout as a timeout", async () => {
    const { payload } = await scan({ bouncer: { kind: "error", detail: "timeout" } })

    expect(payload.verdict).toBe("error")
    expect(payload.detail).toBe("timeout")
  })

  it("rejects a file over the provider limit", async () => {
    const { harness, payload } = await scan({
      bouncer: { kind: "rejected", detail: "provider_file_too_large" },
    })

    expect(payload.verdict).toBe("rejected")
    expect(payload.detail).toBe("provider_file_too_large")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("sends a suspicious verdict for review instead of calling it clean", async () => {
    const { payload } = await scan({
      bouncer: { kind: "needs_review", detail: "Bouncer classified this file as suspicious" },
    })

    expect(payload.verdict).toBe("needs_review")
    expect(payload.detail).toBe("Bouncer classified this file as suspicious")
  })

  it("keeps an unknown Bouncer verdict an error", async () => {
    const { payload } = await scan({ bouncer: { kind: "error", detail: "scanner_error" } })

    expect(payload.verdict).not.toBe("clean")
    expect(payload.verdict).toBe("error")
  })

  it("reports a scanner error when the type probe fails", async () => {
    const { harness, payload } = await scan({ detectedExitCode: 1 })

    expect(payload.verdict).toBe("error")
    expect(payload.detail).toBe("scanner_error")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("times out and still removes the temporary file", async () => {
    const { harness, payload } = await scan({
      overallTimeoutMs: 20,
      download: async (downloadOptions: DownloadOptions): Promise<DownloadResult> =>
        new Promise<DownloadResult>((_resolve, reject) => {
          downloadOptions.signal.addEventListener("abort", () => {
            reject(new DownloadFailure("timeout", "the scan timed out"))
          })
        }),
    })

    expect(payload.verdict).toBe("error")
    expect(payload.detail).toBe("timeout")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("removes the temporary file when the callback fails", async () => {
    const { harness, payload, delivered } = await scan({ callbackThrows: true })

    expect(payload.verdict).toBe("clean")
    expect(delivered).toBe(false)
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("removes the temporary file when the type probe throws", async () => {
    const harness = await build()
    const deps: ScanRunnerDeps = {
      ...harness.deps,
      runCommand: async () => {
        throw new Error("spawn failed")
      },
    }

    const report = await runScan(harness.job, deps)

    expect(report.payload.verdict).toBe("error")
    expect(report.payload.detail).toBe("scanner_error")
    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("removes the temporary file when the download writes and then fails", async () => {
    const { harness } = await scan({
      download: async (downloadOptions: DownloadOptions): Promise<DownloadResult> => {
        await writeFile(downloadOptions.destination, BODY, { flag: "wx" })
        throw new DownloadFailure("download_failed", "connection reset")
      },
    })

    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("never leaves the temporary file behind on a rejected type", async () => {
    const { harness } = await scan({ detectedMime: "text/x-shellscript" })

    expect(await leftovers(harness.workDir)).toEqual([])
  })

  it("reports the bouncer engine and no signature version on every verdict", async () => {
    const harness = await build()
    const deps: ScanRunnerDeps = {
      ...harness.deps,
      scanFile: async (): Promise<BouncerOutcome> => ({
        kind: "infected",
        detail: "Eicar-Test-Signature",
      }),
    }

    const report = await runScan(harness.job, deps)

    expect(report.payload.engine).toBe(BOUNCER_ENGINE)
    expect(report.payload.signatureVersion).toBeNull()
  })

  it("treats a throwing scanFile as a scanner error", async () => {
    const harness = await build()
    const deps: ScanRunnerDeps = {
      ...harness.deps,
      scanFile: async () => {
        throw new Error("Bouncer request failed")
      },
    }

    const report = await runScan(harness.job, deps)

    expect(report.payload.verdict).toBe("error")
    expect(report.payload.detail).toBe("scanner_error")
  })

  it("uses the scanId as the temporary file name", async () => {
    const harness = await build()
    let destination = ""

    const deps: ScanRunnerDeps = {
      ...harness.deps,
      download: async (downloadOptions: DownloadOptions): Promise<DownloadResult> => {
        destination = downloadOptions.destination
        await writeFile(downloadOptions.destination, BODY, { flag: "wx" })

        return { sha256: "x", bytes: BODY.byteLength, detectedContentLength: BODY.byteLength }
      },
    }

    await runScan(harness.job, deps)

    expect(destination).toBe(join(harness.workDir, JOB.scanId))
  })

  it("passes the size limits through to the download", async () => {
    const harness = await build()
    let seenExpected = -1
    let seenMax = -1

    const deps: ScanRunnerDeps = {
      ...harness.deps,
      maxFileBytes: 4096,
      download: async (downloadOptions: DownloadOptions): Promise<DownloadResult> => {
        seenExpected = downloadOptions.expectedSizeBytes
        seenMax = downloadOptions.maxBytes
        await writeFile(downloadOptions.destination, BODY, { flag: "wx" })

        return { sha256: "x", bytes: BODY.byteLength, detectedContentLength: BODY.byteLength }
      },
    }

    await runScan(harness.job, deps)

    expect(seenExpected).toBe(BODY.byteLength)
    expect(seenMax).toBe(4096)
  })
})
