// The four files the scanner self-test sends through the whole pipeline.
//
// Each sample exists to prove one branch of the scan policy, and each carries
// the exact answer the scanner must give for it. They are built in memory, byte
// by byte, so the self-test needs no fixture files in the repository and cannot
// pick up a sample that was edited by hand:
//
//   hello.txt        a harmless text file           -> clean
//   eicar.txt        the industry test string       -> infected
//   not-a-pdf.pdf    a real PE executable, named .pdf -> rejected (executable_type)
//   archive.zip      a valid zip holding run.exe    -> needs_review (archive_contains_executable)
//
// The EICAR string is assembled from two halves on purpose: the repository must
// not contain the full literal, or every virus scanner on every developer
// machine and every CI run would quarantine the source file. The two halves are
// inert on their own.
//
// Nothing here reads the environment, the network or the disk, so the module is
// safe to import from a test.

import { crc32 } from "node:zlib"

/** The verdicts the scanner can answer with. `error` is a failure to scan. */
export type SelfTestVerdict = "clean" | "infected" | "rejected" | "needs_review" | "error"

/**
 * What a sample must produce.
 *
 * `detail` is the exact detail code when the scanner always answers the same
 * one. `detailPrefix` is used when the scanner puts data in the detail, such as
 * the ClamAV signature name: pinning the whole name would make the self-test
 * fail the day the signature database renames it, which is not a fault.
 */
export interface SelfTestExpectation {
  verdict: SelfTestVerdict
  detail: string | null
  detailPrefix: string | null
}

export interface SelfTestSample {
  /** The object name under selftest/<uuid>/ in the bucket. */
  name: string
  /** The extension the app would send for a real upload of this kind. */
  extension: string
  contentType: string
  bytes: Uint8Array
  expected: SelfTestExpectation
  /** What this sample proves, in one sentence, for the results table. */
  proves: string
}

const TEXT_ENCODER = new TextEncoder()

// ---------------------------------------------------------------------------
// EICAR, assembled from two halves
// ---------------------------------------------------------------------------

const EICAR_HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STAN"

const EICAR_TAIL = "DARD-ANTIVIRUS-TEST-FILE!$H+H*"

/**
 * The standard antivirus test string. Harmless by construction: it contains no
 * executable code, it exists only so a scanner has something it must detect.
 */
export function eicarTestString(): string {
  return `${EICAR_HEAD}${EICAR_TAIL}`
}

// ---------------------------------------------------------------------------
// A minimal but complete PE32 image
// ---------------------------------------------------------------------------

/**
 * A DOS header, the PE signature, a COFF header and the 224-byte optional
 * header: enough that `file --mime-type` reports
 * `application/vnd.microsoft.portable-executable`, which is what the MIME policy
 * refuses. It has no sections and no code, so it cannot run, and it is only ever
 * sent to the scanner.
 */
export function minimalPortableExecutable(): Uint8Array {
  const dosHeaderSize = 0x40
  const coffHeaderSize = 20
  const optionalHeaderSize = 0xe0
  const signatureSize = 4
  const bytes = new Uint8Array(dosHeaderSize + signatureSize + coffHeaderSize + optionalHeaderSize)
  const view = new DataView(bytes.buffer)

  // DOS header: the two magic bytes, and where the PE header starts.
  bytes[0] = 0x4d // M
  bytes[1] = 0x5a // Z
  view.setUint32(0x3c, dosHeaderSize, true)

  // PE signature.
  bytes[0x40] = 0x50 // P
  bytes[0x41] = 0x45 // E

  const coff = dosHeaderSize + signatureSize

  view.setUint16(coff, 0x014c, true) // machine: i386
  view.setUint16(coff + 2, 0, true) // no sections
  view.setUint32(coff + 4, 0, true) // timestamp
  view.setUint32(coff + 8, 0, true) // no symbol table
  view.setUint32(coff + 12, 0, true) // no symbols
  view.setUint16(coff + 16, optionalHeaderSize, true)
  view.setUint16(coff + 18, 0x0102, true) // executable image, 32 bit

  const optional = coff + coffHeaderSize

  view.setUint16(optional, 0x010b, true) // PE32
  view.setUint16(optional + 68, 2, true) // console subsystem
  view.setUint32(optional + 92, 0x1000, true) // section alignment
  view.setUint32(optional + 96, 0x1000, true) // file alignment

  return bytes
}

// ---------------------------------------------------------------------------
// A stored (uncompressed) zip, written by hand
// ---------------------------------------------------------------------------

interface StoredZipEntry {
  name: string
  bytes: Uint8Array
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_VERSION = 20
const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_OF_DIRECTORY_SIZE = 22

/**
 * A zip with method 0 (stored) entries: a local header and data per entry, the
 * central directory, then the end-of-directory record. No compression, so the
 * bytes are deterministic and the CRC is the only arithmetic involved.
 *
 * The scanner's archive policy reads the entry names out of the central
 * directory, which is exactly why this has to be a real zip and not a byte
 * pattern that looks like one.
 */
export function storedZip(entries: readonly StoredZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = TEXT_ENCODER.encode(entry.name)
    const checksum = crc32(entry.bytes)

    const local = new Uint8Array(LOCAL_HEADER_SIZE)
    const localView = new DataView(local.buffer)

    localView.setUint32(0, LOCAL_HEADER_SIGNATURE, true)
    localView.setUint16(4, ZIP_VERSION, true) // version needed to extract
    localView.setUint16(6, 0, true) // flags
    localView.setUint16(8, 0, true) // method: stored
    localView.setUint16(10, 0, true) // modification time
    localView.setUint16(12, 0, true) // modification date
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.bytes.length, true) // compressed size
    localView.setUint32(22, entry.bytes.length, true) // uncompressed size
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true) // extra field length

    const central = new Uint8Array(CENTRAL_HEADER_SIZE)
    const centralView = new DataView(central.buffer)

    centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true)
    centralView.setUint16(4, ZIP_VERSION, true) // version made by
    centralView.setUint16(6, ZIP_VERSION, true) // version needed
    centralView.setUint16(8, 0, true) // flags
    centralView.setUint16(10, 0, true) // method: stored
    centralView.setUint16(12, 0, true) // modification time
    centralView.setUint16(14, 0, true) // modification date
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.bytes.length, true) // compressed size
    centralView.setUint32(24, entry.bytes.length, true) // uncompressed size
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true) // extra field length
    centralView.setUint16(32, 0, true) // comment length
    centralView.setUint16(34, 0, true) // disk number start
    centralView.setUint16(36, 0, true) // internal attributes
    centralView.setUint32(38, 0, true) // external attributes
    centralView.setUint32(42, offset, true) // offset of the local header

    localParts.push(local, nameBytes, entry.bytes)
    centralParts.push(central, nameBytes)
    offset += LOCAL_HEADER_SIZE + nameBytes.length + entry.bytes.length
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)

  const end = new Uint8Array(END_OF_DIRECTORY_SIZE)
  const endView = new DataView(end.buffer)

  endView.setUint32(0, END_OF_DIRECTORY_SIGNATURE, true)
  endView.setUint16(4, 0, true) // this disk
  endView.setUint16(6, 0, true) // disk with the central directory
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true) // where the central directory starts
  endView.setUint16(20, 0, true) // comment length

  const parts = [...localParts, ...centralParts, end]
  const total = parts.reduce((length, part) => length + part.length, 0)
  const zip = new Uint8Array(total)
  let cursor = 0

  for (const part of parts) {
    zip.set(part, cursor)
    cursor += part.length
  }

  return zip
}

// ---------------------------------------------------------------------------
// The four samples
// ---------------------------------------------------------------------------

/** The text in hello.txt. Kept in one place so the test can assert on it. */
export const HELLO_TEXT = "Affilova scanner self-test"

/** The entry name inside archive.zip that the archive policy must object to. */
export const ARCHIVE_EXECUTABLE_ENTRY = "run.exe"

export function buildSelfTestSamples(): readonly SelfTestSample[] {
  return [
    {
      name: "hello.txt",
      extension: "txt",
      contentType: "text/plain",
      bytes: TEXT_ENCODER.encode(HELLO_TEXT),
      expected: { verdict: "clean", detail: "clean", detailPrefix: null },
      proves: "A harmless file is downloaded, typed, scanned and reported clean.",
    },
    {
      name: "eicar.txt",
      extension: "txt",
      contentType: "text/plain",
      bytes: TEXT_ENCODER.encode(eicarTestString()),
      expected: { verdict: "infected", detail: null, detailPrefix: "Eicar" },
      proves: "ClamAV is really running and its signatures really match.",
    },
    {
      name: "not-a-pdf.pdf",
      extension: "pdf",
      contentType: "application/pdf",
      bytes: minimalPortableExecutable(),
      expected: { verdict: "rejected", detail: "executable_type", detailPrefix: null },
      proves: "A Windows executable renamed .pdf is refused on its real type.",
    },
    {
      name: "archive.zip",
      extension: "zip",
      contentType: "application/zip",
      bytes: storedZip([
        { name: ARCHIVE_EXECUTABLE_ENTRY, bytes: new Uint8Array([0x4d, 0x5a, 0x00, 0x00]) },
      ]),
      expected: {
        verdict: "needs_review",
        detail: "archive_contains_executable",
        detailPrefix: null,
      },
      proves: "A zip holding an executable is sent to manual review, not passed.",
    },
  ]
}

/** What the scanner actually answered, as far as the comparison cares. */
export interface SelfTestAnswer {
  verdict: string
  detail: string | null
}

/** Whether one answer is the answer the sample expects. */
export function matchesExpectation(expected: SelfTestExpectation, answer: SelfTestAnswer): boolean {
  if (answer.verdict !== expected.verdict) {
    return false
  }

  if (expected.detail !== null && answer.detail !== expected.detail) {
    return false
  }

  if (expected.detailPrefix !== null) {
    const detail = answer.detail ?? ""

    return detail.startsWith(expected.detailPrefix)
  }

  return true
}
