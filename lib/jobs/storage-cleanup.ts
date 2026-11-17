import { asRecord, readString } from "@/lib/catalog/rows"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { getR2Storage, type R2Storage } from "@/lib/storage/r2"

// Removes the reservations that never became uploads.
//
// A vendor that starts an upload and closes the tab leaves a promise: a row in
// product_files and, for a large file, an open multipart upload with parts
// already paid for in storage. Neither is visible to anyone, and both cost
// money and count against the product's file budget, so this sweep clears them
// once a day.

/** Work this many files at a time, so one slow object does not stall the sweep. */
export const STORAGE_CLEANUP_BATCH = 50

/** A reservation older than this is treated as abandoned. */
export const STALE_AFTER = "24 hours"

export type StaleFile = {
  id: string
  storageKey: string
  multipartUploadId: string | null
}

export type StorageCleanupCounts = {
  checked: number
  purged: number
  failed: number
}

export interface StorageCleanupDependencies {
  listStale: () => Promise<StaleFile[]>
  purge: (id: string) => Promise<void>
  storage: Pick<R2Storage, "abortMultipartUpload" | "deleteObject">
  batchSize?: number
}

/**
 * Clear every stale reservation. A file is only purged once its object is gone,
 * so a storage outage leaves the row in place for the next sweep instead of
 * orphaning an object nobody can find.
 */
export async function runStorageCleanup(
  deps: StorageCleanupDependencies,
): Promise<StorageCleanupCounts> {
  const batchSize = deps.batchSize ?? STORAGE_CLEANUP_BATCH
  const stale = await deps.listStale()

  const counts: StorageCleanupCounts = { checked: stale.length, purged: 0, failed: 0 }

  for (let start = 0; start < stale.length; start += batchSize) {
    const batch = stale.slice(start, start + batchSize)

    for (const file of batch) {
      if (file.multipartUploadId !== null) {
        try {
          await deps.storage.abortMultipartUpload({
            key: file.storageKey,
            uploadId: file.multipartUploadId,
          })
        } catch {
          // An upload that already completed or expired cannot be aborted. The
          // object delete below still decides whether the row may go, so this is
          // not counted as a failure.
        }
      }

      try {
        // R2 treats deleting a missing key as success, so this is safe to repeat.
        await deps.storage.deleteObject(file.storageKey)
      } catch {
        counts.failed += 1
        continue
      }

      try {
        await deps.purge(file.id)
        counts.purged += 1
      } catch {
        // The object is gone but the row is not. Purging is idempotent, so the
        // next sweep finishes the job.
        counts.failed += 1
      }
    }
  }

  return counts
}

function toStaleFile(row: unknown): StaleFile | null {
  const record = asRecord(row)

  if (record === null) {
    return null
  }

  const id = readString(record, "id")
  const storageKey = readString(record, "storage_key")

  if (id === null || storageKey === null) {
    return null
  }

  const uploadId = readString(record, "multipart_upload_id")

  return { id, storageKey, multipartUploadId: uploadId === "" ? null : uploadId }
}

/** The handler the queue calls. */
export async function runStorageCleanupJob(): Promise<void> {
  const supabase = getSupabaseAdminClient()
  const storage = getR2Storage()

  await runStorageCleanup({
    listStale: async () => {
      const { data, error } = await supabase.rpc("list_stale_pending_files", {
        p_older_than: STALE_AFTER,
      })

      if (error) {
        throw new Error("Could not list stale pending files")
      }

      const files: StaleFile[] = []

      for (const row of Array.isArray(data) ? data : []) {
        const file = toStaleFile(row)

        if (file !== null) {
          files.push(file)
        }
      }

      return files
    },
    purge: async (id) => {
      const { error } = await supabase.rpc("purge_pending_file", { p_id: id })

      if (error) {
        throw new Error("Could not purge a pending file")
      }
    },
    storage,
  })
}
