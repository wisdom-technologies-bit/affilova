// What a vendor may upload, and how the object key is built.
//
// The extension decides the content type. A browser's `File.type` is whatever
// the client says it is, so it is never read: an .exe renamed to .pdf is stored
// as application/pdf and can never be served as something executable.

/** 2 GiB: the largest single file. Mirrors the products.file size CHECK. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024

/** At most this many files per product. */
export const MAX_FILES_PER_PRODUCT = 10

/** 5 GiB of files per product, across all of its files. */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024

/** Above this size the browser uploads in parts. */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024

/** The size of one part. S3 requires at least 5 MiB for every part but the last. */
export const PART_SIZE_BYTES = 16 * 1024 * 1024

/** The longest sanitized file name that is kept. */
export const MAX_FILENAME_LENGTH = 120

/**
 * Allowed extension to content type. This is the only place a content type is
 * decided.
 */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  psd: "image/vnd.adobe.photoshop",
  ai: "application/postscript",
  eps: "application/postscript",
  ttf: "font/ttf",
  otf: "font/otf",
}

// An extension that is never allowed to be the inner half of a double extension.
// "report.pdf.exe" is refused by the extension check anyway; "invoice.exe.pdf"
// would otherwise look like a pdf.
const EXECUTABLE_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "cpl", "dll", "sys",
  "js", "jse", "mjs", "vbs", "vbe", "wsf", "wsh", "hta", "ps1", "psm1", "sh",
  "bash", "jar", "lnk", "reg", "apk", "app", "dmg", "iso", "html", "htm", "svg",
])

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

export type UploadRejectionCode =
  | "invalid_filename"
  | "empty_file"
  | "too_large"
  | "not_allowed_type"
  | "double_extension"

export type UploadValidation =
  | {
      ok: true
      sanitizedName: string
      extension: string
      contentType: string
    }
  | { ok: false; code: UploadRejectionCode }

/**
 * Make a file name safe to store and to show: drop any directory part, drop
 * control characters, drop leading dots (so nothing is hidden and no ".."
 * survives), collapse runs of spaces, and keep the extension while cutting the
 * rest to 120 characters.
 */
export function sanitizeFilename(name: string): string {
  // Both separators, because a Windows client can send either.
  const base = name.split(/[/\\]/).pop() ?? ""

  const cleaned = base
    .replace(CONTROL_CHARACTERS, "")
    // Leading dots: ".env" and ".." have no business here.
    .replace(/^[.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()

  if (cleaned.length <= MAX_FILENAME_LENGTH) {
    return cleaned
  }

  const dot = cleaned.lastIndexOf(".")
  const extension = dot > 0 ? cleaned.slice(dot) : ""
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned

  // The extension is kept whole so the file type is not lost to the cut.
  const room = Math.max(MAX_FILENAME_LENGTH - extension.length, 1)

  return `${stem.slice(0, room)}${extension}`.slice(0, MAX_FILENAME_LENGTH)
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")

  if (dot <= 0 || dot === name.length - 1) {
    return ""
  }

  return name.slice(dot + 1).toLowerCase()
}

/** True when an earlier part of a double extension is executable. */
function hasDangerousInnerExtension(name: string): boolean {
  const dot = name.lastIndexOf(".")

  if (dot <= 0) {
    return false
  }

  const stem = name.slice(0, dot)
  const inner = extensionOf(stem)

  return inner !== "" && EXECUTABLE_EXTENSIONS.has(inner)
}

/**
 * Check one upload before anything is reserved for it.
 *
 * The size is what the client claims; the real size is checked again against the
 * object after the upload (see confirmFileUploadAction), because a client can
 * lie about this field.
 */
export function validateUpload(input: { filename: string; sizeBytes: number }): UploadValidation {
  const sanitizedName = sanitizeFilename(input.filename)

  if (sanitizedName === "" || sanitizedName === "." || sanitizedName.includes("..")) {
    return { ok: false, code: "invalid_filename" }
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, code: "empty_file" }
  }

  if (input.sizeBytes > MAX_FILE_BYTES) {
    return { ok: false, code: "too_large" }
  }

  const extension = extensionOf(sanitizedName)

  if (extension === "") {
    return { ok: false, code: "not_allowed_type" }
  }

  const contentType = ALLOWED_FILE_TYPES[extension]

  if (!contentType) {
    return { ok: false, code: "not_allowed_type" }
  }

  if (hasDangerousInnerExtension(sanitizedName)) {
    return { ok: false, code: "double_extension" }
  }

  return { ok: true, sanitizedName, extension, contentType }
}

/**
 * Where the object lives: products/<product>/<file>/<name>.
 *
 * public.register_product_file() checks this prefix, so a row can never point at
 * an object belonging to another product.
 */
export function buildStorageKey(productId: string, fileId: string, sanitizedName: string): string {
  return `products/${productId}/${fileId}/${sanitizedName}`
}
