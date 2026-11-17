import { describe, expect, it } from "vitest"

import {
  ALLOWED_FILE_TYPES,
  buildStorageKey,
  MAX_FILE_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_FILES_PER_PRODUCT,
  MAX_TOTAL_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PART_SIZE_BYTES,
  sanitizeFilename,
  validateUpload,
} from "./files"

describe("the limits", () => {
  it("are the ones the database enforces", () => {
    expect(MAX_FILE_BYTES).toBe(2_147_483_648)
    expect(MAX_FILES_PER_PRODUCT).toBe(10)
    expect(MAX_TOTAL_BYTES).toBe(5 * 1024 * 1024 * 1024)
    expect(MULTIPART_THRESHOLD_BYTES).toBe(100 * 1024 * 1024)
    expect(PART_SIZE_BYTES).toBe(16 * 1024 * 1024)
  })
})

describe("ALLOWED_FILE_TYPES", () => {
  it("covers every listed extension with a canonical type", () => {
    expect(Object.keys(ALLOWED_FILE_TYPES).sort()).toEqual(
      [
        "7z", "ai", "csv", "docx", "epub", "eps", "jpeg", "jpg", "m4a", "mobi",
        "mov", "mp3", "mp4", "otf", "pdf", "png", "pptx", "psd", "rar", "ttf",
        "txt", "wav", "xlsx", "zip",
      ].sort(),
    )

    for (const [extension, contentType] of Object.entries(ALLOWED_FILE_TYPES)) {
      expect(contentType, extension).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/)
    }
  })
})

describe("sanitizeFilename", () => {
  it("removes any directory part", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf")
    expect(sanitizeFilename("C:\\Users\\vendor\\guide.pdf")).toBe("guide.pdf")
    expect(sanitizeFilename("/absolute/path/guide.pdf")).toBe("guide.pdf")
  })

  it("removes control characters", () => {
    expect(sanitizeFilename("gui\u0000de\u001f.pdf")).toBe("guide.pdf")
  })

  it("removes leading dots and collapses spaces", () => {
    expect(sanitizeFilename("..hidden.pdf")).toBe("hidden.pdf")
    expect(sanitizeFilename("many    spaces   here.pdf")).toBe("many spaces here.pdf")
  })

  it("keeps the extension when the name is cut", () => {
    const long = `${"a".repeat(200)}.pdf`
    const sanitized = sanitizeFilename(long)

    expect(sanitized.length).toBe(MAX_FILENAME_LENGTH)
    expect(sanitized.endsWith(".pdf")).toBe(true)
  })

  it("leaves a short name alone", () => {
    expect(sanitizeFilename("résumé.pdf")).toBe("résumé.pdf")
    expect(sanitizeFilename("guide.pdf")).toBe("guide.pdf")
  })
})

describe("validateUpload", () => {
  it("accepts every allowed extension", () => {
    for (const [extension, contentType] of Object.entries(ALLOWED_FILE_TYPES)) {
      const result = validateUpload({ filename: `report.${extension}`, sizeBytes: 1024 })

      expect(result.ok, extension).toBe(true)

      if (result.ok) {
        expect(result.extension).toBe(extension)
        expect(result.contentType).toBe(contentType)
        expect(result.sanitizedName).toBe(`report.${extension}`)
      }
    }
  })

  it("reads an uppercase extension", () => {
    const result = validateUpload({ filename: "REPORT.PDF", sizeBytes: 1024 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.extension).toBe("pdf")
      expect(result.contentType).toBe("application/pdf")
      expect(result.sanitizedName).toBe("REPORT.PDF")
    }
  })

  it("ignores a claimed MIME type: the extension decides", () => {
    const result = validateUpload({ filename: "guide.pdf", sizeBytes: 10 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      // No input field for a MIME type exists at all, which is the point.
      expect(result.contentType).toBe("application/pdf")
    }
  })

  it("refuses an executable hidden behind an allowed extension", () => {
    expect(validateUpload({ filename: "invoice.exe.pdf", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "double_extension",
    })
    expect(validateUpload({ filename: "setup.bat.pdf", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "double_extension",
    })
    expect(validateUpload({ filename: "notes.js.pdf", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "double_extension",
    })
  })

  it("refuses a double extension that ends in an executable", () => {
    expect(validateUpload({ filename: "report.pdf.exe", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "not_allowed_type",
    })
  })

  it("refuses an unknown or missing extension", () => {
    expect(validateUpload({ filename: "archive.gz", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "not_allowed_type",
    })
    expect(validateUpload({ filename: "README", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "not_allowed_type",
    })
    expect(validateUpload({ filename: "trailing.", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "not_allowed_type",
    })
  })

  it("keeps a path traversal attempt but drops the path", () => {
    const result = validateUpload({ filename: "../../x.pdf", sizeBytes: 10 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.sanitizedName).toBe("x.pdf")
    }
  })

  it("accepts a unicode name", () => {
    expect(validateUpload({ filename: "présentation-éclair.mp4", sizeBytes: 10 }).ok).toBe(true)
  })

  it("refuses an empty file", () => {
    expect(validateUpload({ filename: "guide.pdf", sizeBytes: 0 })).toEqual({
      ok: false,
      code: "empty_file",
    })
    expect(validateUpload({ filename: "guide.pdf", sizeBytes: -1 })).toEqual({
      ok: false,
      code: "empty_file",
    })
  })

  it("accepts exactly 2 GiB and refuses one byte more", () => {
    expect(validateUpload({ filename: "big.zip", sizeBytes: MAX_FILE_BYTES }).ok).toBe(true)
    expect(validateUpload({ filename: "big.zip", sizeBytes: MAX_FILE_BYTES + 1 })).toEqual({
      ok: false,
      code: "too_large",
    })
  })

  it("refuses an empty name", () => {
    expect(validateUpload({ filename: "", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "invalid_filename",
    })
    expect(validateUpload({ filename: "...", sizeBytes: 10 })).toEqual({
      ok: false,
      code: "invalid_filename",
    })
  })

  it("keeps a very long name within the stored limit", () => {
    const result = validateUpload({ filename: `${"z".repeat(300)}.epub`, sizeBytes: 10 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.sanitizedName.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH)
      expect(result.sanitizedName.endsWith(".epub")).toBe(true)
    }
  })
})

describe("buildStorageKey", () => {
  it("puts the object under its product and file", () => {
    expect(buildStorageKey("prod-1", "file-2", "guide.pdf")).toBe(
      "products/prod-1/file-2/guide.pdf",
    )
  })

  it("never starts with a slash", () => {
    expect(buildStorageKey("p", "f", "a.pdf").startsWith("products/")).toBe(true)
  })
})
