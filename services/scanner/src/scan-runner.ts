/**
 * The per-job pipeline.
 *
 * Order is fixed by the contract, because each stage is only worth running when
 * the cheaper one before it passed:
 *
 *   size_mismatch -> type policy -> archive policy -> ClamAV -> clean
 *
 * The temporary file is removed in a `finally` block on every path, including a
 * timeout, so a crash cannot leave an unscanned upload behind. Dependencies are
 * injected so the whole pipeline can be tested without a network, ClamAV or
 * 7-Zip.
 */

import { rm } from "node:fs/promises"
import { join } from "node:path"

import { decideArchiveListing, parseSevenZipListing } from "#archive-policy"
import type { ArchiveListing } from "#archive-policy"
import { sanitiseDetail } from "#callback"
import type { CallbackPayload, ScanVerdict } from "#callback"
import { PAYLOAD_ENGINE } from "#clamav"
import type { ClamavInfo, ClamavOutcome } from "#clamav"
import { DOWNLOAD_TIMEOUT_MS, downloadToFile, DownloadFailure } from "#download"
import type { DownloadOptions, DownloadResult, FetchLike } from "#download"
import type { RunCommand } from "#exec"
import type { Logger } from "#log"
import { decideMime, isArchiveExtension, normaliseMime } from "#mime-policy"

export const OVERALL_TIMEOUT_MS = 1_200_000
export const COMMAND_TIMEOUT_MS = 120_000
export const CLAMAV_TIMEOUT_MS = 300_000

export type ScanJob = {
  readonly scanId: string
  readonly fileId: string
  readonly downloadUrl: string
  readonly expectedSizeBytes: number
  readonly extension: string
  readonly callbackUrl: string
}

export type CallbackDelivery = {
  readonly delivered: boolean
  readonly attempts: number
}

export type ScanRunnerDeps = {
  readonly workDir: string
  readonly maxFileBytes: number
  readonly fetch: FetchLike
  readonly download: (options: DownloadOptions) => Promise<DownloadResult>
  readonly runCommand: RunCommand
  readonly scanFile: (filePath: string, timeoutMs?: number) => Promise<ClamavOutcome>
  readonly sendCallback: (payload: CallbackPayload) => Promise<CallbackDelivery>
  readonly readClamavInfo: () => Promise<ClamavInfo>
  readonly now: () => number
  readonly log: Logger
  readonly removeFile?: (filePath: string) => Promise<void>
  readonly overallTimeoutMs?: number
  readonly downloadTimeoutMs?: number
  readonly commandTimeoutMs?: number
  readonly clamavTimeoutMs?: number
}

export type ScanRunReport = {
  readonly payload: CallbackPayload
  readonly delivery: CallbackDelivery
  readonly durationMs: number
}

type StageResult = {
  readonly payload: CallbackPayload
  readonly stages: Record<string, number>
}

type StageContext = {
  readonly destination: string
  readonly timedOut: () => boolean
}

const UNKNOWN_CLAMAV_INFO: ClamavInfo = { engine: "unknown", signatureVersion: null }

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (trimmed !== "") {
      return trimmed
    }
  }

  return ""
}

/**
 * Runs one scan end to end: pipeline, cleanup, callback, log line.
 */
export async function runScan(job: ScanJob, deps: ScanRunnerDeps): Promise<ScanRunReport> {
  const startedAt = deps.now()
  const destination = join(deps.workDir, job.scanId)
  const controller = new AbortController()
  let timedOut = false
  const overallTimeoutMs = deps.overallTimeoutMs ?? OVERALL_TIMEOUT_MS

  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, overallTimeoutMs)

  const context: StageContext = {
    destination,
    timedOut: () => timedOut,
  }

  const result = await (async (): Promise<StageResult> => {
    try {
      return await runStages(job, deps, context, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  })()

  let delivery: CallbackDelivery = { delivered: false, attempts: 0 }

  try {
    delivery = await deps.sendCallback(result.payload)
  } catch {
    delivery = { delivered: false, attempts: 0 }
  }

  deps.log.scan({
    scanId: job.scanId,
    fileId: job.fileId,
    verdict: result.payload.verdict,
    durationMs: deps.now() - startedAt,
    stages: result.stages,
  })

  return { payload: result.payload, delivery, durationMs: deps.now() - startedAt }
}

function buildPayload(
  job: ScanJob,
  deps: ScanRunnerDeps,
  fields: {
    readonly verdict: ScanVerdict
    readonly detail: string
    readonly sha256: string | null
    readonly detectedMime: string | null
    readonly signatureVersion: string | null
  },
): CallbackPayload {
  return {
    scanId: job.scanId,
    fileId: job.fileId,
    verdict: fields.verdict,
    detail: sanitiseDetail(fields.detail),
    sha256: fields.sha256,
    detectedMime: fields.detectedMime === null ? null : normaliseMime(fields.detectedMime),
    engine: PAYLOAD_ENGINE,
    signatureVersion: fields.signatureVersion,
    scannedAt: new Date(deps.now()).toISOString(),
  }
}

async function removeTemporaryFile(deps: ScanRunnerDeps, destination: string): Promise<void> {
  const remove = deps.removeFile ?? (async (filePath: string): Promise<void> => {
    await rm(filePath, { force: true })
  })

  try {
    await remove(destination)
  } catch {
    return
  }
}

/**
 * The pipeline itself. Every exit path is inside the `try`, so the `finally`
 * always removes the temporary file.
 */
async function runStages(
  job: ScanJob,
  deps: ScanRunnerDeps,
  context: StageContext,
  signal: AbortSignal,
): Promise<StageResult> {
  const stages: Record<string, number> = {}
  const commandTimeoutMs = deps.commandTimeoutMs ?? COMMAND_TIMEOUT_MS
  const clamavTimeoutMs = deps.clamavTimeoutMs ?? CLAMAV_TIMEOUT_MS

  const failure = (
    verdict: ScanVerdict,
    detail: string,
    extras: { sha256?: string | null; detectedMime?: string | null; signatureVersion?: string | null } = {},
  ): StageResult => ({
    payload: buildPayload(job, deps, {
      verdict,
      detail,
      sha256: extras.sha256 ?? null,
      detectedMime: extras.detectedMime ?? null,
      signatureVersion: extras.signatureVersion ?? null,
    }),
    stages,
  })

  try {
    const downloadStartedAt = deps.now()

    let sha256: string | null = null

    try {
      const download = await deps.download({
        url: job.downloadUrl,
        destination: context.destination,
        expectedSizeBytes: job.expectedSizeBytes,
        maxBytes: deps.maxFileBytes,
        fetch: deps.fetch,
        signal,
        timeoutMs: deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS,
      })

      sha256 = download.sha256
    } catch (error) {
      stages.download = deps.now() - downloadStartedAt

      if (error instanceof DownloadFailure) {
        const verdict: ScanVerdict = error.code === "size_mismatch" ? "rejected" : "error"

        return failure(verdict, error.code)
      }

      return failure("error", context.timedOut() ? "timeout" : "download_failed")
    }

    stages.download = deps.now() - downloadStartedAt

    if (context.timedOut()) {
      return failure("error", "timeout", { sha256 })
    }

    const detectStartedAt = deps.now()
    const detected = await deps.runCommand("file", ["--mime-type", "-b", context.destination], {
      timeoutMs: commandTimeoutMs,
    })

    stages.detect = deps.now() - detectStartedAt

    if (detected.timedOut) {
      return failure("error", "timeout", { sha256 })
    }

    if (detected.code !== 0) {
      return failure("error", "scanner_error", { sha256 })
    }

    const detectedMime = firstLine(detected.stdout)

    if (detectedMime === "") {
      return failure("error", "scanner_error", { sha256 })
    }

    const mimeStartedAt = deps.now()
    const mimeDecision = decideMime(job.extension, detectedMime)

    stages.policy = deps.now() - mimeStartedAt

    if (mimeDecision.verdict === "rejected") {
      return failure("rejected", mimeDecision.detail, { sha256, detectedMime })
    }

    if (isArchiveExtension(job.extension)) {
      const archiveStartedAt = deps.now()
      const listing = await deps.runCommand("7z", ["l", "-slt", context.destination], {
        timeoutMs: commandTimeoutMs,
      })

      let parsed: ArchiveListing | null = null

      if (listing.code === 0 && !listing.timedOut) {
        parsed = parseSevenZipListing(listing.stdout)
      }

      const decision = decideArchiveListing(parsed)

      stages.archive = deps.now() - archiveStartedAt

      if (decision.verdict !== "ok") {
        return failure(decision.verdict, decision.detail, { sha256, detectedMime })
      }
    }

    const clamavStartedAt = deps.now()
    let outcome: ClamavOutcome

    try {
      outcome = await deps.scanFile(context.destination, clamavTimeoutMs)
    } catch {
      outcome = { kind: "error", detail: "scanner_error" }
    }

    stages.scan = deps.now() - clamavStartedAt

    let info: ClamavInfo

    try {
      info = await deps.readClamavInfo()
    } catch {
      info = UNKNOWN_CLAMAV_INFO
    }

    const signatureVersion = info.signatureVersion

    if (context.timedOut()) {
      return failure("error", "timeout", { sha256, detectedMime, signatureVersion })
    }

    if (outcome.kind === "clean") {
      return failure("clean", "clean", { sha256, detectedMime, signatureVersion })
    }

    if (outcome.kind === "infected") {
      return failure("infected", outcome.signature, { sha256, detectedMime, signatureVersion })
    }

    if (outcome.kind === "rejected") {
      return failure("rejected", outcome.detail, { sha256, detectedMime, signatureVersion })
    }

    return failure("error", outcome.detail, { sha256, detectedMime, signatureVersion })
  } catch {
    return failure("error", context.timedOut() ? "timeout" : "scanner_error")
  } finally {
    await removeTemporaryFile(deps, context.destination)
  }
}
