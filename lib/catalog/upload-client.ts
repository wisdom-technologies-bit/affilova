// The upload engine.
//
// Plain TypeScript with the network injected: the interesting parts (splitting a
// file into parts, keeping three requests in flight, retrying one part, adding
// up progress, stopping on cancel) are decided here and tested in Node, with no
// browser and no XMLHttpRequest.
//
// The plan is never guessed. startFileUploadAction answers with the plan the
// server reserved, and this module follows it, because the reservation and the
// signed URLs are what make the object readable afterwards.

import type {
  AbortFileUploadResult,
  ConfirmFileUploadResult,
  PartUrlsResult,
  StartFileUploadResult,
} from "./action-types"
import { catalogErrorMessage } from "./errors"
import { MULTIPART_THRESHOLD_BYTES, validateUpload, type UploadRejectionCode } from "./files"

/** At most this many part requests are in flight at once. */
export const UPLOAD_CONCURRENCY = 3

/** How many times a failed part is tried again after its first failure. */
export const PART_RETRIES = 3

/** The wait before the first retry; it doubles after that. */
export const RETRY_BASE_DELAY_MS = 500

/**
 * The most parts completeMultipartAction will accept: completeMultipartSchema
 * caps the parts array at 100.
 *
 * With the 16 MiB part size startFileUploadAction reserves, that tops a
 * multipart upload out at 1.6 GB. No file the app accepts today reaches that,
 * because the provider's scan limit is 25 MB and every upload takes the
 * single-request path. The guard stays anyway: if a larger limit returns, the
 * client says so plainly instead of uploading parts and having the completion
 * refused at the end.
 */
export const MAX_COMPLETABLE_PARTS = 100

/** The bytes a transport is asked to send. A Blob in a browser, anything in a test. */
export type UploadBody = unknown

/** The file being uploaded, in the shape both a File and a test double can meet. */
export type UploadSource = {
  name: string
  size: number
  slice: (start: number, end: number) => UploadBody
}

export type UploadProgress = {
  status: "starting" | "uploading" | "uploaded"
  /** Bytes that have arrived at the storage, across all parts. */
  loaded: number
  /** The size reserved on the server. */
  total: number
  /** loaded / total, clamped to 0..1. */
  ratio: number
}

export type UploadOutcome =
  | { ok: true; fileId: string }
  | {
      ok: false
      /**
       * "rejected": refused before anything was reserved (extension, size, an
       * empty file). "failed": the server or the network refused. "cancelled":
       * the person pressed Cancel.
       */
      reason: "rejected" | "failed" | "cancelled"
      message: string
      fileId?: string
    }

/**
 * An error from one part. retryable says whether trying the same part again
 * could work: a timeout could, a 400 cannot. expired says the signed URL has
 * gone stale and must be replaced before the retry.
 */
export class PartUploadError extends Error {
  readonly retryable: boolean
  readonly expired: boolean

  constructor(message: string, options: { retryable?: boolean; expired?: boolean } = {}) {
    super(message)
    this.name = "PartUploadError"
    this.retryable = options.retryable ?? false
    this.expired = options.expired ?? false
  }
}

class CancelledError extends Error {
  constructor() {
    super("cancelled")
    this.name = "CancelledError"
  }
}

/** Everything this module needs from the outside world. */
export type UploadTransport = {
  start: (input: {
    productId: string
    filename: string
    sizeBytes: number
  }) => Promise<StartFileUploadResult>
  /** A single PUT of the whole file, with progress. */
  putObject: (input: {
    url: string
    body: UploadBody
    contentType: string
    onProgress: (loaded: number) => void
    signal: AbortSignal
  }) => Promise<void>
  /** One part of a multipart upload. The ETag comes back in the response header. */
  putPart: (input: {
    url: string
    body: UploadBody
    onProgress: (loaded: number) => void
    signal: AbortSignal
  }) => Promise<{ etag: string | null }>
  partUrls: (input: { fileId: string; partNumbers: number[] }) => Promise<PartUrlsResult>
  complete: (input: {
    fileId: string
    parts: { partNumber: number; etag: string }[]
  }) => Promise<ConfirmFileUploadResult>
  confirm: (input: { fileId: string }) => Promise<ConfirmFileUploadResult>
  abort: (input: { fileId: string }) => Promise<AbortFileUploadResult>
  /** Injected so a test does not wait for real delays. */
  sleep?: (ms: number) => Promise<void>
}

export type UploadInput = {
  productId: string
  source: UploadSource
  transport: UploadTransport
  signal: AbortSignal
  onProgress?: (progress: UploadProgress) => void
}

/** True when the server will reserve this file as a multipart upload. */
export function shouldUploadInParts(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_THRESHOLD_BYTES
}

/** How many parts a file of this size is cut into. */
export function partCount(sizeBytes: number, partSizeBytes: number): number {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new RangeError("partCount expects a positive whole number of bytes")
  }

  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) {
    throw new RangeError("partCount expects a positive part size")
  }

  return Math.ceil(sizeBytes / partSizeBytes)
}

/**
 * The byte range of one part. end is exclusive, which is what Blob.slice takes.
 * The last part is whatever is left, so the ranges cover the file exactly once.
 */
export function partRange(
  sizeBytes: number,
  partSizeBytes: number,
  partNumber: number,
): { start: number; end: number } {
  const total = partCount(sizeBytes, partSizeBytes)

  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total) {
    throw new RangeError(`part ${partNumber} is outside 1..${total}`)
  }

  const start = (partNumber - 1) * partSizeBytes

  return { start, end: Math.min(start + partSizeBytes, sizeBytes) }
}

function rejectionMessage(code: UploadRejectionCode): string {
  return catalogErrorMessage(code)
}

/**
 * Upload one file, following the plan the server returned.
 *
 * The file is validated locally first, with the same rules the server applies,
 * so a wrong file is refused without reserving anything. Every failure path
 * tells the server to drop the reservation, so a half-uploaded file never stays
 * attached to the product.
 */
export async function uploadFile(input: UploadInput): Promise<UploadOutcome> {
  const { productId, source, transport, signal } = input
  const sleep = transport.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  }))

  const report = (status: UploadProgress["status"], loaded: number, total: number): void => {
    const ratio = total <= 0 ? 0 : Math.min(Math.max(loaded / total, 0), 1)

    input.onProgress?.({ status, loaded, total, ratio })
  }

  const validation = validateUpload({ filename: source.name, sizeBytes: source.size })

  if (!validation.ok) {
    return { ok: false, reason: "rejected", message: rejectionMessage(validation.code) }
  }

  if (signal.aborted) {
    return { ok: false, reason: "cancelled", message: "The upload was cancelled." }
  }

  report("starting", 0, source.size)

  const started = await transport.start({
    productId,
    filename: validation.sanitizedName,
    sizeBytes: source.size,
  })

  if (!started.ok) {
    return { ok: false, reason: "failed", message: started.error }
  }

  const fileId = started.fileId

  const stop = async (reason: "failed" | "cancelled", message: string): Promise<UploadOutcome> => {
    await transport.abort({ fileId }).catch(() => undefined)

    return { ok: false, reason, message, fileId }
  }

  if (signal.aborted) {
    return stop("cancelled", "The upload was cancelled.")
  }

  try {
    if (started.plan.kind === "single") {
      await transport.putObject({
        url: started.plan.url,
        body: source.slice(0, source.size),
        contentType: started.contentType,
        onProgress: (loaded) => report("uploading", loaded, source.size),
        signal,
      })

      const confirmed = await transport.confirm({ fileId })

      if (!confirmed.ok) {
        return stop("failed", confirmed.error)
      }
    } else {
      const parts = started.plan.parts
      const partSizeBytes = started.plan.partSizeBytes
      const count = partCount(source.size, partSizeBytes)

      if (count > MAX_COMPLETABLE_PARTS) {
        return stop(
          "failed",
          `This file is too large to upload in one go. It needs ${count} parts and at most ${MAX_COMPLETABLE_PARTS} can be sent. Split it into smaller files.`,
        )
      }

      const urls = new Map<number, string>()

      for (const part of parts) {
        urls.set(part.partNumber, part.url)
      }

      const missing: number[] = []

      for (let partNumber = 1; partNumber <= count; partNumber += 1) {
        if (!urls.has(partNumber)) {
          missing.push(partNumber)
        }
      }

      if (missing.length > 0) {
        const fresh = await transport.partUrls({ fileId, partNumbers: missing })

        if (!fresh.ok) {
          return stop("failed", fresh.error)
        }

        for (const part of fresh.parts) {
          urls.set(part.partNumber, part.url)
        }
      }

      const loadedByPart = new Array<number>(count + 1).fill(0)
      const etags = new Map<number, string>()

      const totalLoaded = (): number => {
        let sum = 0

        for (let index = 1; index <= count; index += 1) {
          sum += loadedByPart[index] ?? 0
        }

        return sum
      }

      const uploadPart = async (partNumber: number): Promise<void> => {
        const { start, end } = partRange(source.size, partSizeBytes, partNumber)
        const body = source.slice(start, end)

        for (let attempt = 0; attempt <= PART_RETRIES; attempt += 1) {
          if (signal.aborted) {
            throw new CancelledError()
          }

          if (attempt > 0) {
            await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
          }

          const url = urls.get(partNumber)

          if (url === undefined) {
            throw new PartUploadError(`Part ${partNumber} has no upload URL.`, {
              retryable: false,
            })
          }

          try {
            const result = await transport.putPart({
              url,
              body,
              onProgress: (loaded) => {
                loadedByPart[partNumber] = Math.min(Math.max(loaded, 0), end - start)
                report("uploading", totalLoaded(), source.size)
              },
              signal,
            })

            if (typeof result.etag !== "string" || result.etag === "") {
              // Without the ETag the part cannot be joined, and retrying would
              // only repeat the same broken response.
              throw new PartUploadError(
                `The storage did not return an ETag for part ${partNumber}.`,
                { retryable: false },
              )
            }

            etags.set(partNumber, result.etag)
            loadedByPart[partNumber] = end - start
            report("uploading", totalLoaded(), source.size)

            return
          } catch (error) {
            if (error instanceof CancelledError || signal.aborted) {
              throw new CancelledError()
            }

            const retryable = error instanceof PartUploadError && error.retryable

            if (!retryable || attempt === PART_RETRIES) {
              throw error
            }

            // A stale signature cannot be retried against the same URL.
            if (error instanceof PartUploadError && error.expired) {
              const fresh = await transport.partUrls({ fileId, partNumbers: [partNumber] })

              if (fresh.ok) {
                for (const part of fresh.parts) {
                  urls.set(part.partNumber, part.url)
                }
              }
            }
          }
        }
      }

      // A fixed set of workers, each taking the next part number, keeps the
      // number of requests in flight at the limit without ever exceeding it.
      const workers: Promise<void>[] = []
      let nextPart = 1

      const worker = async (): Promise<void> => {
        for (;;) {
          if (signal.aborted) {
            throw new CancelledError()
          }

          const partNumber = nextPart
          nextPart += 1

          if (partNumber > count) {
            return
          }

          await uploadPart(partNumber)
        }
      }

      for (let index = 0; index < Math.min(UPLOAD_CONCURRENCY, count); index += 1) {
        workers.push(worker())
      }

      await Promise.all(workers)

      const completed = [...etags.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([partNumber, etag]) => ({ partNumber, etag }))

      const finished = await transport.complete({ fileId, parts: completed })

      if (!finished.ok) {
        return stop("failed", finished.error)
      }
    }

    report("uploaded", source.size, source.size)

    return { ok: true, fileId }
  } catch (error) {
    if (error instanceof CancelledError || signal.aborted) {
      return stop("cancelled", "The upload was cancelled.")
    }

    if (error instanceof PartUploadError) {
      return stop("failed", error.message)
    }

    return stop("failed", "The upload failed. Try again.")
  }
}
