import { describe, expect, it, vi } from "vitest"

import {
  DOWNLOAD_URL_TTL_SECONDS,
  runQuarantineFile,
  runScanFile,
  runScanSweep,
  scanFileIdFromPayload,
  storageKeyFromPayload,
  SWEEP_BATCH,
  type ScanFileDependencies,
  type ScanFileInfo,
} from "./jobs"

// The scan jobs are pure functions over injected dependencies: the tests drive
// every branch without a network, a database or a bucket.

const FILE_ID = "20000000-0000-4000-8000-000000000001"
const SCAN_ID = "30000000-0000-4000-8000-000000000001"
const CALLBACK = "https://app.example.com/api/internal/scan-result"

const INFO: ScanFileInfo = {
  id: FILE_ID,
  productId: "10000000-0000-4000-8000-000000000001",
  storageKey: "products/p/f/guide.pdf",
  sizeBytes: 4096,
  extension: "pdf",
  status: "uploaded",
  scanStatus: "not_scanned",
}

function deps(overrides: Partial<ScanFileDependencies> = {}): ScanFileDependencies {
  return {
    getFileScanInfo: async () => INFO,
    requestFileScan: async () => SCAN_ID,
    markFileScanning: vi.fn(async () => undefined),
    recordScanError: vi.fn(async () => undefined),
    presignDownload: async () => "https://signed.example/1800",
    requestScan: async () => ({ ok: true }),
    callbackUrl: () => CALLBACK,
    ...overrides,
  }
}

describe("runScanFile", () => {
  it("requests a scan, then records that the scanner accepted it", async () => {
    const markFileScanning = vi.fn(async () => undefined)
    const requestScan = vi.fn(async () => ({ ok: true }) as const)
    const presignDownload = vi.fn(async () => "https://signed.example/1800")

    const outcome = await runScanFile(
      deps({ markFileScanning, requestScan, presignDownload }),
      FILE_ID,
    )

    expect(outcome).toBe("queued")

    expect(presignDownload).toHaveBeenCalledWith({
      key: INFO.storageKey,
      filename: `${FILE_ID}.pdf`,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    })

    expect(requestScan).toHaveBeenCalledWith({
      scanId: SCAN_ID,
      fileId: FILE_ID,
      downloadUrl: "https://signed.example/1800",
      expectedSizeBytes: INFO.sizeBytes,
      extension: "pdf",
      callbackUrl: CALLBACK,
    })

    expect(markFileScanning).toHaveBeenCalledWith(FILE_ID, SCAN_ID)
  })

  it("does nothing when the file no longer exists", async () => {
    const requestFileScan = vi.fn(async () => SCAN_ID)

    const outcome = await runScanFile(
      deps({ getFileScanInfo: async () => null, requestFileScan }),
      FILE_ID,
    )

    expect(outcome).toBe("skipped")
    expect(requestFileScan).not.toHaveBeenCalled()
  })

  it("does nothing for a file that is not uploaded yet", async () => {
    const outcome = await runScanFile(
      deps({ getFileScanInfo: async () => ({ ...INFO, status: "pending" }) }),
      FILE_ID,
    )

    expect(outcome).toBe("skipped")
  })

  it("does not rescan a file that is already infected or under review", async () => {
    for (const scanStatus of ["infected", "rejected", "needs_review", "scanning"]) {
      const requestFileScan = vi.fn(async () => SCAN_ID)

      const outcome = await runScanFile(
        deps({ getFileScanInfo: async () => ({ ...INFO, scanStatus }), requestFileScan }),
        FILE_ID,
      )

      expect(outcome).toBe("skipped")
      expect(requestFileScan).not.toHaveBeenCalled()
    }
  })

  it("scans an error file again, and a clean file for its weekly rescan", async () => {
    for (const scanStatus of ["error", "clean", "queued"]) {
      const outcome = await runScanFile(
        deps({ getFileScanInfo: async () => ({ ...INFO, scanStatus }) }),
        FILE_ID,
      )

      expect(outcome).toBe("queued")
    }
  })

  it("skips when the database refuses to move the file", async () => {
    const outcome = await runScanFile(
      deps({
        requestFileScan: async () => {
          throw { message: "bad_state" }
        },
      }),
      FILE_ID,
    )

    expect(outcome).toBe("skipped")
  })

  it("rethrows a retryable scanner failure, so the queue retries", async () => {
    const recordScanError = vi.fn(async () => undefined)

    await expect(
      runScanFile(
        deps({ requestScan: async () => ({ ok: false, retryable: true }), recordScanError }),
        FILE_ID,
      ),
    ).rejects.toThrow("The scanner did not accept the scan request")

    expect(recordScanError).not.toHaveBeenCalled()
  })

  it("records an error result for a request the scanner will never accept", async () => {
    const recordScanError = vi.fn(async () => undefined)
    const markFileScanning = vi.fn(async () => undefined)

    const outcome = await runScanFile(
      deps({
        requestScan: async () => ({ ok: false, retryable: false }),
        recordScanError,
        markFileScanning,
      }),
      FILE_ID,
    )

    expect(outcome).toBe("failed")
    expect(recordScanError).toHaveBeenCalledWith(FILE_ID, SCAN_ID)
    expect(markFileScanning).not.toHaveBeenCalled()
  })

  it("falls back to a .bin name when the file has no extension", async () => {
    const presignDownload = vi.fn(async () => "https://signed.example/1800")

    await runScanFile(
      deps({ getFileScanInfo: async () => ({ ...INFO, extension: "" }), presignDownload }),
      FILE_ID,
    )

    expect(presignDownload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `${FILE_ID}.bin` }),
    )
  })
})

describe("runScanSweep", () => {
  const DUE = [
    { fileId: "20000000-0000-4000-8000-000000000001", attempts: 0 },
    { fileId: "20000000-0000-4000-8000-000000000002", attempts: 3 },
  ]

  it("queues one scan_file job per due file, keyed by file and attempt", async () => {
    const enqueue = vi.fn(async () => "job-id")

    const result = await runScanSweep({ listDue: async () => DUE, enqueue })

    expect(result).toEqual({ due: 2, enqueued: 2 })

    expect(enqueue).toHaveBeenNthCalledWith(1, {
      type: "scan_file",
      payload: { fileId: "20000000-0000-4000-8000-000000000001" },
      dedupeKey: "scan_file:20000000-0000-4000-8000-000000000001:0",
    })

    expect(enqueue).toHaveBeenNthCalledWith(2, {
      type: "scan_file",
      payload: { fileId: "20000000-0000-4000-8000-000000000002" },
      dedupeKey: "scan_file:20000000-0000-4000-8000-000000000002:3",
    })
  })

  it("asks for one batch and queues nothing when nothing is due", async () => {
    const listDue = vi.fn(async () => [])
    const enqueue = vi.fn(async () => "job-id")

    expect(await runScanSweep({ listDue, enqueue })).toEqual({ due: 0, enqueued: 0 })
    expect(listDue).toHaveBeenCalledWith(SWEEP_BATCH)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("keeps going when one enqueue fails", async () => {
    const enqueue = vi
      .fn(async () => "job-id")
      .mockRejectedValueOnce(new Error("queue is down"))

    const result = await runScanSweep({ listDue: async () => DUE, enqueue })

    expect(result).toEqual({ due: 2, enqueued: 1 })
    expect(enqueue).toHaveBeenCalledTimes(2)
  })
})

describe("runQuarantineFile", () => {
  it("moves the object the payload names", async () => {
    const move = vi.fn(async () => ({ fromKey: "a", toKey: "quarantine/a" }))

    await runQuarantineFile({ move }, "products/p/f/guide.pdf")

    expect(move).toHaveBeenCalledWith("products/p/f/guide.pdf")
  })
})

describe("payload reading", () => {
  it("accepts only a uuid file id", () => {
    expect(scanFileIdFromPayload({ fileId: FILE_ID })).toBe(FILE_ID)
    expect(scanFileIdFromPayload({ fileId: "not-a-uuid" })).toBeNull()
    expect(scanFileIdFromPayload({})).toBeNull()
    expect(scanFileIdFromPayload({ fileId: 42 })).toBeNull()
  })

  it("accepts a non-empty storage key", () => {
    expect(storageKeyFromPayload({ storageKey: "a/b.pdf" })).toBe("a/b.pdf")
    expect(storageKeyFromPayload({ storageKey: "   " })).toBeNull()
    expect(storageKeyFromPayload({})).toBeNull()
  })
})
