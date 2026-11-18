import { describe, expect, it, vi } from "vitest"

import { moveToQuarantine, quarantineKey } from "./quarantine"

// The quarantine move is tested with a fake storage, so the order of the two
// calls (copy first, delete second) is what is being asserted: the original must
// never be deleted before a second copy exists.

const KEY = "files/6af4/vendor/product/9f1c2d3e-file.pdf"

function fakeStorage(options: { copyError?: Error; deleteError?: Error } = {}) {
  const calls: string[] = []

  const storage = {
    copyObject: vi.fn(async () => {
      calls.push("copy")

      if (options.copyError) {
        throw options.copyError
      }
    }),
    deleteObject: vi.fn(async () => {
      calls.push("delete")

      if (options.deleteError) {
        throw options.deleteError
      }
    }),
  }

  return { storage, calls }
}

describe("quarantineKey", () => {
  it("puts the object under the quarantine prefix, keeping its path", () => {
    expect(quarantineKey(KEY)).toBe(`quarantine/${KEY}`)
  })

  it("does not produce a double slash for a key that starts with one", () => {
    expect(quarantineKey(`/${KEY}`)).toBe(`quarantine/${KEY}`)
  })
})

describe("moveToQuarantine", () => {
  it("copies the object, then deletes the original", async () => {
    const { storage, calls } = fakeStorage()

    const result = await moveToQuarantine(KEY, storage)

    expect(result).toEqual({ fromKey: KEY, toKey: `quarantine/${KEY}` })
    expect(calls).toEqual(["copy", "delete"])
    expect(storage.copyObject).toHaveBeenCalledWith({
      fromKey: KEY,
      toKey: `quarantine/${KEY}`,
    })
    expect(storage.deleteObject).toHaveBeenCalledWith(KEY)
  })

  it("leaves the original alone when the copy fails", async () => {
    const { storage } = fakeStorage({ copyError: new Error("storage is down") })

    await expect(moveToQuarantine(KEY, storage)).rejects.toThrow("storage is down")
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("reports a failed delete, so the job is retried", async () => {
    const { storage, calls } = fakeStorage({ deleteError: new Error("storage is down") })

    await expect(moveToQuarantine(KEY, storage)).rejects.toThrow("storage is down")
    // The copy already exists, so a retry only has to finish the move.
    expect(calls).toEqual(["copy", "delete"])
  })
})
