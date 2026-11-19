
/**
 * The self-test request.
 *
 * A self-test runs the pipeline a queued scan runs — download with a size cap,
 * libmagic type detection, the MIME policy, the archive policy, Bouncer and the
 * temporary file cleanup — but it answers inline instead of sending a callback.
 * It exists so an operator can prove the whole chain (storage, this service,
 * Bouncer, the policies) without creating a product or a file record.
 *
 * What it deliberately does not do: read or write the app's database, send a
 * callback, or touch any product. The app's own self-test runner explains that
 * in its docs, so nobody mistakes a passing self-test for a passing callback.
 *
 * Nothing here logs: the caller decides what a line may contain, and a download
 * URL is a credential.
 */

import { randomUUID } from "node:crypto"

import type { CallbackPayload } from "#callback"
import { BOUNCER_ENGINE } from "#bouncer"
import type { ScannerConfig } from "#config"
import { isAllowedExtension } from "#mime-policy"
import type { PipelineDeps, PipelineReport, ScanJob } from "#scan-runner"
import { runScanPipeline } from "#scan-runner"
import { checkDownloadUrl } from "#url-guard"

/** The largest object a self-test may point at: 2 MiB. */
export const SELFTEST_MAX_BYTES = 2_097_152

/** One self-test, from the download to the answer, must finish inside this. */
export const SELFTEST_DEADLINE_MS = 25_000

const EXTENSION_PATTERN = /^[a-z0-9]+$/

export type SelftestRequest = {
  readonly downloadUrl: string
  readonly expectedSizeBytes: number
  readonly extension: string
}

export type SelftestValidation =
  | { readonly ok: true; readonly request: SelftestRequest }
  | { readonly ok: false; readonly field: string; readonly reason: string }

/**
 * The answer body. It mirrors the callback payload minus the identifiers and
 * the timestamp, because a self-test has no scan id and no file id.
 */
export type SelftestResult = {
  readonly verdict: string
  readonly detail: string
  readonly sha256: string | null
  readonly detectedMime: string | null
  readonly engine: string
  readonly signatureVersion: string | null
  readonly durationMs: number
}

/**
 * Runs the pipeline for one self-test. The production value is
 * `runScanPipeline`, so a self-test cannot drift away from a real scan; tests
 * inject a fake.
 */
export type SelftestRunner = (job: ScanJob, deps: PipelineDeps) => Promise<PipelineReport>

/** The single-flight guard: at most one self-test at a time. */
export type SelftestLock = {
  readonly tryAcquire: () => boolean
  readonly release: () => void
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalid(field: string, reason: string): SelftestValidation {
  return { ok: false, field, reason }
}

/**
 * Checks every field of a self-test request. Same rules as a scan request for
 * the URL and the extension, plus a size floor of one byte and a 2 MiB ceiling.
 */
export function validateSelftestRequest(body: unknown, config: ScannerConfig): SelftestValidation {
  if (!isRecord(body)) {
    return invalid("body", "must be a JSON object")
  }

  const downloadCheck = checkDownloadUrl(body.downloadUrl, config.allowedDownloadHostSuffix)

  if (!downloadCheck.ok) {
    return invalid("downloadUrl", downloadCheck.reason)
  }

  const expectedSizeBytes = body.expectedSizeBytes

  if (
    typeof expectedSizeBytes !== "number" ||
    !Number.isInteger(expectedSizeBytes) ||
    expectedSizeBytes < 1 ||
    expectedSizeBytes > SELFTEST_MAX_BYTES
  ) {
    return invalid("expectedSizeBytes", `must be an integer between 1 and ${SELFTEST_MAX_BYTES}`)
  }

  const extension = body.extension

  if (typeof extension !== "string" || !EXTENSION_PATTERN.test(extension)) {
    return invalid("extension", "must be a lowercase extension without a dot")
  }

  if (!isAllowedExtension(extension)) {
    return invalid("extension", "is not an accepted file type")
  }

  return {
    ok: true,
    request: {
      downloadUrl: downloadCheck.url.toString(),
      expectedSizeBytes,
      extension,
    },
  }
}

/**
 * A one-shot lock. `tryAcquire` answers false while a self-test is running, so
 * the second caller is refused instead of queued: a self-test is an operator
 * action, not load to absorb.
 */
export function createSelftestLock(): SelftestLock {
  let held = false

  return {
    tryAcquire: (): boolean => {
      if (held) {
        return false
      }

      held = true

      return true
    },
    release: (): void => {
      held = false
    },
  }
}

/**
 * The job the pipeline is given. The identifiers are random because nothing
 * echoes them back, and the scan id doubles as the temporary file name.
 *
 * `callbackUrl` is empty: the pipeline never reads it, and a self-test has no
 * callback to send. Nothing downstream validates or logs that field.
 */
export function createSelftestJob(request: SelftestRequest): ScanJob {
  return {
    scanId: randomUUID(),
    fileId: randomUUID(),
    downloadUrl: request.downloadUrl,
    expectedSizeBytes: request.expectedSizeBytes,
    extension: request.extension,
    callbackUrl: "",
  }
}

/** Maps a pipeline answer onto the response body. */
export function toSelftestResult(payload: CallbackPayload, durationMs: number): SelftestResult {
  return {
    verdict: payload.verdict,
    detail: payload.detail,
    sha256: payload.sha256,
    detectedMime: payload.detectedMime,
    engine: payload.engine,
    signatureVersion: payload.signatureVersion,
    durationMs,
  }
}

/** The answer for a self-test that produced no verdict at all. */
export function errorResult(detail: string, durationMs: number): SelftestResult {
  return {
    verdict: "error",
    detail,
    sha256: null,
    detectedMime: null,
    engine: BOUNCER_ENGINE,
    signatureVersion: null,
    durationMs,
  }
}

/**
 * The answer for a self-test that ran out of time. The pipeline may still be
 * finishing its cleanup, which is why the same detail code is used: an operator
 * sees one answer, and it is the truth.
 */
export function timeoutResult(durationMs: number): SelftestResult {
  return errorResult("timeout", durationMs)
}
