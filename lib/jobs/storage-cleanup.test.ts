import { describe, expect, it, vi } from "vitest"

import {
  runStorageCleanup,
  STALE_AFTER,
  STORAGE_CLEANUP_BATCH,
  type StaleFile,
} from "./storage-cleanup"

function file(index: number, uploadId: string | null = null): StaleFile {
  return {
    id: `file-${index}`,
    storageKey: `products/p/file-${index}/guide.pdf`,
    multipartUploadId: uploadId,
  }
}

function recorder(files: StaleFile[]) {
  const deleted: string[] = []
  const aborted: string[] = []
  const purged: string[] = []

  return {
    deleted,
    aborted,
    purged,
    deps: {
      listStale: async () => files,
      purge: async (id: string) => {
        purged.push(id)
      },
      storage: {
        deleteObject: async (key: string) => {
          deleted.push(key)
        },
        abortMultipartUpload: async (input: { key: string; uploadId: string }) => {
          aborted.push(input.uploadId)
        },
      },
    },
  }
}

describe("the sweep", () => {
  it("works in batches of fifty and clears old reservations", () => {
    expect(STORAGE_CLEANUP_BATCH).toBe(50)
    expect(STALE_AFTER).toBe("24 hours")
  })

  it("deletes the object, then the row", async () => {
    const { deps, deleted, purged } = recorder([file(1), file(2)])

    const counts = await runStorageCleanup(deps)

    expect(counts).toEqual({ checked: 2, purged: 2, failed: 0 })
    expect(deleted).toEqual(["products/p/file-1/guide.pdf", "products/p/file-2/guide.pdf"])
    expect(purged).toEqual(["file-1", "file-2"])
  })

  it("aborts an open multipart upload first", async () => {
    const { deps, deleted, aborted, purged } = recorder([file(1, "upload-123")])

    await runStorageCleanup(deps)

    expect(aborted).toEqual(["upload-123"])
    expect(deleted).toEqual(["products/p/file-1/guide.pdf"])
    expect(purged).toEqual(["file-1"])
  })

  it("processes every file across batches", async () => {
    const files = Array.from({ length: 5 }, (_, index) => file(index))

    const { deps, purged } = recorder(files)

    const counts = await runStorageCleanup({ ...deps, batchSize: 2 })

    expect(counts.purged).toBe(5)
    expect(purged).toHaveLength(5)
  })

  it("does nothing when there is nothing stale", async () => {
    const { deps, deleted, purged } = recorder([])

    await expect(runStorageCleanup(deps)).resolves.toEqual({ checked: 0, purged: 0, failed: 0 })
    expect(deleted).toHaveLength(0)
    expect(purged).toHaveLength(0)
  })
})

describe("failures", () => {
  it("keeps the row when the object could not be deleted", async () => {
    const purged: string[] = []

    const counts = await runStorageCleanup({
      listStale: async () => [file(1)],
      purge: async (id: string) => {
        purged.push(id)
      },
      storage: {
        deleteObject: async () => {
          throw new Error("storage is down")
        },
        abortMultipartUpload: async () => undefined,
      },
    })

    expect(counts).toEqual({ checked: 1, purged: 0, failed: 1 })
    expect(purged).toHaveLength(0)
  })

  it("carries on after one file fails", async () => {
    const purged: string[] = []

    const counts = await runStorageCleanup({
      listStale: async () => [file(1), file(2)],
      purge: async (id: string) => {
        purged.push(id)
      },
      storage: {
        deleteObject: async (key: string) => {
          if (key.includes("file-1")) {
            throw new Error("no")
          }
        },
        abortMultipartUpload: async () => undefined,
      },
    })

    expect(counts).toEqual({ checked: 2, purged: 1, failed: 1 })
    expect(purged).toEqual(["file-2"])
  })

  it("counts a failed purge but keeps the object gone", async () => {
    const counts = await runStorageCleanup({
      listStale: async () => [file(1)],
      purge: async () => {
        throw new Error("database is down")
      },
      storage: {
        deleteObject: async () => undefined,
        abortMultipartUpload: async () => undefined,
      },
    })

    expect(counts).toEqual({ checked: 1, purged: 0, failed: 1 })
  })

  it("still clears the object when aborting the upload fails", async () => {
    const deleted: string[] = []
    const purged: string[] = []

    const counts = await runStorageCleanup({
      listStale: async () => [file(1, "upload-123")],
      purge: async (id: string) => {
        purged.push(id)
      },
      storage: {
        deleteObject: async (key: string) => {
          deleted.push(key)
        },
        abortMultipartUpload: async () => {
          throw new Error("already completed")
        },
      },
    })

    expect(counts).toEqual({ checked: 1, purged: 1, failed: 0 })
    expect(deleted).toHaveLength(1)
    expect(purged).toEqual(["file-1"])
  })

  it("lets a failure to list the stale files surface", async () => {
    await expect(
      runStorageCleanup({
        listStale: async () => {
          throw new Error("Could not list stale pending files")
        },
        purge: async () => undefined,
        storage: {
          deleteObject: async () => undefined,
          abortMultipartUpload: async () => undefined,
        },
      }),
    ).rejects.toThrow("Could not list stale pending files")
  })
})

describe("logging", () => {
  it("writes nothing while it works", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const { deps } = recorder([file(1, "upload-123")])

    await runStorageCleanup(deps)

    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    log.mockRestore()
    warn.mockRestore()
  })
})
