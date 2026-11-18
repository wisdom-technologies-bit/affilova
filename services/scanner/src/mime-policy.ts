/**
 * Extension to detected-MIME policy.
 *
 * The app decides the extension; libmagic decides what the bytes really are. A
 * file passes when libmagic agrees with the extension, or (for container formats
 * libmagic reports imprecisely) when libmagic does not identify it as something
 * executable. Anything on the deny list is rejected as `executable_type` no
 * matter which extension it claims.
 */

export type MimeDetail = "type_mismatch" | "executable_type"

export type MimeDecision =
  | { readonly verdict: "ok" }
  | { readonly verdict: "rejected"; readonly detail: MimeDetail }

const ACCEPTED: MimeDecision = { verdict: "ok" }

/**
 * Types rejected for every extension: native executables, shared objects,
 * scripts, active web content and installable packages.
 */
export const DENIED_MIME_TYPES: readonly string[] = [
  "application/x-dosexec",
  "application/x-executable",
  "application/x-sharedlib",
  "application/x-pie-executable",
  "application/x-mach-binary",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "text/x-script.python",
  "text/html",
  "application/javascript",
  "text/javascript",
  "text/x-php",
  "application/x-elf",
  "application/java-archive",
  "application/vnd.android.package-archive",
]

const DENIED = new Set<string>(DENIED_MIME_TYPES)

/**
 * Extensions libmagic cannot separate reliably. For these the policy accepts any
 * detected type that is not denied, because rejecting on a guess would refuse
 * legitimate design and ebook files.
 */
const UNRELIABLE_EXTENSIONS: readonly string[] = ["mobi", "psd", "ai", "eps"]

const UNRELIABLE = new Set<string>(UNRELIABLE_EXTENSIONS)

const OPENXML_WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const OPENXML_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const OPENXML_PRESENTATION = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

/**
 * Acceptable detected types per extension. Every allowed upload extension
 * appears here.
 */
export const MIME_TABLE: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  epub: ["application/epub+zip", "application/zip"],
  zip: ["application/zip"],
  "7z": ["application/x-7z-compressed"],
  rar: ["application/vnd.rar", "application/x-rar"],
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  mp3: ["audio/mpeg"],
  wav: ["audio/x-wav", "audio/vnd.wave"],
  m4a: ["audio/mp4", "audio/x-m4a", "video/mp4"],
  docx: [OPENXML_WORD, "application/zip"],
  xlsx: [OPENXML_SHEET, "application/zip"],
  pptx: [OPENXML_PRESENTATION, "application/zip"],
  txt: ["text/plain", "text/csv"],
  csv: ["text/plain", "text/csv"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  ttf: ["font/sfnt", "font/ttf", "font/otf", "application/vnd.ms-opentype", "application/x-font-ttf"],
  otf: ["font/sfnt", "font/ttf", "font/otf", "application/vnd.ms-opentype", "application/x-font-ttf"],
}

/**
 * Every extension the service accepts, derived from the table so the two cannot
 * drift apart.
 */
export const ALLOWED_EXTENSIONS: readonly string[] = [...Object.keys(MIME_TABLE), ...UNRELIABLE_EXTENSIONS].sort()

const ALLOWED = new Set<string>(ALLOWED_EXTENSIONS)

/**
 * Extensions whose contents are archives and therefore need an archive policy
 * pass before ClamAV.
 */
export const ARCHIVE_EXTENSIONS: readonly string[] = ["zip", "7z", "rar", "docx", "xlsx", "pptx", "epub"]

const ARCHIVES = new Set<string>(ARCHIVE_EXTENSIONS)

export function isAllowedExtension(extension: string): boolean {
  return ALLOWED.has(extension.toLowerCase())
}

export function isArchiveExtension(extension: string): boolean {
  return ARCHIVES.has(extension.toLowerCase())
}

/**
 * Normalises libmagic output: lowercases and drops any `; charset=...` parameter.
 */
export function normaliseMime(detected: string): string {
  const withoutParameters = detected.split(";")[0]
  return withoutParameters.trim().toLowerCase()
}

/**
 * Applies the deny list, then the extension table.
 */
export function decideMime(extension: string, detectedMime: string): MimeDecision {
  const detected = normaliseMime(detectedMime)
  const ext = extension.trim().toLowerCase().replace(/^\./, "")

  if (DENIED.has(detected)) {
    return { verdict: "rejected", detail: "executable_type" }
  }

  if (UNRELIABLE.has(ext)) {
    return ACCEPTED
  }

  const acceptable = MIME_TABLE[ext]

  if (acceptable === undefined) {
    return { verdict: "rejected", detail: "type_mismatch" }
  }

  if (acceptable.includes(detected)) {
    return { verdict: "ok" }
  }

  return { verdict: "rejected", detail: "type_mismatch" }
}
