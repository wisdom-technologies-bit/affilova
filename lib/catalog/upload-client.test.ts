import { describe, expect, it, vi } from "vitest"

import type { StartFileUploadResult } from "./action-types"
import { catalogErrorMessage } from "./errors"
import { MAX_FILE_BYTES, MULTIPART_THRESHOLD_BYTES, PART_SIZE_BYTES } from "./files"
import {
  MAX_COMPLETABLE_PARTS,
  PART_RETRIES,
  PartUploadError,
  UPLOAD_CONCURRENCY,
  partCount,
  partRange,
  shouldUploadInParts,
  uploadFile,
  type UploadTransport,
} from "./upload-client"

// The upload engine, tested without a browser.
//
// Everything that can go wrong in a large upload is a decision in this module:
// where the parts are cut, how many run at once, when a part is retried, when a
// stale URL is replaced, what the progress bar is told, and what happens when a
// person presses Cancel.

const MiB = 1024 * 1024
const FILE_ID = "2f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30"

type Harness = {
  transport: UploadTransport
  calls: {
    start: number
    putObject: number
    putPart: number
    partUrls: number
    complete: number
    confirm: number
    abort: number
    partsAttempted: number[]
    inFlight: number
    maxInFlight: number
    sleeps: number[]
  }
  progress: { loaded: number; total: number; ratio: number; status: string }[]
}

function urlPartNumber(url: string): number {
  const value = Number(url.slice(url.lastIndexOf("/") + 1))

  return Number.isInteger(value) ? value : 1
}

function harness(options: {
  sizeBytes: number
  multipart: boolean
  /** Return an error to make this attempt fail. attempt is 1 for the first try. */
  fail?: (partNumber: number, attempt: number) => Error | null
  /** Return false to answer a putPart with no ETag header. */
  etag?: boolean
  partSizeBytes?: number
}): Harness {
  const partSizeBytes = options.partSizeBytes ?? PART_SIZE_BYTES
  const count = Math.ceil(options.sizeBytes / partSizeBytes)
  const attempts = new Map<number, number>()

  const calls: Harness["calls"] = {
    start: 0,
    putObject: 0,
    putPart: 0,
    partUrls: 0,
    complete: 0,
    confirm: 0,
    abort: 0,
    partsAttempted: [],
    inFlight: 0,
    maxInFlight: 0,
    sleeps: [],
  }

  const progress: Harness["progress"] = []

  const startResult: StartFileUploadResult = options.multipart
    ? {
        ok: true,
        fileId: FILE_ID,
        key: "products/p/f",
        contentType: "application/pdf",
        plan: {
          kind: "multipart",
          uploadId: "upload-1",
          partSizeBytes,
          expiresInSeconds: 3600,
          parts: Array.from({ length: count }, (_, index) => ({
            partNumber: index + 1,
            url: `https://bucket.r2.cloudflarestorage.com/part/${index + 1}`,
          })),
        },
      }
    : {
        ok: true,
        fileId: FILE_ID,
        key: "products/p/f",
        contentType: "application/pdf",
        plan: { kind: "single", method: "PUT", url: "https://bucket.r2.cloudflarestorage.com/whole", expiresInSeconds: 900 },
      }

  const transport: UploadTransport = {
    start: async () => {
      calls.start += 1

      return startResult
    },

    putObject: async (input) => {
      calls.putObject += 1
      input.onProgress(Math.floor(options.sizeBytes / 2))
      input.onProgress(options.sizeBytes)
    },

    putPart: async (input) => {
      const partNumber = urlPartNumber(input.url)

      calls.putPart += 1
      calls.partsAttempted.push(partNumber)
      attempts.set(partNumber, (attempts.get(partNumber) ?? 0) + 1)

      calls.inFlight += 1
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight)

      const attempt = attempts.get(partNumber) ?? 1
      const failure = options.fail?.(partNumber, attempt) ?? null

      try {
        // Yield, so every worker the engine started can be in flight at once:
        // that is what makes the concurrency measurable.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })

        if (failure !== null) {
          throw failure
        }

        input.onProgress(1)

        return { etag: options.etag === false ? null : `"etag-${partNumber}"` }
      } finally {
        calls.inFlight -= 1
      }
    },

    partUrls: async (input) => {
      calls.partUrls += 1

      return {
        ok: true,
        parts: input.partNumbers.map((partNumber) => ({
          partNumber,
          url: `https://bucket.r2.cloudflarestorage.com/fresh/${partNumber}`,
        })),
      }
    },

    complete: async () => {
      calls.complete += 1

      return { ok: true, fileId: FILE_ID }
    },

    confirm: async () => {
      calls.confirm += 1

      return { ok: true, fileId: FILE_ID }
    },

    abort: async () => {
      calls.abort += 1

      return { ok: true }
    },

    sleep: async (ms) => {
      calls.sleeps.push(ms)
    },
  }

  return { transport, calls, progress }
}

function source(sizeBytes: number, name = "course.pdf") {
  const ranges: { start: number; end: number }[] = []

  return {
    name,
    size: sizeBytes,
    ranges,
    slice: (start: number, end: number) => {
      ranges.push({ start, end })

      return { start, end }
    },
  }
}

describe("where a file is split", () => {
  it("uploads a file of exactly 100 MiB in one request", () => {
    expect(shouldUploadInParts(100 * MiB)).toBe(false)
  })

  it("splits a file one byte over 100 MiB", () => {
    expect(shouldUploadInParts(100 * MiB + 1)).toBe(true)
  })

  it("uploads the largest allowed file in one request", () => {
    // Every file the app accepts is under the multipart threshold, so the
    // 25 MB provider limit always takes the single-request path.
    expect(shouldUploadInParts(MAX_FILE_BYTES)).toBe(false)
  })

  it("splits a file above the multipart threshold", () => {
    const size = MULTIPART_THRESHOLD_BYTES + 1

    expect(shouldUploadInParts(size)).toBe(true)
    expect(partCount(size, PART_SIZE_BYTES)).toBe(7)
  })

  it("cuts the ranges so they cover the file exactly once", () => {
    const size = MULTIPART_THRESHOLD_BYTES + 1
    const total = partCount(size, PART_SIZE_BYTES)

    expect(partRange(size, PART_SIZE_BYTES, 1)).toEqual({ start: 0, end: PART_SIZE_BYTES })
    expect(partRange(size, PART_SIZE_BYTES, total).end).toBe(size)

    for (let partNumber = 2; partNumber <= total; partNumber += 1) {
      const previous = partRange(size, PART_SIZE_BYTES, partNumber - 1)
      const current = partRange(size, PART_SIZE_BYTES, partNumber)

      expect(current.start).toBe(previous.end)
    }
  })

  it("refuses a part number outside the file", () => {
    expect(() => partRange(1024, PART_SIZE_BYTES, 0)).toThrow(RangeError)
    expect(() => partRange(1024, PART_SIZE_BYTES, 2)).toThrow(RangeError)
    expect(() => partCount(0, PART_SIZE_BYTES)).toThrow(RangeError)
    expect(() => partCount(1024, 0)).toThrow(RangeError)
  })
})

describe("a single-request upload", () => {
  it("puts the whole file, then confirms it", async () => {
    const size = 5 * MiB
    const input = source(size)
    const test = harness({ sizeBytes: size, multipart: false })

    const outcome = await uploadFile({
      productId: "p",
      source: input,
      transport: test.transport,
      signal: new AbortController().signal,
      onProgress: (value) => test.progress.push({ ...value }),
    })

    expect(outcome).toEqual({ ok: true, fileId: FILE_ID })
    expect(test.calls.start).toBe(1)
    expect(test.calls.putObject).toBe(1)
    expect(test.calls.confirm).toBe(1)
    expect(test.calls.abort).toBe(0)
    expect(input.ranges).toEqual([{ start: 0, end: size }])
    expect(test.progress.at(-1)).toMatchObject({ loaded: size, total: size, ratio: 1 })
  })
})

describe("a multipart upload", () => {
  // The provider limit is 25 MB, below the production 100 MiB multipart
  // threshold, so no file the app accepts is big enough to be multipart at the
  // 16 MiB part size. The engine follows the plan the server returns, so these
  // tests drive it with a 6 MiB part size and files under the limit: the part
  // logic is the same, only the numbers are smaller.
  const PART = 6 * MiB

  it("never has more than three parts in flight", async () => {
    // 24 MiB is four 6 MiB parts, so the limit is reached.
    const test = harness({ sizeBytes: 24 * MiB, multipart: true, partSizeBytes: PART })

    const outcome = await uploadFile({
      productId: "p",
      source: source(24 * MiB),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(outcome.ok).toBe(true)
    expect(test.calls.putPart).toBe(4)
    expect(test.calls.complete).toBe(1)
    expect(UPLOAD_CONCURRENCY).toBe(3)
    expect(test.calls.maxInFlight).toBe(3)
  })

  it("sends every part once, with the ranges the plan implies", async () => {
    const size = 18 * MiB
    const input = source(size)
    const test = harness({ sizeBytes: size, multipart: true, partSizeBytes: PART })

    await uploadFile({
      productId: "p",
      source: input,
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(input.ranges).toEqual([
      { start: 0, end: PART },
      { start: PART, end: Math.min(PART * 2, size) },
      { start: Math.min(PART * 2, size), end: size },
    ])
  })

  it("adds up progress across parts", async () => {
    const size = 24 * MiB
    const test = harness({ sizeBytes: size, multipart: true, partSizeBytes: PART })

    await uploadFile({
      productId: "p",
      source: source(size),
      transport: test.transport,
      signal: new AbortController().signal,
      onProgress: (value) => test.progress.push({ ...value }),
    })

    const uploading = test.progress.filter((entry) => entry.status === "uploading")
    const loaded = uploading.map((entry) => entry.loaded)

    // Progress only ever moves forward, and ends at the whole file.
    for (let index = 1; index < loaded.length; index += 1) {
      expect(loaded[index] ?? 0).toBeGreaterThanOrEqual(loaded[index - 1] ?? 0)
    }

    expect(Math.max(...loaded)).toBe(size)
    expect(test.progress.at(-1)).toMatchObject({ status: "uploaded", loaded: size, ratio: 1 })
  })

  it("retries a part that fails, then carries on", async () => {
    const size = 12 * MiB
    const test = harness({
      sizeBytes: size,
      multipart: true,
      partSizeBytes: PART,
      fail: (partNumber, attempt) =>
        partNumber === 2 && attempt === 1
          ? new PartUploadError("The upload was interrupted.", { retryable: true })
          : null,
    })

    const outcome = await uploadFile({
      productId: "p",
      source: source(size),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(outcome.ok).toBe(true)
    expect(test.calls.putPart).toBe(3)
    expect(test.calls.sleeps).toEqual([500])
  })

  it("waits longer before each retry", async () => {
    const test = harness({
      sizeBytes: 12 * MiB,
      multipart: true,
      partSizeBytes: PART,
      fail: (partNumber, attempt) =>
        partNumber === 1 && attempt <= 3
          ? new PartUploadError("The upload timed out.", { retryable: true })
          : null,
    })

    await uploadFile({
      productId: "p",
      source: source(12 * MiB),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(test.calls.sleeps).toEqual([500, 1000, 2000])
  })

  it("gives up on a part that fails four times, and drops the reservation", async () => {
    const size = 12 * MiB
    const test = harness({
      sizeBytes: size,
      multipart: true,
      partSizeBytes: PART,
      fail: (partNumber) =>
        partNumber === 1
          ? new PartUploadError("The upload was interrupted.", { retryable: true })
          : null,
    })

    const outcome = await uploadFile({
      productId: "p",
      source: source(size),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? "" : outcome.reason).toBe("failed")
    expect(test.calls.partsAttempted.filter((part) => part === 1)).toHaveLength(PART_RETRIES + 1)
    expect(test.calls.abort).toBe(1)
    expect(test.calls.complete).toBe(0)
  })

  it("treats a part without an ETag as an error and does not retry it", async () => {
    const test = harness({ sizeBytes: 12 * MiB, multipart: true, partSizeBytes: PART, etag: false })

    const outcome = await uploadFile({
      productId: "p",
      source: source(12 * MiB),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? "" : outcome.message).toContain("ETag")
    expect(test.calls.partUrls).toBe(0)
    expect(test.calls.abort).toBe(1)
  })

  it("replaces a part URL that has expired before trying again", async () => {
    const test = harness({
      sizeBytes: 12 * MiB,
      multipart: true,
      partSizeBytes: PART,
      fail: (partNumber, attempt) =>
        partNumber === 1 && attempt === 1
          ? new PartUploadError("The upload link expired.", { retryable: true, expired: true })
          : null,
    })

    const outcome = await uploadFile({
      productId: "p",
      source: source(12 * MiB),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(outcome.ok).toBe(true)
    expect(test.calls.partUrls).toBe(1)
  })

  it("refuses a plan with more parts than the completion action accepts", async () => {
    // A plan with a 1 byte part size reaches the completion cap on a tiny file,
    // which is the only way to prove the guard while the provider limit is 25 MB.
    const size = 200
    const test = harness({ sizeBytes: size, multipart: true, partSizeBytes: 1 })

    const outcome = await uploadFile({
      productId: "p",
      source: source(size),
      transport: test.transport,
      signal: new AbortController().signal,
    })

    expect(partCount(size, 1)).toBeGreaterThan(MAX_COMPLETABLE_PARTS)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? "" : outcome.message).toContain("too large")
    expect(test.calls.putPart).toBe(0)
    expect(test.calls.abort).toBe(1)
  })
})

describe("cancel", () => {
  it("stops the upload and drops the reservation", async () => {
    const controller = new AbortController()
    const test = harness({
      sizeBytes: 24 * MiB,
      multipart: true,
      partSizeBytes: 6 * MiB,
      fail: (partNumber, attempt) => {
        if (partNumber === 1 && attempt === 1) {
          // The person presses Cancel while the first part is in flight.
          controller.abort()
        }

        return null
      },
    })

    const outcome = await uploadFile({
      productId: "p",
      source: source(24 * MiB),
      transport: test.transport,
      signal: controller.signal,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? "" : outcome.reason).toBe("cancelled")
    expect(test.calls.abort).toBe(1)
    expect(test.calls.complete).toBe(0)
  })

  it("does nothing at all when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const test = harness({ sizeBytes: 5 * MiB, multipart: false })
    const outcome = await uploadFile({
      productId: "p",
      source: source(5 * MiB),
      transport: test.transport,
      signal: controller.signal,
    })

    expect(outcome.ok ? "" : outcome.reason).toBe("cancelled")
    expect(test.calls.start).toBe(0)
    expect(test.calls.abort).toBe(0)
  })
})

describe("a file the client refuses before it reserves anything", () => {
  function refusal(name: string, size: number): Promise<string> {
    const test = harness({ sizeBytes: Math.max(size, 1), multipart: false })

    return uploadFile({
      productId: "p",
      source: source(size, name),
      transport: test.transport,
      signal: new AbortController().signal,
    }).then((outcome) => {
      expect(outcome.ok).toBe(false)
      expect(outcome.ok ? "" : outcome.reason).toBe("rejected")
      expect(test.calls.start).toBe(0)
      expect(test.calls.abort).toBe(0)

      return outcome.ok ? "" : outcome.message
    })
  }

  it("rejects an extension that is not allowed", async () => {
    await expect(refusal("setup.exe", 1024)).resolves.toBe(catalogErrorMessage("not_allowed_type"))
  })

  it("rejects an empty file", async () => {
    await expect(refusal("notes.pdf", 0)).resolves.toBe(catalogErrorMessage("empty_file"))
  })

  it("rejects a file over the 25 MB provider limit", async () => {
    await expect(refusal("huge.pdf", MAX_FILE_BYTES + 1)).resolves.toBe(catalogErrorMessage("too_large"))
  })

  it("rejects a double extension", async () => {
    await expect(refusal("invoice.pdf.exe", 1024)).resolves.toMatch(/file type|not allowed|name/i)
  })
})
