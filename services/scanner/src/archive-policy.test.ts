import { describe, expect, it } from "vitest"

import {
  MAX_ENTRIES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  decideArchiveListing,
  hasPathTraversal,
  parseSevenZipListing,
} from "#archive-policy"
import type { ArchiveListing } from "#archive-policy"

/**
 * A real `7z l -slt` run over a three file zip, kept verbatim so the parser is
 * tested against the format it will actually see rather than against a guess.
 */
const REAL_ZIP_LISTING = `
7-Zip [64] 26.02 : Copyright (c) 1999-2026 Igor Pavlov : 2026-06-25
p7zip Version 16.02 (locale=C.UTF-8,Utf16=on,HugeFiles=on,64 bits,4 CPUs)

Scanning the drive for archives:
1 file, 333 bytes (1 KiB)

Listing archive: normal.zip

--
Path = normal.zip
Type = zip
Physical Size = 333

----------
Path = a.txt
Folder = -
Size = 12
Packed Size = 14
Modified = 2026-11-18 05:21:02
Attributes =  -rw-r--r--
Encrypted = -
CRC = AF083B2D
Method = Deflate
Host OS = Unix
Version = 20
Offset = 0

Path = b.txt
Folder = -
Size = 12
Packed Size = 14
Modified = 2026-11-18 05:21:02
Attributes =  -rw-r--r--
Encrypted = -
CRC = E472FF82
Method = Deflate
Host OS = Unix
Version = 20
Offset = 49

Path = sub/c.txt
Folder = -
Size = 15
Packed Size = 17
Modified = 2026-11-18 05:21:02
Attributes =  -rw-r--r--
Encrypted = -
CRC = D3ED0EA1
Method = Deflate
Host OS = Unix
Version = 20
Offset = 98
`

function entryBlock(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key} = ${value}`)
    .join("\n")
}

function listingOf(entries: ReadonlyArray<Readonly<Record<string, string>>>): string {
  const header = [
    "7-Zip [64] 26.02 : Copyright (c) 1999-2026 Igor Pavlov : 2026-06-25",
    "",
    "Listing archive: fixture.zip",
    "",
    "--",
    "Path = fixture.zip",
    "Type = zip",
    "Physical Size = 4096",
    "",
    "----------",
    "",
  ]

  return [...header, ...entries.map((fields) => `${entryBlock(fields)}\n`)].join("\n")
}

function plain(path: string, size = 10, packedSize = 10): Record<string, string> {
  return {
    Path: path,
    Folder: "-",
    Size: String(size),
    "Packed Size": String(packedSize),
    Attributes: " -rw-r--r--",
    Encrypted: "-",
    Method: "Deflate",
  }
}

describe("parseSevenZipListing", () => {
  it("reads every entry of a real listing", () => {
    const parsed = parseSevenZipListing(REAL_ZIP_LISTING)

    expect(parsed).not.toBeNull()

    if (parsed === null) {
      return
    }

    expect(parsed.entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt", "sub/c.txt"])
    expect(parsed.totalSize).toBe(39)
    expect(parsed.totalPackedSize).toBe(45)
    expect(parsed.entries.every((entry) => !entry.encrypted)).toBe(true)
    expect(parsed.entries.every((entry) => !entry.isDirectory)).toBe(true)
    expect(parsed.entries.every((entry) => !entry.isSymlink)).toBe(true)
  })

  it("does not treat the archive header block as an entry", () => {
    const parsed = parseSevenZipListing(REAL_ZIP_LISTING)

    expect(parsed?.entries.map((entry) => entry.path)).not.toContain("normal.zip")
  })

  it("reads AES encrypted entries", () => {
    const parsed = parseSevenZipListing(
      listingOf([{ Path: "a.txt", Size: "12", "Packed Size": "40", Encrypted: "+", Method: "AES-256 Store" }]),
    )

    expect(parsed?.entries[0].encrypted).toBe(true)
  })

  it("reads zipcrypto encrypted entries", () => {
    const parsed = parseSevenZipListing(
      listingOf([{ Path: "a.txt", Size: "12", "Packed Size": "24", Encrypted: "+", Method: "ZipCrypto Store" }]),
    )

    expect(parsed?.entries[0].encrypted).toBe(true)
  })

  it("treats an AES method as encrypted even without the flag", () => {
    const parsed = parseSevenZipListing(
      listingOf([{ Path: "a.txt", Size: "1", "Packed Size": "1", Encrypted: "-", Method: "7zAES:19" }]),
    )

    expect(parsed?.entries[0].encrypted).toBe(true)
  })

  it("recognises directory entries", () => {
    const parsed = parseSevenZipListing(listingOf([{ Path: "sub", Size: "0", Attributes: "D drwxr-xr-x" }]))

    expect(parsed?.entries[0].isDirectory).toBe(true)
  })

  it("recognises symlink entries from the attributes and the target", () => {
    const fromAttributes = parseSevenZipListing(
      listingOf([{ Path: "link", Size: "0", Attributes: "lrwxrwxrwx", "Symbolic Link": "../etc/passwd" }]),
    )

    expect(fromAttributes?.entries[0].isSymlink).toBe(true)

    const fromType = parseSevenZipListing(listingOf([{ Path: "link", Type: "Symbolic Link", Size: "0" }]))

    expect(fromType?.entries[0].isSymlink).toBe(true)
  })

  it("keeps a path that contains a separator in its name", () => {
    const parsed = parseSevenZipListing(listingOf([{ Path: "a = b.txt", Size: "1", "Packed Size": "1" }]))

    expect(parsed?.entries[0].path).toBe("a = b.txt")
  })

  it("returns null when there is no listing at all", () => {
    expect(parseSevenZipListing("")).toBeNull()
    expect(parseSevenZipListing("ERROR: Can not open the file as archive")).toBeNull()
  })

  it("returns an empty listing when the archive has no entries", () => {
    expect(parseSevenZipListing(listingOf([]))?.entries).toEqual([])
  })
})

describe("hasPathTraversal", () => {
  it.each([
    "../evil",
    "../../etc/passwd",
    "a/../../evil",
    "a/..",
    "/etc/passwd",
    "\\windows\\system32\\evil.dll",
    "C:/Windows/evil.dll",
    "c:\\windows\\evil.dll",
  ])("flags %s", (path) => {
    expect(hasPathTraversal(path)).toBe(true)
  })

  it.each(["a.txt", "sub/a.txt", "a..b.txt", "..hidden.txt", "deep/nested/file.txt"])("allows %s", (path) => {
    expect(hasPathTraversal(path)).toBe(false)
  })
})

describe("decideArchiveListing", () => {
  it("accepts a normal archive", () => {
    expect(decideArchiveListing(parseSevenZipListing(REAL_ZIP_LISTING))).toEqual({ verdict: "ok" })
  })

  it("accepts an archive of images and documents", () => {
    const listing = parseSevenZipListing(
      listingOf([plain("cover.png"), plain("manual.pdf"), plain("docs/readme.txt")]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "ok" })
  })

  it("rejects an encrypted archive", () => {
    const listing = parseSevenZipListing(
      listingOf([plain("a.txt"), { Path: "b.txt", Size: "1", "Packed Size": "1", Encrypted: "+" }]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "encrypted_archive" })
  })

  it.each(["../evil.txt", "/etc/passwd", "C:/Windows/evil.dll", "a/../../b.txt"])(
    "rejects the traversal entry %s",
    (path) => {
      const listing = parseSevenZipListing(listingOf([plain("a.txt"), plain(path)]))

      expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "path_traversal" })
    },
  )

  it("rejects a symlink entry", () => {
    const listing = parseSevenZipListing(
      listingOf([plain("a.txt"), { Path: "link", Size: "0", Attributes: "lrwxrwxrwx", "Symbolic Link": "/etc/passwd" }]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "symlink" })
  })

  it("rejects an archive with too many entries", () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_unused, index) => plain(`f${index}.txt`, 1, 1))

    expect(decideArchiveListing(parseSevenZipListing(listingOf(entries)))).toEqual({
      verdict: "rejected",
      detail: "archive_limits",
    })
  })

  it("accepts an archive at the entry limit", () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_unused, index) => plain(`f${index}.txt`, 10, 10))

    expect(decideArchiveListing(parseSevenZipListing(listingOf(entries)))).toEqual({ verdict: "ok" })
  })

  it("rejects a total uncompressed size over 8 GiB", () => {
    const listing = parseSevenZipListing(
      listingOf([
        plain("a.bin", MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES),
        plain("b.bin", 1, 1),
      ]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "archive_limits" })
  })

  it("accepts exactly 8 GiB", () => {
    const listing = parseSevenZipListing(
      listingOf([plain("a.bin", MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES)]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "ok" })
  })

  it("rejects a compression ratio over 1000:1", () => {
    const listing = parseSevenZipListing(listingOf([plain("bomb.txt", 5_000_000, 1_000)]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "archive_limits" })
  })

  it("accepts a ratio of exactly 1000:1", () => {
    const listing = parseSevenZipListing(listingOf([plain("flat.txt", 1_000_000, 1_000)]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "ok" })
  })

  it("rejects an archive nested four deep", () => {
    const listing = parseSevenZipListing(listingOf([plain("a.zip/b.zip/c.zip/d.zip", 10, 10)]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "archive_limits" })
  })

  it("accepts an archive nested three deep", () => {
    const listing = parseSevenZipListing(listingOf([plain("a.zip/b.zip/c.zip", 10, 10)]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "ok" })
  })

  it.each(["setup.exe", "installer.msi", "run.bat", "open.cmd", "old.com", "logon.scr", "macro.vbs", "a.ps1", "tool.jar", "app.apk", "lib.dll", "deploy.sh", "Thing.app", "disk.dmg", "payload.js", "lib.so", "setup.pkg"])(
    "needs review when it contains %s",
    (name) => {
      const listing = parseSevenZipListing(listingOf([plain("docs/readme.txt"), plain(`bin/${name}`)]))

      expect(decideArchiveListing(listing)).toEqual({
        verdict: "needs_review",
        detail: "archive_contains_executable",
      })
    },
  )

  it("matches executable extensions case insensitively", () => {
    expect(decideArchiveListing(parseSevenZipListing(listingOf([plain("SETUP.EXE")])))).toEqual({
      verdict: "needs_review",
      detail: "archive_contains_executable",
    })
  })

  it("does not flag a name that merely contains a dot extension", () => {
    expect(decideArchiveListing(parseSevenZipListing(listingOf([plain("notes.exe.txt")])))).toEqual({
      verdict: "ok",
    })
  })

  it("needs review when the archive cannot be listed", () => {
    expect(decideArchiveListing(null)).toEqual({ verdict: "needs_review", detail: "archive_unlistable" })
  })

  it("prefers encrypted_archive over the executable check", () => {
    const listing = parseSevenZipListing(
      listingOf([{ Path: "run.exe", Size: "1", "Packed Size": "1", Encrypted: "+" }]),
    )

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "encrypted_archive" })
  })

  it("prefers path_traversal over the executable check", () => {
    const listing = parseSevenZipListing(listingOf([plain("../run.exe")]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "rejected", detail: "path_traversal" })
  })

  it("handles an empty archive", () => {
    const listing: ArchiveListing | null = parseSevenZipListing(listingOf([]))

    expect(decideArchiveListing(listing)).toEqual({ verdict: "ok" })
  })
})
