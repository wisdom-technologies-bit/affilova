/**
 * Archive policy: pure functions over a parsed `7z l -slt` listing.
 *
 * The listing is produced by 7-Zip one level deep, so nesting depth is read from
 * entry paths: a chain of archive files in a single entry path (`a.zip/b.zip`)
 * describes an archive inside an archive. Anything the policy cannot evaluate is
 * a `needs_review` rather than a silent pass.
 */

export type ArchiveEntry = {
  readonly path: string
  readonly size: number
  readonly packedSize: number
  readonly encrypted: boolean
  readonly isDirectory: boolean
  readonly isSymlink: boolean
  readonly type: string
}

export type ArchiveListing = {
  readonly entries: readonly ArchiveEntry[]
  readonly totalSize: number
  readonly totalPackedSize: number
}

export type ArchiveDetail =
  | "encrypted_archive"
  | "archive_limits"
  | "path_traversal"
  | "symlink"
  | "archive_contains_executable"
  | "archive_unlistable"

export type ArchiveDecision =
  | { readonly verdict: "ok" }
  | { readonly verdict: "rejected"; readonly detail: ArchiveDetail }
  | { readonly verdict: "needs_review"; readonly detail: ArchiveDetail }

export const MAX_ENTRIES = 10_000
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
export const MAX_COMPRESSION_RATIO = 1000
export const MAX_NESTING_DEPTH = 3

/**
 * Extensions treated as "an archive inside an archive" when they appear as a
 * leading path segment.
 */
const NESTED_ARCHIVE_EXTENSIONS: readonly string[] = ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]

/**
 * Entry names ending in one of these need a human look, whether or not ClamAV
 * recognises them.
 */
const EXECUTABLE_EXTENSIONS: readonly string[] = [
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "vbs",
  "ps1",
  "jar",
  "apk",
  "dll",
  "sh",
  "app",
  "dmg",
  "js",
  "so",
  "pkg",
]

const LISTING_SEPARATOR = /^-{10,}$/

const DRIVE_LETTER = /^[a-z]:/i

function toNumber(raw: string | undefined): number {
  if (raw === undefined) {
    return 0
  }

  const value = Number(raw.trim())

  return Number.isFinite(value) ? value : 0
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

function parseFields(block: string[]): Map<string, string> {
  const fields = new Map<string, string>()

  for (const line of block) {
    const separator = line.indexOf(" = ")

    if (separator <= 0) {
      continue
    }

    fields.set(line.slice(0, separator).trim(), line.slice(separator + 3).trim())
  }

  return fields
}

function isSymlinkType(type: string): boolean {
  return type.toLowerCase().includes("symbolic link")
}

function buildEntry(fields: Map<string, string>): ArchiveEntry | null {
  const path = fields.get("Path")

  if (path === undefined || path === "") {
    return null
  }

  const type = fields.get("Type") ?? ""
  const attributes = fields.get("Attributes") ?? ""
  const method = fields.get("Method") ?? ""
  const folder = fields.get("Folder") ?? ""
  const symbolicLink = fields.get("Symbolic Link") ?? ""

  return {
    path,
    size: toNumber(fields.get("Size")),
    packedSize: toNumber(fields.get("Packed Size")),
    encrypted: fields.get("Encrypted") === "+" || /aes/i.test(method),
    isDirectory: folder === "+" || type.toLowerCase() === "directory" || path.endsWith("/") || attributes.startsWith("D"),
    isSymlink: isSymlinkType(type) || symbolicLink !== "" || attributes.startsWith("l"),
    type,
  }
}

/**
 * Parses `7z l -slt` output. Returns null when the output does not look like a
 * listing at all, which the caller maps to `archive_unlistable`.
 *
 * The header block (archive metadata) sits before the dashed separator; only the
 * entry blocks after it are returned.
 */
export function parseSevenZipListing(stdout: string): ArchiveListing | null {
  const lines = splitLines(stdout)
  const separatorIndex = lines.findIndex((line) => LISTING_SEPARATOR.test(line.trim()))

  if (separatorIndex < 0) {
    return null
  }

  const body = lines.slice(separatorIndex + 1)
  const blocks: string[][] = []
  let current: string[] = []

  for (const line of body) {
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current)
        current = []
      }

      continue
    }

    current.push(line)
  }

  if (current.length > 0) {
    blocks.push(current)
  }

  const entries: ArchiveEntry[] = []

  for (const block of blocks) {
    const entry = buildEntry(parseFields(block))

    if (entry !== null) {
      entries.push(entry)
    }
  }

  let totalSize = 0
  let totalPackedSize = 0

  for (const entry of entries) {
    totalSize += entry.size
    totalPackedSize += entry.packedSize
  }

  return { entries, totalSize, totalPackedSize }
}

/**
 * Splits an entry path into segments, normalising Windows separators.
 */
function segments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter((segment) => segment !== "")
}

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()

  return extensions.some((extension) => lower.endsWith(`.${extension}`))
}

/**
 * `../` anywhere, a leading `/`, a leading `\` or a drive letter means the entry
 * escapes the extraction root.
 */
export function hasPathTraversal(path: string): boolean {
  const normalised = path.replace(/\\/g, "/")

  if (normalised.startsWith("/") || normalised.startsWith("\\")) {
    return true
  }

  if (DRIVE_LETTER.test(normalised)) {
    return true
  }

  return normalised.split("/").some((segment) => segment === "..")
}

/**
 * Counts the leading path segments that are themselves archives, so
 * `a.zip/b.zip/c.zip` is three levels deep.
 */
function nestingDepth(path: string): number {
  let depth = 0

  for (const segment of segments(path)) {
    if (!hasExtension(segment, NESTED_ARCHIVE_EXTENSIONS)) {
      break
    }

    depth += 1
  }

  return depth
}

function compressionRatio(listing: ArchiveListing): number {
  if (listing.totalPackedSize > 0) {
    return listing.totalSize / listing.totalPackedSize
  }

  return listing.totalSize > 0 ? Number.POSITIVE_INFINITY : 0
}

/**
 * Applies the archive rules in order. The first rule that fires decides.
 *
 * `null` (the archive could not be listed, for example a RAR variant 7-Zip
 * cannot read) is a `needs_review`, never a pass.
 */
export function decideArchiveListing(listing: ArchiveListing | null): ArchiveDecision {
  if (listing === null) {
    return { verdict: "needs_review", detail: "archive_unlistable" }
  }

  if (listing.entries.length > MAX_ENTRIES) {
    return { verdict: "rejected", detail: "archive_limits" }
  }

  for (const entry of listing.entries) {
    if (entry.encrypted) {
      return { verdict: "rejected", detail: "encrypted_archive" }
    }
  }

  for (const entry of listing.entries) {
    if (hasPathTraversal(entry.path)) {
      return { verdict: "rejected", detail: "path_traversal" }
    }
  }

  for (const entry of listing.entries) {
    if (entry.isSymlink) {
      return { verdict: "rejected", detail: "symlink" }
    }
  }

  if (listing.totalSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    return { verdict: "rejected", detail: "archive_limits" }
  }

  if (compressionRatio(listing) > MAX_COMPRESSION_RATIO) {
    return { verdict: "rejected", detail: "archive_limits" }
  }

  for (const entry of listing.entries) {
    if (nestingDepth(entry.path) > MAX_NESTING_DEPTH) {
      return { verdict: "rejected", detail: "archive_limits" }
    }
  }

  for (const entry of listing.entries) {
    const name = segments(entry.path).pop() ?? entry.path

    if (hasExtension(name, EXECUTABLE_EXTENSIONS)) {
      return { verdict: "needs_review", detail: "archive_contains_executable" }
    }
  }

  return { verdict: "ok" }
}
