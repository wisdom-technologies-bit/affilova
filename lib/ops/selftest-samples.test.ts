import { execFile, spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ARCHIVE_EXECUTABLE_ENTRY,
  HELLO_TEXT,
  buildSelfTestSamples,
  eicarTestString,
  matchesExpectation,
  storedZip,
} from "@/lib/ops/selftest-samples"
import type { SelfTestSample } from "@/lib/ops/selftest-samples"

// The samples are the whole point of the self-test: if one of them is not what
// it claims to be, a passing run proves nothing. So each one is checked with the
// same tools the scanner uses, on a real file in a real directory.
//
// `file` and `7z` are not installed everywhere, so those two checks are skipped
// when the tool is missing rather than failing on a machine without it. The
// checks that need no tool always run.

const run = promisify(execFile)

const samples = buildSelfTestSamples()

function sample(name: string): SelfTestSample {
  const found = samples.find((candidate) => candidate.name === name)

  if (found === undefined) {
    throw new Error(`no sample named ${name}`)
  }

  return found
}

let workDir = ""

/**
 * Whether a tool is installed. Synchronous on purpose: the answer decides which
 * tests exist, and a test file cannot wait for it at the top level.
 */
function toolAvailable(command: string): boolean {
  const probe = spawnSync(command, ["--help"], { stdio: "ignore" })

  // A tool that exists and exits non-zero for --help is still installed; only a
  // failure to start it at all means it is missing.
  return probe.error === undefined
}

const hasFile = toolAvailable("file")
const has7z = toolAvailable("7z")

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "selftest-samples-"))

  for (const entry of samples) {
    await writeFile(join(workDir, entry.name), entry.bytes)
  }
})

afterAll(async () => {
  if (workDir !== "") {
    await rm(workDir, { recursive: true, force: true })
  }
})

describe("self-test samples", () => {
  it("builds exactly the four samples, in a stable order", () => {
    expect(samples.map((entry) => entry.name)).toEqual([
      "hello.txt",
      "eicar.txt",
      "not-a-pdf.pdf",
      "archive.zip",
    ])
  })

  it("gives every sample the expectation the scanner must meet", () => {
    expect(samples.map((entry) => [entry.name, entry.expected.verdict])).toEqual([
      ["hello.txt", "clean"],
      ["eicar.txt", "infected"],
      ["not-a-pdf.pdf", "rejected"],
      ["archive.zip", "needs_review"],
    ])

    expect(sample("not-a-pdf.pdf").expected.detail).toBe("executable_type")
    expect(sample("archive.zip").expected.detail).toBe("archive_contains_executable")
  })

  it("sends the extension the scanner's accepted list expects", () => {
    expect(samples.map((entry) => entry.extension)).toEqual(["txt", "txt", "pdf", "zip"])
  })

  it("keeps every sample inside the self-test size limit", () => {
    for (const entry of samples) {
      expect(entry.bytes.length).toBeGreaterThan(0)
      expect(entry.bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    }
  })
})

describe("hello.txt", () => {
  it("holds the text the page says it holds", () => {
    expect(new TextDecoder().decode(sample("hello.txt").bytes)).toBe(HELLO_TEXT)
  })

  it.skipIf(!hasFile)("is plain text according to file", async () => {
    const { stdout } = await run("file", ["--mime-type", "-b", join(workDir, "hello.txt")])

    expect(stdout.trim()).toBe("text/plain")
  })
})

describe("eicar.txt", () => {
  it("is the standard test string, assembled from two halves", () => {
    const text = eicarTestString()

    expect(text).toBe(new TextDecoder().decode(sample("eicar.txt").bytes))
    expect(text).toHaveLength(68)
    expect(text.startsWith("X5O!P%@AP[4")).toBe(true)
    expect(text.endsWith("$H+H*")).toBe(true)
  })

  it("is not stored as one literal anywhere in the repository", async () => {
    // The repository must not contain the full string: a virus scanner on a
    // developer machine or in CI would quarantine the file that holds it. The
    // module builds it from two halves, so searching for the whole thing must
    // find nothing.
    const { stdout } = await run("grep", ["-rlF", eicarTestString(), "lib", "components", "app"], {
      cwd: process.cwd(),
    }).catch(() => ({ stdout: "" }))

    expect(stdout.trim()).toBe("")
  })
})

describe("not-a-pdf.pdf", () => {
  it("is a PE image, not a PDF", () => {
    const bytes = sample("not-a-pdf.pdf").bytes

    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("MZ")
    expect(String.fromCharCode(bytes[0x40], bytes[0x41])).toBe("PE")
  })

  it.skipIf(!hasFile)("is detected as an executable by file", async () => {
    const { stdout } = await run("file", ["--mime-type", "-b", join(workDir, "not-a-pdf.pdf")])
    const detected = stdout.trim()

    // Which of these two names libmagic answers with depends on its version;
    // both are on the scanner's executable deny list.
    expect([
      "application/vnd.microsoft.portable-executable",
      "application/x-dosexec",
    ]).toContain(detected)
  })

  it.skipIf(!hasFile)("is not detected as a PDF", async () => {
    const { stdout } = await run("file", ["--mime-type", "-b", join(workDir, "not-a-pdf.pdf")])

    expect(stdout.trim()).not.toBe("application/pdf")
  })
})

describe("archive.zip", () => {
  it("is a real zip with a readable structure", async () => {
    const bytes = sample("archive.zip").bytes

    // Local header, then the central directory signature somewhere after it,
    // then the end-of-directory record at the end.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)

    const tail = bytes.subarray(bytes.length - 22)

    expect(tail[0]).toBe(0x50)
    expect(tail[1]).toBe(0x4b)
    expect(tail[2]).toBe(0x05)
    expect(tail[3]).toBe(0x06)
  })

  it("declares one entry, named run.exe", async () => {
    const bytes = sample("archive.zip").bytes
    const entryCount = bytes[bytes.length - 12] | (bytes[bytes.length - 11] << 8)

    expect(entryCount).toBe(1)
    expect(new TextDecoder().decode(bytes)).toContain(ARCHIVE_EXECUTABLE_ENTRY)
  })

  it.skipIf(!has7z)("lists run.exe and passes its own CRC check", async () => {
    const listing = await run("7z", ["l", "-slt", join(workDir, "archive.zip")])

    expect(listing.stdout).toContain(`Path = ${ARCHIVE_EXECUTABLE_ENTRY}`)
    expect(listing.stdout).toContain("Type = zip")

    // 7z t reads every entry and verifies the CRC-32 this module computed.
    const tested = await run("7z", ["t", join(workDir, "archive.zip")])

    expect(tested.stdout).toContain("Everything is Ok")
  })

  it("can build more than one entry without corrupting the offsets", async () => {
    const zip = storedZip([
      { name: "first.txt", bytes: new TextEncoder().encode("one") },
      { name: "second.txt", bytes: new TextEncoder().encode("two") },
    ])

    // Two local headers and two central headers, plus one end record.
    const localHeaders = zip.filter((byte, index) => byte === 0x50 && zip[index + 1] === 0x4b && zip[index + 2] === 0x03).length

    expect(localHeaders).toBe(2)
    expect(zip.subarray(zip.length - 22)[2]).toBe(0x05)
  })
})

describe("matchesExpectation", () => {
  it("accepts the exact answer", () => {
    expect(matchesExpectation({ verdict: "rejected", detail: "executable_type", detailPrefix: null }, {
      verdict: "rejected",
      detail: "executable_type",
    })).toBe(true)
  })

  it("rejects a different verdict", () => {
    expect(matchesExpectation({ verdict: "clean", detail: "clean", detailPrefix: null }, {
      verdict: "infected",
      detail: "Eicar-Test-Signature",
    })).toBe(false)
  })

  it("rejects a different detail code", () => {
    expect(matchesExpectation({ verdict: "rejected", detail: "executable_type", detailPrefix: null }, {
      verdict: "rejected",
      detail: "type_mismatch",
    })).toBe(false)
  })

  it("accepts a detail that starts with the expected prefix", () => {
    expect(matchesExpectation({ verdict: "infected", detail: null, detailPrefix: "Eicar" }, {
      verdict: "infected",
      detail: "Eicar-Test-Signature",
    })).toBe(true)
  })

  it("rejects a detail that does not carry the expected prefix", () => {
    expect(matchesExpectation({ verdict: "infected", detail: null, detailPrefix: "Eicar" }, {
      verdict: "infected",
      detail: "Win.Test.EICAR_HDB-1",
    })).toBe(false)
  })

  it("rejects a missing detail when a prefix is expected", () => {
    expect(matchesExpectation({ verdict: "infected", detail: null, detailPrefix: "Eicar" }, {
      verdict: "infected",
      detail: null,
    })).toBe(false)
  })
})
