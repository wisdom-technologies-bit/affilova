import { describe, expect, it } from "vitest"

import {
  ALLOWED_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  DENIED_MIME_TYPES,
  MIME_TABLE,
  decideMime,
  isAllowedExtension,
  isArchiveExtension,
  normaliseMime,
} from "#mime-policy"

const SUPPORTED_EXTENSIONS = [
  "pdf",
  "epub",
  "mobi",
  "zip",
  "7z",
  "rar",
  "mp4",
  "mov",
  "mp3",
  "wav",
  "m4a",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "psd",
  "ai",
  "eps",
  "ttf",
  "otf",
]

const UNRELIABLE = ["mobi", "psd", "ai", "eps"]

describe("the allowed extension list", () => {
  it("contains exactly the contract's extensions", () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual([...SUPPORTED_EXTENSIONS].sort())
  })

  it("has a decision for every extension", () => {
    for (const extension of SUPPORTED_EXTENSIONS) {
      expect(isAllowedExtension(extension)).toBe(true)
    }
  })

  it("rejects extensions outside the list", () => {
    for (const extension of ["exe", "sh", "html", "pdf.exe", "", "PDF "]) {
      expect(isAllowedExtension(extension)).toBe(false)
    }
  })

  it("is case insensitive", () => {
    expect(isAllowedExtension("PDF")).toBe(true)
  })

  it("marks the archive based formats", () => {
    expect([...ARCHIVE_EXTENSIONS].sort()).toEqual(["7z", "docx", "epub", "pptx", "rar", "xlsx", "zip"])
    expect(isArchiveExtension("epub")).toBe(true)
    expect(isArchiveExtension("mp4")).toBe(false)
  })
})

describe("decideMime", () => {
  const reliable = SUPPORTED_EXTENSIONS.filter((extension) => !UNRELIABLE.includes(extension))

  it.each(reliable.map((extension) => [extension, MIME_TABLE[extension][0]] as const))(
    "accepts %s detected as %s",
    (extension, detected) => {
      expect(decideMime(extension, detected)).toEqual({ verdict: "ok" })
    },
  )

  it.each(reliable.map((extension) => [extension, "application/octet-stream"] as const))(
    "rejects %s detected as %s with type_mismatch",
    (extension, detected) => {
      expect(decideMime(extension, detected)).toEqual({ verdict: "rejected", detail: "type_mismatch" })
    },
  )

  it.each(UNRELIABLE.map((extension) => [extension, "application/octet-stream"] as const))(
    "accepts %s on a type libmagic cannot pin down",
    (extension, detected) => {
      expect(decideMime(extension, detected)).toEqual({ verdict: "ok" })
    },
  )

  it.each(DENIED_MIME_TYPES.map((detected) => [detected] as const))(
    "rejects %s as executable_type for every extension",
    (detected) => {
      for (const extension of SUPPORTED_EXTENSIONS) {
        expect(decideMime(extension, detected)).toEqual({ verdict: "rejected", detail: "executable_type" })
      }
    },
  )

  it("rejects an executable renamed as a pdf", () => {
    expect(decideMime("pdf", "application/x-dosexec")).toEqual({
      verdict: "rejected",
      detail: "executable_type",
    })
  })

  it("rejects an ELF binary renamed as an epub", () => {
    expect(decideMime("epub", "application/x-executable")).toEqual({
      verdict: "rejected",
      detail: "executable_type",
    })
  })

  it("rejects a text file renamed as a zip", () => {
    expect(decideMime("zip", "text/plain")).toEqual({ verdict: "rejected", detail: "type_mismatch" })
  })

  it("rejects an HTML file renamed as txt", () => {
    expect(decideMime("txt", "text/html")).toEqual({ verdict: "rejected", detail: "executable_type" })
  })

  it("rejects a shell script renamed as csv", () => {
    expect(decideMime("csv", "text/x-shellscript")).toEqual({
      verdict: "rejected",
      detail: "executable_type",
    })
  })

  it("accepts the openxml container reported as a zip", () => {
    expect(decideMime("docx", "application/zip")).toEqual({ verdict: "ok" })
    expect(decideMime("xlsx", "application/zip")).toEqual({ verdict: "ok" })
    expect(decideMime("pptx", "application/zip")).toEqual({ verdict: "ok" })
  })

  it("accepts the openxml types themselves", () => {
    expect(decideMime("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toEqual({
      verdict: "ok",
    })
    expect(decideMime("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toEqual({
      verdict: "ok",
    })
    expect(
      decideMime("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ).toEqual({ verdict: "ok" })
  })

  it("accepts both wave spellings", () => {
    expect(decideMime("wav", "audio/x-wav")).toEqual({ verdict: "ok" })
    expect(decideMime("wav", "audio/vnd.wave")).toEqual({ verdict: "ok" })
  })

  it("accepts every m4a spelling including video/mp4", () => {
    for (const detected of ["audio/mp4", "audio/x-m4a", "video/mp4"]) {
      expect(decideMime("m4a", detected)).toEqual({ verdict: "ok" })
    }
  })

  it("accepts the font types", () => {
    for (const detected of [
      "font/sfnt",
      "font/ttf",
      "font/otf",
      "application/vnd.ms-opentype",
      "application/x-font-ttf",
    ]) {
      expect(decideMime("ttf", detected)).toEqual({ verdict: "ok" })
      expect(decideMime("otf", detected)).toEqual({ verdict: "ok" })
    }
  })

  it("ignores a charset parameter", () => {
    expect(decideMime("txt", "text/plain; charset=utf-8")).toEqual({ verdict: "ok" })
  })

  it("rejects an unknown extension", () => {
    expect(decideMime("exe", "application/pdf")).toEqual({ verdict: "rejected", detail: "type_mismatch" })
  })

  it("tolerates a leading dot and upper case in the extension", () => {
    expect(decideMime(".PDF", "application/pdf")).toEqual({ verdict: "ok" })
  })
})

describe("normaliseMime", () => {
  it("lowercases and drops parameters", () => {
    expect(normaliseMime("  Application/PDF ; charset=binary")).toBe("application/pdf")
  })

  it("survives an empty value", () => {
    expect(normaliseMime("")).toBe("")
  })
})
