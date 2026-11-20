import { createServer } from "node:net"
import type { Server, Socket } from "node:net"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { CommandResult } from "#exec"
import {
  classifySignature,
  createEngineInfoCache,
  createReadinessProbe,
  parseClamdScanOutput,
  parseClamdVersion,
  pingClamd,
  readSignatureAgeHours,
} from "#clamav"

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return { code: 0, stdout: "", stderr: "", timedOut: false, ...overrides }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()

    if (cleanup !== undefined) {
      await cleanup()
    }
  }
})

describe("parseClamdScanOutput", () => {
  it("reads a clean scan", () => {
    expect(parseClamdScanOutput(result({ code: 0, stdout: "/data/tmp/abc: OK\n" }))).toEqual({ kind: "clean" })
  })

  it("reads an infection and keeps the signature name", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "/data/tmp/abc: Eicar-Test-Signature FOUND\n" })),
    ).toEqual({ kind: "infected", signature: "Eicar-Test-Signature" })
  })

  it("reads a signature name containing spaces and dots", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "x: Win.Trojan.Agent-1234567-0 FOUND\n" })),
    ).toEqual({ kind: "infected", signature: "Win.Trojan.Agent-1234567-0" })
  })

  it("reads an infection reported on stderr", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "", stderr: "x: Unix.Trojan.Mirai-1 FOUND\n" })),
    ).toEqual({ kind: "infected", signature: "Unix.Trojan.Mirai-1" })
  })

  it("maps an encrypted content alert to a rejection", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "x: Heuristics.Encrypted.Zip FOUND\n" })),
    ).toEqual({ kind: "rejected", detail: "encrypted_archive" })
  })

  it("maps an encrypted PDF alert to a rejection", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "x: Heuristics.Encrypted.PDF FOUND\n" })),
    ).toEqual({ kind: "rejected", detail: "encrypted_archive" })
  })

  it("maps an exceeded limit alert to a rejection", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "x: Heuristics.ExceedsMaxFileSize FOUND\n" })),
    ).toEqual({ kind: "rejected", detail: "archive_limits" })
  })

  it("maps an exceeded scan size alert to a rejection", () => {
    expect(
      parseClamdScanOutput(result({ code: 1, stdout: "x: Heuristics.ExceedsMaxScanSize FOUND\n" })),
    ).toEqual({ kind: "rejected", detail: "archive_limits" })
  })

  it("maps exit code 2 to a scanner error", () => {
    expect(
      parseClamdScanOutput(result({ code: 2, stdout: "", stderr: "x: Can't access file ERROR\n" })),
    ).toEqual({ kind: "error", detail: "scanner_error" })
  })

  it("maps a timeout to a timeout", () => {
    expect(parseClamdScanOutput(result({ code: null, timedOut: true }))).toEqual({
      kind: "error",
      detail: "timeout",
    })
  })

  it("maps exit code 1 without a signature to a scanner error", () => {
    expect(parseClamdScanOutput(result({ code: 1, stdout: "something odd\n" }))).toEqual({
      kind: "error",
      detail: "scanner_error",
    })
  })

  it("maps a missing binary to a scanner error", () => {
    expect(parseClamdScanOutput(result({ code: null, stderr: "spawn clamdscan ENOENT" }))).toEqual({
      kind: "error",
      detail: "scanner_error",
    })
  })

  it("ignores a summary line that mentions FOUND as a word", () => {
    expect(
      parseClamdScanOutput(result({ code: 0, stdout: "x: OK\n----------- SCAN SUMMARY -----------\nInfected files: 0\n" })),
    ).toEqual({ kind: "clean" })
  })
})

describe("classifySignature", () => {
  it("keeps a real detection as infected", () => {
    expect(classifySignature("Eicar-Test-Signature")).toEqual({
      kind: "infected",
      signature: "Eicar-Test-Signature",
    })
  })

  it("treats a broken executable alert as a detection", () => {
    expect(classifySignature("Heuristics.Broken.Executable")).toEqual({
      kind: "infected",
      signature: "Heuristics.Broken.Executable",
    })
  })

  it("treats an encrypted alert as a rejection", () => {
    expect(classifySignature("Heuristics.Encrypted.Archive")).toEqual({
      kind: "rejected",
      detail: "encrypted_archive",
    })
  })
})

describe("parseClamdVersion", () => {
  it("reads the engine and signature version", () => {
    expect(parseClamdVersion("ClamAV 1.4.6/28186/Wed Nov 18 06:11:37 2026\n")).toEqual({
      engine: "1.4.6",
      signatureVersion: "28186",
    })
  })

  it("reads a two part engine version", () => {
    expect(parseClamdVersion("ClamAV 0.103/26000/Tue Oct  4 10:00:00 2022")).toEqual({
      engine: "0.103",
      signatureVersion: "26000",
    })
  })

  it("reads the engine alone when clamd is unreachable", () => {
    expect(
      parseClamdVersion(
        "ERROR: Could not connect to clamd on LocalSocket /var/run/clamav/clamd.ctl: No such file or directory\nClamAV 1.4.6\n",
      ),
    ).toEqual({ engine: "1.4.6", signatureVersion: null })
  })

  it("falls back to unknown on empty output", () => {
    expect(parseClamdVersion("")).toEqual({ engine: "unknown", signatureVersion: null })
  })
})

describe("readSignatureAgeHours", () => {
  it("returns the age of the newest database file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-db-"))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    const database = join(directory, "daily.cvd")
    await writeFile(database, "x")

    const thirtyHoursAgo = new Date("2026-11-17T00:00:00.000Z")
    await utimes(database, thirtyHoursAgo, thirtyHoursAgo)

    const age = await readSignatureAgeHours(directory, new Date("2026-11-18T06:00:00.000Z").getTime())

    expect(age).not.toBeNull()
    expect(age === null ? 0 : Math.round(age)).toBe(30)
  })

  it("uses the newest of several databases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-db-"))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    const old = join(directory, "main.cvd")
    const fresh = join(directory, "daily.cld")
    await writeFile(old, "x")
    await writeFile(fresh, "x")
    await utimes(old, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"))
    await utimes(fresh, new Date("2026-11-18T05:00:00.000Z"), new Date("2026-11-18T05:00:00.000Z"))

    const age = await readSignatureAgeHours(directory, new Date("2026-11-18T06:00:00.000Z").getTime())

    expect(age === null ? -1 : Math.round(age)).toBe(1)
  })

  it("ignores files that are not databases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-db-"))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    await writeFile(join(directory, "freshclam.dat"), "x")

    expect(await readSignatureAgeHours(directory, Date.now())).toBeNull()
  })

  it("returns null for a missing directory", async () => {
    expect(await readSignatureAgeHours(join(tmpdir(), "scanner-does-not-exist"), Date.now())).toBeNull()
  })

  it("never returns a negative age", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-db-"))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    const database = join(directory, "daily.cvd")
    await writeFile(database, "x")
    await utimes(database, new Date("2026-11-18T07:00:00.000Z"), new Date("2026-11-18T07:00:00.000Z"))

    expect(await readSignatureAgeHours(directory, new Date("2026-11-18T06:00:00.000Z").getTime())).toBe(0)
  })
})

describe("pingClamd", () => {
  it("answers true when clamd replies PONG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-sock-"))
    const socketPath = join(directory, "clamd.sock")

    const server: Server = createServer((socket: Socket) => {
      socket.on("data", () => {
        socket.write("PONG\0")
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(socketPath, () => {
        resolve()
      })
    })

    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    )
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    expect(await pingClamd(socketPath, 1000)).toBe(true)
  })

  it("answers false when nothing is listening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-sock-"))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    expect(await pingClamd(join(directory, "missing.sock"), 500)).toBe(false)
  })

  it("answers false when the peer never replies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-sock-"))
    const socketPath = join(directory, "silent.sock")

    const server: Server = createServer((socket: Socket) => {
      socket.on("data", () => undefined)
    })

    await new Promise<void>((resolve) => {
      server.listen(socketPath, () => {
        resolve()
      })
    })

    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    )
    cleanups.push(() => rm(directory, { recursive: true, force: true }))

    expect(await pingClamd(socketPath, 200)).toBe(false)
  })
})

describe("createEngineInfoCache", () => {
  it("loads once and reuses the value inside the hour", async () => {
    let clock = 1_000
    let loads = 0

    const cache = createEngineInfoCache(
      async () => {
        loads += 1

        return { engine: "1.4.6", signatureVersion: String(loads) }
      },
      () => clock,
    )

    expect(await cache.get()).toEqual({ engine: "1.4.6", signatureVersion: "1" })
    clock += 1000
    expect(await cache.get()).toEqual({ engine: "1.4.6", signatureVersion: "1" })
    expect(loads).toBe(1)
  })

  it("refreshes after an hour", async () => {
    let clock = 0
    let loads = 0

    const cache = createEngineInfoCache(
      async () => {
        loads += 1

        return { engine: "1.4.6", signatureVersion: String(loads) }
      },
      () => clock,
    )

    await cache.get()
    clock += 3_600_000
    expect(await cache.get()).toEqual({ engine: "1.4.6", signatureVersion: "2" })
    expect(loads).toBe(2)
  })

  it("keeps the last known value when loading fails", async () => {
    let clock = 0
    let fail = false

    const cache = createEngineInfoCache(
      async () => {
        if (fail) {
          throw new Error("boom")
        }

        return { engine: "1.4.6", signatureVersion: "28186" }
      },
      () => clock,
    )

    await cache.get()
    fail = true
    clock += 3_600_000

    expect(await cache.get()).toEqual({ engine: "1.4.6", signatureVersion: "28186" })
  })

  it("returns unknown when it never loaded", async () => {
    const cache = createEngineInfoCache(
      async () => {
        throw new Error("boom")
      },
      () => 0,
    )

    expect(await cache.get()).toEqual({ engine: "unknown", signatureVersion: null })
  })
})

describe("createReadinessProbe", () => {
  it("is ready when clamd answers and signatures are fresh", async () => {
    const probe = createReadinessProbe({
      ping: async () => true,
      signatureAge: async () => 5,
      now: () => 0,
    })

    expect(await probe()).toEqual({ ready: true, clamd: true, signatureAgeHours: 5 })
  })

  it("is not ready when clamd is down", async () => {
    const probe = createReadinessProbe({
      ping: async () => false,
      signatureAge: async () => 5,
      now: () => 0,
    })

    expect(await probe()).toEqual({ ready: false, clamd: false, signatureAgeHours: 5 })
  })

  it("is not ready when signatures are older than 72 hours", async () => {
    const probe = createReadinessProbe({
      ping: async () => true,
      signatureAge: async () => 72,
      now: () => 0,
    })

    expect(await probe()).toEqual({ ready: false, clamd: true, signatureAgeHours: 72 })
  })

  it("is ready at 71 hours", async () => {
    const probe = createReadinessProbe({
      ping: async () => true,
      signatureAge: async () => 71.9,
      now: () => 0,
    })

    expect((await probe()).ready).toBe(true)
  })

  it("is not ready when there is no signature database", async () => {
    const probe = createReadinessProbe({
      ping: async () => true,
      signatureAge: async () => null,
      now: () => 0,
    })

    expect(await probe()).toEqual({ ready: false, clamd: true, signatureAgeHours: null })
  })

  it("caches the answer for the ttl", async () => {
    let clock = 0
    let pings = 0

    const probe = createReadinessProbe({
      ping: async () => {
        pings += 1

        return true
      },
      signatureAge: async () => 1,
      now: () => clock,
      ttlMs: 5000,
    })

    await probe()
    clock += 1000
    await probe()

    expect(pings).toBe(1)

    clock += 5000
    await probe()

    expect(pings).toBe(2)
  })
})
