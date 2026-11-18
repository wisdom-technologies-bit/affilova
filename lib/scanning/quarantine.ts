import "server-only"

import { logger } from "@/lib/logger"
import { getR2Storage, type R2Storage } from "@/lib/storage/r2"

// Quarantine: an infected object is copied out of the way before the original is
// deleted.
//
// Copy first, delete second. If the copy fails, the original is still there and
// the job throws so the queue retries; if the delete fails, the copy exists and
// the retry finishes the move. An object is never deleted before a second copy
// of it exists.

/** Where a quarantined object lives. Keeping the original key makes it traceable. */
export function quarantineKey(storageKey: string): string {
  return `quarantine/${storageKey.replace(/^\/+/, "")}`
}

export type QuarantineStorage = Pick<R2Storage, "copyObject" | "deleteObject">

export interface QuarantineResult {
  fromKey: string
  toKey: string
}

/**
 * Move one object to the quarantine prefix and delete the original.
 *
 * Throws if either step fails, which is what makes the job retry. A file that
 * has already been moved simply copies again from a key that no longer exists
 * and fails, so the caller is expected to enqueue this once per infection.
 */
export async function moveToQuarantine(
  storageKey: string,
  storage: QuarantineStorage = getR2Storage(),
): Promise<QuarantineResult> {
  const toKey = quarantineKey(storageKey)

  await storage.copyObject({ fromKey: storageKey, toKey })
  await storage.deleteObject(storageKey)

  // The keys are safe to log: they are storage paths, not signed URLs.
  logger.info("scan_file_quarantined", { toKey })

  return { fromKey: storageKey, toKey }
}
