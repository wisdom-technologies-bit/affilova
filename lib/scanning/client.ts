import "server-only"

import { getScannerEnv } from "@/lib/env"
import { logger } from "@/lib/logger"

// The one call this app makes to the scanner service.
//
// The scanner is told where to fetch the file from (a short-lived signed URL)
// and where to send its answer (our signed callback route). It never receives a
// credential for storage, and this module never logs the signed URL, the secret
// or the request body: a log line with any of those in it is a leak.

/** The scanner is given ten seconds to accept the work, not to finish it. */
export const SCAN_REQUEST_TIMEOUT_MS = 10_000

export interface ScanRequestInput {
  scanId: string
  fileId: string
  /** A presigned GET URL. Never logged. */
  downloadUrl: string
  expectedSizeBytes: number
  extension: string
  callbackUrl: string
}

export type ScanRequestResult =
  | { ok: true }
  | {
      ok: false
      /**
       * true when trying again later could work (429, 503, a 5xx, a timeout or a
       * network failure). false when the request itself is wrong (400, 401).
       */
      retryable: boolean
    }

export interface ScannerClientDependencies {
  baseUrl: string
  sharedSecret: string
  /** Injected so tests need no network. */
  fetch: typeof fetch
  timeoutMs?: number
}

/** The body the scanner's contract expects. Field names are its contract. */
function requestBody(input: ScanRequestInput): string {
  return JSON.stringify({
    scanId: input.scanId,
    fileId: input.fileId,
    downloadUrl: input.downloadUrl,
    expectedSizeBytes: input.expectedSizeBytes,
    extension: input.extension,
    callbackUrl: input.callbackUrl,
  })
}

/**
 * A trailing slash on the base URL must not produce a double slash in the path.
 */
function scanEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/scan`
}

/** Which HTTP answers are worth trying again. */
function isRetryableStatus(status: number): boolean {
  if (status === 429 || status === 503) {
    return true
  }

  // 400 and 401 mean the request is wrong or the credential is wrong: a retry
  // sends exactly the same thing and fails the same way.
  return status >= 500
}

/** Send one scan request through an already configured client. */
export async function postScanRequest(
  deps: ScannerClientDependencies,
  input: ScanRequestInput,
): Promise<ScanRequestResult> {
  const timeoutMs = deps.timeoutMs ?? SCAN_REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await deps.fetch(scanEndpoint(deps.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.sharedSecret}`,
        "Content-Type": "application/json",
      },
      body: requestBody(input),
      signal: controller.signal,
      cache: "no-store",
    })

    if (response.status === 202) {
      return { ok: true }
    }

    // The status is safe to log; the request and the response body are not.
    logger.error("scanner_request_rejected", { status: response.status })

    return { ok: false, retryable: isRetryableStatus(response.status) }
  } catch {
    // A timeout, a refused connection or DNS: all worth another attempt. The
    // error itself is not logged, because it can quote the URL.
    logger.error("scanner_request_failed", { reason: "network" })

    return { ok: false, retryable: true }
  } finally {
    clearTimeout(timer)
  }
}

/** Ask the scanner to scan one file, using the configured service. */
export async function requestScan(input: ScanRequestInput): Promise<ScanRequestResult> {
  const env = getScannerEnv()

  return postScanRequest(
    {
      baseUrl: env.SCANNER_URL.toString(),
      sharedSecret: env.SCANNER_SHARED_SECRET,
      fetch: (url, init) => fetch(url, init),
    },
    input,
  )
}
