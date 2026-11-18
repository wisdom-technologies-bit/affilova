/**
 * Streaming download of the object under scan.
 *
 * The body is written to disk chunk by chunk while SHA-256 is computed, so a
 * large file never sits in memory. The transfer is aborted as soon as the byte
 * count passes either the declared size or the hard limit, and the caller still
 * sees a `size_mismatch` because the file on disk is not the size it claimed.
 */

import { createHash } from "node:crypto"
import { open } from "node:fs/promises"

export type FetchInit = {
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly redirect?: "error" | "follow" | "manual"
  readonly signal?: AbortSignal
}

export type FetchResponse = {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get: (name: string) => string | null }
  readonly body: ReadableStream<Uint8Array> | null
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>

export type DownloadFailureCode = "download_failed" | "size_mismatch" | "timeout"

export class DownloadFailure extends Error {
  readonly code: DownloadFailureCode

  constructor(code: DownloadFailureCode, message: string) {
    super(message)
    this.name = "DownloadFailure"
    this.code = code
  }
}

/**
 * The global fetch, narrowed to the shape this module needs.
 */
export const nodeFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init)

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body,
  }
}

export const DOWNLOAD_TIMEOUT_MS = 600_000

export type DownloadOptions = {
  readonly url: string
  readonly destination: string
  readonly expectedSizeBytes: number
  readonly maxBytes: number
  readonly fetch: FetchLike
  readonly signal: AbortSignal
  readonly timeoutMs?: number
}

export type DownloadResult = {
  readonly sha256: string
  readonly bytes: number
  readonly detectedContentLength: number | null
}

/**
 * Downloads `url` to `destination` (`wx`, so an existing file is never reused)
 * and returns its SHA-256 and byte count.
 */
export async function downloadToFile(options: DownloadOptions): Promise<DownloadResult> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS

  let timedOut = false

  const abortFromCaller = (): void => {
    controller.abort()
  }

  if (options.signal.aborted) {
    throw new DownloadFailure("timeout", "the scan was aborted before the download started")
  }

  options.signal.addEventListener("abort", abortFromCaller, { once: true })

  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const limit = Math.min(options.expectedSizeBytes, options.maxBytes)

  try {
    let response: FetchResponse

    try {
      response = await options.fetch(options.url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      })
    } catch (error) {
      throw new DownloadFailure(timedOut ? "timeout" : "download_failed", describe(error))
    }

    if (!response.ok) {
      throw new DownloadFailure("download_failed", `storage answered ${response.status}`)
    }

    const declared = response.headers.get("content-length")
    const declaredBytes = declared === null ? null : Number(declared)

    if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > limit) {
      throw new DownloadFailure("size_mismatch", "declared content length is larger than allowed")
    }

    const body = response.body

    if (body === null) {
      throw new DownloadFailure("download_failed", "storage returned an empty body")
    }

    const handle = await open(options.destination, "wx")
    const hash = createHash("sha256")
    const reader = body.getReader()

    let bytes = 0
    let closed = false

    try {
      while (true) {
        const chunk = await reader.read()

        if (chunk.done) {
          break
        }

        const value = chunk.value
        bytes += value.byteLength

        if (bytes > limit) {
          controller.abort()
          throw new DownloadFailure("size_mismatch", "download exceeded the allowed size")
        }

        hash.update(value)
        let offset = 0

        while (offset < value.byteLength) {
          const written = await handle.write(value, offset, value.byteLength - offset)

          if (written.bytesWritten <= 0) {
            throw new DownloadFailure("download_failed", "could not write the temporary file")
          }

          offset += written.bytesWritten
        }
      }

      await handle.close()
      closed = true
    } finally {
      if (!closed) {
        await handle.close().catch(() => undefined)
      }

      await reader.cancel().catch(() => undefined)
    }

    if (bytes !== options.expectedSizeBytes) {
      throw new DownloadFailure("size_mismatch", "downloaded size differs from expectedSizeBytes")
    }

    return {
      sha256: hash.digest("hex"),
      bytes,
      detectedContentLength: declaredBytes === null || !Number.isFinite(declaredBytes) ? null : declaredBytes,
    }
  } catch (error) {
    if (error instanceof DownloadFailure) {
      throw error
    }

    throw new DownloadFailure(timedOut ? "timeout" : "download_failed", describe(error))
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener("abort", abortFromCaller)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "the transfer was aborted"
  }

  if (error instanceof Error) {
    return error.message
  }

  return "the transfer failed"
}
