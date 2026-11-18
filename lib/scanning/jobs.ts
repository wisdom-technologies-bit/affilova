import "server-only"

import { getPublicEnv } from "@/lib/env"
import { logger } from "@/lib/logger"
import { requestScan, type ScanRequestInput, type ScanRequestResult } from "@/lib/scanning/client"
import { moveToQuarantine } from "@/lib/scanning/quarantine"
import { asRecord, readNumber, readString } from "@/lib/catalog/rows"
import { enqueueJob } from "@/lib/jobs/queue"
import type { JobPayload } from "@/lib/jobs/types"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { getR2Storage } from "@/lib/storage/r2"

// The three scan jobs. Each is written as a pure function over injected
// dependencies so the tests exercise the real decisions without a network, a
// database or a bucket; the small `run...Job` wrappers at the bottom wire in
// the real clients.
//
// The five attempts a file gets are counted in the database (scan_attempts),
// which is why the sweep stops offering a file after five: a file that fails
// five times is an operational problem, not something another retry fixes.

/** How many files one sweep asks about. */
export const SWEEP_BATCH = 50

/** A presigned download URL the scanner can fetch from, in seconds. */
export const DOWNLOAD_URL_TTL_SECONDS = 1800

/** The scan states a scan_file job is allowed to act on. */
const SCANNABLE_STATUSES: readonly string[] = ["not_scanned", "queued", "error", "clean"]

export interface ScanFileInfo {
  id: string
  productId: string
  storageKey: string
  sizeBytes: number
  extension: string
  /** The file's own status: only an 'uploaded' file has bytes to scan. */
  status: string
  scanStatus: string
}

export interface ScanFileDependencies {
  getFileScanInfo: (fileId: string) => Promise<ScanFileInfo | null>
  requestFileScan: (fileId: string) => Promise<string>
  markFileScanning: (fileId: string, scanId: string) => Promise<void>
  recordScanError: (fileId: string, scanId: string) => Promise<void>
  presignDownload: (input: {
    key: string
    filename: string
    expiresInSeconds: number
  }) => Promise<string>
  requestScan: (input: ScanRequestInput) => Promise<ScanRequestResult>
  callbackUrl: () => string
}

export type ScanFileOutcome = "queued" | "skipped" | "failed"

/** A short, fixed error the queue can store. Never a URL or a secret. */
export class ScanJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScanJobError"
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message

    if (typeof message === "string" && message.trim() !== "") {
      return message.trim()
    }
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error.trim()
  }

  return null
}

/**
 * Ask the scanner to scan one file.
 *
 * A retryable failure throws, so the queue retries with backoff. A
 * non-retryable failure (400 or 401) records an 'error' result instead: the
 * file is then picked up by the sweep later, which is where a fixed scanner
 * configuration gets a chance to prove itself.
 */
export async function runScanFile(
  deps: ScanFileDependencies,
  fileId: string,
): Promise<ScanFileOutcome> {
  const info = await deps.getFileScanInfo(fileId)

  if (info === null) {
    // The file was deleted, or the product was.
    return "skipped"
  }

  if (info.status !== "uploaded" || !SCANNABLE_STATUSES.includes(info.scanStatus)) {
    // Pending files have no bytes yet; a file under manual review, or one
    // already found bad, must not be handed to the scanner again.
    return "skipped"
  }

  let scanId: string

  try {
    scanId = await deps.requestFileScan(fileId)
  } catch (error) {
    const code = errorCode(error)

    if (code === "not_found" || code === "bad_state") {
      return "skipped"
    }

    throw new ScanJobError("Could not record the scan request")
  }

  if (scanId === "") {
    throw new ScanJobError("Could not record the scan request")
  }

  const extension = info.extension === "" ? "bin" : info.extension
  const downloadUrl = await deps.presignDownload({
    key: info.storageKey,
    filename: `${info.id}.${extension}`,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  })

  const result = await deps.requestScan({
    scanId,
    fileId,
    downloadUrl,
    expectedSizeBytes: info.sizeBytes,
    extension,
    callbackUrl: deps.callbackUrl(),
  })

  if (result.ok) {
    await deps.markFileScanning(fileId, scanId)

    return "queued"
  }

  if (result.retryable) {
    throw new ScanJobError("The scanner did not accept the scan request")
  }

  await deps.recordScanError(fileId, scanId)

  return "failed"
}

export interface DueFile {
  fileId: string
  /** The file's attempt count, used in the de-duplication key. */
  attempts: number
}

export interface ScanSweepDependencies {
  listDue: (limit: number) => Promise<DueFile[]>
  enqueue: (input: { type: string; payload: JobPayload; dedupeKey: string }) => Promise<string>
}

export interface ScanSweepResult {
  due: number
  enqueued: number
}

/**
 * Queue a scan for every file the database says is due.
 *
 * The de-duplication key carries the attempt count, so a sweep that runs while
 * an earlier job for the same file is still queued does not pile up: the
 * database hands back the job that already exists.
 */
export async function runScanSweep(
  deps: ScanSweepDependencies,
  limit: number = SWEEP_BATCH,
): Promise<ScanSweepResult> {
  const due = await deps.listDue(limit)
  let enqueued = 0

  for (const file of due) {
    try {
      await deps.enqueue({
        type: "scan_file",
        payload: { fileId: file.fileId },
        dedupeKey: `scan_file:${file.fileId}:${file.attempts}`,
      })

      enqueued += 1
    } catch {
      // One file that cannot be queued must not stop the rest of the sweep.
      logger.error("scan_sweep_enqueue_failed", { fileId: file.fileId })
    }
  }

  return { due: due.length, enqueued }
}

export interface QuarantineDependencies {
  move: (storageKey: string) => Promise<unknown>
}

/** Move one infected object into quarantine. Throws so the queue retries. */
export async function runQuarantineFile(
  deps: QuarantineDependencies,
  storageKey: string,
): Promise<void> {
  await deps.move(storageKey)
}

// ---------------------------------------------------------------------------
// Payload reading
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readUuid(payload: JobPayload, key: string): string | null {
  const value = payload[key]

  return typeof value === "string" && UUID.test(value) ? value : null
}

export function scanFileIdFromPayload(payload: JobPayload): string | null {
  return readUuid(payload, "fileId")
}

export function storageKeyFromPayload(payload: JobPayload): string | null {
  const value = payload.storageKey

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()

  return trimmed === "" ? null : trimmed
}

// ---------------------------------------------------------------------------
// The real clients
// ---------------------------------------------------------------------------

function toScanFileInfo(row: unknown): ScanFileInfo | null {
  const record = asRecord(row)

  if (record === null) {
    return null
  }

  const id = readString(record, "id")
  const productId = readString(record, "product_id")
  const storageKey = readString(record, "storage_key")
  const status = readString(record, "status")
  const scanStatus = readString(record, "scan_status")

  if (id === null || productId === null || storageKey === null || status === null || scanStatus === null) {
    return null
  }

  return {
    id,
    productId,
    storageKey,
    sizeBytes: readNumber(record, "size_bytes") ?? 0,
    extension: readString(record, "extension") ?? "",
    status,
    scanStatus,
  }
}

function callbackUrl(): string {
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL

  return new URL("/api/internal/scan-result", appUrl).toString()
}

/** The handler the queue calls for one file. */
export async function runScanFileJob(payload: JobPayload): Promise<void> {
  const fileId = scanFileIdFromPayload(payload)

  if (fileId === null) {
    throw new ScanJobError("The scan_file job has no file id")
  }

  const supabase = getSupabaseAdminClient()
  const storage = getR2Storage()

  await runScanFile(
    {
      getFileScanInfo: async (id) => {
        const { data, error } = await supabase.rpc("get_file_scan_info", { p_file: id })

        if (error) {
          throw new ScanJobError("Could not read the file")
        }

        const rows = Array.isArray(data) ? data : []

        return rows.length === 0 ? null : toScanFileInfo(rows[0])
      },
      requestFileScan: async (id) => {
        const { data, error } = await supabase.rpc("request_file_scan", { p_file: id })

        if (error) {
          throw error
        }

        return typeof data === "string" ? data : ""
      },
      markFileScanning: async (id, scanId) => {
        const { error } = await supabase.rpc("mark_file_scanning", {
          p_file: id,
          p_scan: scanId,
        })

        if (error) {
          throw new ScanJobError("Could not record the scan state")
        }
      },
      recordScanError: async (id, scanId) => {
        const { error } = await supabase.rpc("record_scan_result", {
          p_scan: scanId,
          p_file: id,
          p_verdict: "error",
          p_detail: "scanner_error",
          p_sha256: null,
          p_detected_mime: null,
          p_engine: null,
          p_signature_version: null,
        })

        if (error) {
          throw new ScanJobError("Could not record the scan result")
        }
      },
      presignDownload: (input) => storage.presignGetUrl(input),
      requestScan: (input) => requestScan(input),
      callbackUrl,
    },
    fileId,
  )
}

/** The handler the queue calls for the sweep. */
export async function runScanSweepJob(): Promise<void> {
  const supabase = getSupabaseAdminClient()

  const result = await runScanSweep({
    listDue: async (limit) => {
      const { data, error } = await supabase.rpc("list_files_due_for_scan", { p_limit: limit })

      if (error) {
        throw new ScanJobError("Could not list files due for a scan")
      }

      const ids: string[] = []

      for (const row of Array.isArray(data) ? data : []) {
        const record = asRecord(row)
        const id = record === null ? null : readString(record, "file_id")

        if (id !== null && UUID.test(id)) {
          ids.push(id)
        }
      }

      if (ids.length === 0) {
        return []
      }

      // The function returns ids only. The attempt count is read here because
      // the queue's de-duplication key is built from it.
      const attempts = await supabase
        .from("product_files")
        .select("id, scan_attempts")
        .in("id", ids)

      if (attempts.error) {
        throw new ScanJobError("Could not read the scan attempt count")
      }

      const byId = new Map<string, number>()

      for (const row of Array.isArray(attempts.data) ? attempts.data : []) {
        const record = asRecord(row)

        if (record === null) {
          continue
        }

        const id = readString(record, "id")

        if (id !== null) {
          byId.set(id, readNumber(record, "scan_attempts") ?? 0)
        }
      }

      return ids.map((fileId) => ({ fileId, attempts: byId.get(fileId) ?? 0 }))
    },
    enqueue: enqueueJob,
  })

  logger.info("scan_sweep_finished", { due: result.due, enqueued: result.enqueued })
}

/** The handler the queue calls to move an infected object. */
export async function runQuarantineFileJob(payload: JobPayload): Promise<void> {
  const storageKey = storageKeyFromPayload(payload)

  if (storageKey === null) {
    throw new ScanJobError("The quarantine_file job has no storage key")
  }

  await runQuarantineFile({ move: (key) => moveToQuarantine(key) }, storageKey)
}
