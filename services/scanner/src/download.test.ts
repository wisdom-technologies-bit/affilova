import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DownloadFailure, downloadToFile, nodeFetch } from "#download"
import type { DownloadOptions, FetchLike, FetchResponse } from "#download"

const created: string[] = []

async function workDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "scanner-download-"))
  created.push(directory)

  return directory
}

afterEach(async () => {
  while (created.length > 0) {
    const directory = created.pop()

    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

function streamOf(chunks: ReadonlyArray<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function fakeResponse(
  chunks: ReadonlyArray<Uint8Array>,
  options: { status?: number; contentLength?: string | null } = {},
): FetchResponse {
  const status = options.status ?? 200
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const contentLength = options.contentLength === undefined ? String(total) : options.contentLength

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === "content-length" && contentLength !== null ? contentLength : null,
    },
    body: streamOf(chunks),
  }
}

function options(destination: string, overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    url: "https://bucket.r2.cloudflarestorage.com/object.pdf",
    destination,
    expectedSizeBytes: 11,
    maxBytes: 1024,
    fetch: async () => fakeResponse([encode("hello world")]),
    signal: new AbortController().signal,
    timeoutMs: 5000,
    ...overrides,
  }
}

async function failureOf(promise: Promise<unknown>): Promise<DownloadFailure> {
  try {
    await promise
  } catch (error) {
    if (error instanceof DownloadFailure) {
      return error
    }

    throw error
  }

  throw new Error("the download did not fail")
}

describe("downloadToFile", () => {
  it("writes the body to disk and returns its sha256", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const result = await downloadToFile(options(destination))

    expect(result.bytes).toBe(11)
    expect(result.sha256).toBe(createHash("sha256").update("hello world").digest("hex"))
    expect(await readFile(destination, "utf8")).toBe("hello world")
  })

  it("hashes across several chunks", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const result = await downloadToFile(
      options(destination, {
        fetch: async () => fakeResponse([encode("hello"), encode(" "), encode("world")]),
      }),
    )

    expect(await readFile(destination, "utf8")).toBe("hello world")
    expect(result.sha256).toBe(createHash("sha256").update("hello world").digest("hex"))
  })

  it("reports the sha256 of an empty file", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "empty.bin")

    const result = await downloadToFile(
      options(destination, { expectedSizeBytes: 0, fetch: async () => fakeResponse([]) }),
    )

    expect(result.bytes).toBe(0)
    expect(result.sha256).toBe(createHash("sha256").update("").digest("hex"))
  })

  it("rejects with size_mismatch when fewer bytes arrive than promised", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          expectedSizeBytes: 50,
          fetch: async () => fakeResponse([encode("hello world")]),
        }),
      ),
    )

    expect(failure.code).toBe("size_mismatch")
  })

  it("aborts with size_mismatch when more bytes arrive than promised", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          expectedSizeBytes: 4,
          fetch: async () => fakeResponse([encode("hello world")], { contentLength: null }),
        }),
      ),
    )

    expect(failure.code).toBe("size_mismatch")
  })

  it("aborts with size_mismatch when the file exceeds maxBytes", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          expectedSizeBytes: 11,
          maxBytes: 5,
          fetch: async () => fakeResponse([encode("hello world")], { contentLength: null }),
        }),
      ),
    )

    expect(failure.code).toBe("size_mismatch")
  })

  it("refuses a declared content length that is already too large", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          maxBytes: 5,
          fetch: async () => fakeResponse([encode("hello world")], { contentLength: "11" }),
        }),
      ),
    )

    expect(failure.code).toBe("size_mismatch")
    await expect(readFile(destination, "utf8")).rejects.toThrow()
  })

  it("rejects a non 2xx response", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          fetch: async () => fakeResponse([], { status: 403, contentLength: "0" }),
        }),
      ),
    )

    expect(failure.code).toBe("download_failed")
  })

  it("rejects when storage returns no body", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          fetch: async () => ({ ok: true, status: 200, headers: { get: () => "11" }, body: null }),
        }),
      ),
    )

    expect(failure.code).toBe("download_failed")
  })

  it("rejects a network failure", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const failure = await failureOf(
      downloadToFile(
        options(destination, {
          fetch: async () => {
            throw new Error("ECONNRESET")
          },
        }),
      ),
    )

    expect(failure.code).toBe("download_failed")
  })

  it("rejects with timeout when the transfer stalls", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    const stalling: FetchLike = (_url, init) =>
      new Promise<FetchResponse>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      })

    const failure = await failureOf(
      downloadToFile(options(destination, { fetch: stalling, timeoutMs: 20 })),
    )

    expect(failure.code).toBe("timeout")
  })

  it("rejects before starting when the caller already aborted", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")
    const controller = new AbortController()
    controller.abort()

    const failure = await failureOf(
      downloadToFile(options(destination, { signal: controller.signal })),
    )

    expect(failure.code).toBe("timeout")
  })

  it("rejects when the caller aborts mid transfer", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")
    const controller = new AbortController()

    const stalling: FetchLike = (_url, init) =>
      new Promise<FetchResponse>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      })

    setTimeout(() => {
      controller.abort()
    }, 10)

    const failure = await failureOf(
      downloadToFile(options(destination, { fetch: stalling, signal: controller.signal })),
    )

    expect(failure.code).toBe("download_failed")
  })

  it("never reuses an existing file", async () => {
    const directory = await workDirectory()
    const destination = join(directory, "object.bin")

    await writeFile(destination, "already here")

    const failure = await failureOf(downloadToFile(options(destination)))

    expect(failure.code).toBe("download_failed")
  })
})

describe("nodeFetch", () => {
  it("is the global fetch narrowed to the shapes this module uses", () => {
    expect(typeof nodeFetch).toBe("function")
  })
})
