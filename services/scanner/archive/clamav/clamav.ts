/**
 * ClamAV integration.
 *
 * Everything here spawns `clamdscan` with an argument array, never a shell
 * string. Parsing is separated from running so the exit code and output
 * interpretation can be unit tested with fake output.
 */

import { readdir, stat } from "node:fs/promises"
import { createConnection } from "node:net"
import { join } from "node:path"

import { runCommand } from "#exec"
import type { CommandResult } from "#exec"

/** Unix socket clamd listens on; kept in step with `clamd.conf`. */
export const CLAMD_SOCKET_PATH = "/run/clamav/clamd.sock"

/** Directory holding the signature databases; kept in step with `clamd.conf`. */
export const CLAMAV_DB_DIR = "/data/clamav"

export const SIGNATURE_MAX_AGE_HOURS = 72

export const CLAMDSCAN_TIMEOUT_MS = 300_000

const PING_TIMEOUT_MS = 2000

const ENGINE_INFO_TTL_MS = 3_600_000

export const PAYLOAD_ENGINE = "clamav"

export type ClamavOutcome =
  | { readonly kind: "clean" }
  | { readonly kind: "infected"; readonly signature: string }
  | { readonly kind: "rejected"; readonly detail: "encrypted_archive" | "archive_limits" }
  | { readonly kind: "error"; readonly detail: "scanner_error" | "timeout" }

export type ClamavInfo = {
  readonly engine: string
  readonly signatureVersion: string | null
}

export type Readiness = {
  readonly ready: boolean
  readonly clamd: boolean
  readonly signatureAgeHours: number | null
}

const ENCRYPTED_ALERT = /^heuristics\.encrypted/i

const LIMIT_ALERT = /^heuristics\.exceedsmax/i

const UNKNOWN_INFO: ClamavInfo = { engine: "unknown", signatureVersion: null }

/**
 * ClamAV raises `Heuristics.Encrypted.*` when it meets encrypted content and
 * `Heuristics.ExceedsMax*` when a limit stops it. Neither is a detection: both
 * mean the service could not look inside, so they map to a rejection with the
 * matching detail instead of `infected`.
 */
export function classifySignature(signature: string): ClamavOutcome {
  if (ENCRYPTED_ALERT.test(signature)) {
    return { kind: "rejected", detail: "encrypted_archive" }
  }

  if (LIMIT_ALERT.test(signature)) {
    return { kind: "rejected", detail: "archive_limits" }
  }

  return { kind: "infected", signature }
}

function extractSignature(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const marker = line.lastIndexOf(" FOUND")

    if (marker <= 0) {
      continue
    }

    const beforeMarker = line.slice(0, marker)
    const separator = beforeMarker.indexOf(": ")
    const name = (separator >= 0 ? beforeMarker.slice(separator + 2) : beforeMarker).trim()

    if (name !== "") {
      return name
    }
  }

  return null
}

/**
 * Turns a finished `clamdscan` run into an outcome.
 *
 * Exit codes: 0 clean, 1 infected (with the signature on the output line),
 * 2 error. Anything else is treated as an error. A timeout is always a timeout.
 */
export function parseClamdScanOutput(result: CommandResult): ClamavOutcome {
  if (result.timedOut) {
    return { kind: "error", detail: "timeout" }
  }

  const signature = extractSignature(`${result.stdout}\n${result.stderr}`)

  if (signature !== null) {
    return classifySignature(signature)
  }

  if (result.code === 0) {
    return { kind: "clean" }
  }

  if (result.code === 2) {
    return { kind: "error", detail: "scanner_error" }
  }

  return { kind: "error", detail: "scanner_error" }
}

/**
 * Reads the engine and signature database version out of `clamdscan --version`,
 * which prints `ClamAV 1.4.6/28186/Wed Nov 19 ...`.
 */
export function parseClamdVersion(stdout: string): ClamavInfo {
  const match = /ClamAV\s+(\d+\.\d+(?:\.\d+)?)[^\d/\s]*(?:\/(\d+))?/i.exec(stdout)

  if (match === null) {
    return UNKNOWN_INFO
  }

  const signatureVersion = match[2]

  return {
    engine: match[1],
    signatureVersion: signatureVersion === undefined ? null : signatureVersion,
  }
}

/**
 * Hours since the newest signature database file was written, or null when the
 * directory has no database yet.
 */
export async function readSignatureAgeHours(directory: string, nowMs: number): Promise<number | null> {
  let names: string[]

  try {
    names = await readdir(directory)
  } catch {
    return null
  }

  let newest = 0

  for (const name of names) {
    const lower = name.toLowerCase()

    if (!lower.endsWith(".cvd") && !lower.endsWith(".cld") && !lower.endsWith(".cud")) {
      continue
    }

    try {
      const info = await stat(join(directory, name))

      if (info.mtimeMs > newest) {
        newest = info.mtimeMs
      }
    } catch {
      continue
    }
  }

  if (newest === 0) {
    return null
  }

  const ageMs = nowMs - newest

  return ageMs <= 0 ? 0 : ageMs / 3_600_000
}

/**
 * Sends `PING` over the clamd unix socket and resolves true only when clamd
 * answers `PONG`.
 */
export function pingClamd(socketPath: string, timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false

    const socket = createConnection(socketPath)

    const finish = (value: boolean): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      finish(false)
    }, timeoutMs)

    socket.once("connect", () => {
      socket.write("zPING\0")
    })

    socket.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("PONG")) {
        finish(true)
      }
    })

    socket.once("error", () => {
      finish(false)
    })

    socket.once("close", () => {
      finish(false)
    })
  })
}

/**
 * Runs `clamdscan` over one file. `--fdpass` hands clamd the open descriptor so
 * the file does not need to be readable by the clamav user directly.
 */
export async function scanFile(filePath: string, timeoutMs: number = CLAMDSCAN_TIMEOUT_MS): Promise<ClamavOutcome> {
  const result = await runCommand("clamdscan", ["--no-summary", "--fdpass", filePath], { timeoutMs })

  return parseClamdScanOutput(result)
}

export type LoadClamavInfo = () => Promise<ClamavInfo>

/**
 * Caches the engine and signature version: loaded on first use, then refreshed
 * when the cached value is an hour old.
 */
export function createEngineInfoCache(load: LoadClamavInfo, now: () => number, ttlMs: number = ENGINE_INFO_TTL_MS): {
  readonly get: () => Promise<ClamavInfo>
} {
  let cached: ClamavInfo | null = null
  let expiresAt = 0

  return {
    get: async (): Promise<ClamavInfo> => {
      if (cached !== null && now() < expiresAt) {
        return cached
      }

      try {
        const info = await load()
        cached = info
        expiresAt = now() + ttlMs

        return info
      } catch {
        return cached ?? UNKNOWN_INFO
      }
    },
  }
}

export type ProbeClamd = () => Promise<boolean>

export type ProbeSignatureAge = () => Promise<number | null>

export type ReadinessProbe = () => Promise<Readiness>

export const READINESS_TTL_MS = 5000

/**
 * Probes clamd and the signature age, caching the answer briefly so a burst of
 * requests does not open one socket per request. Ready means clamd answered PING
 * and the signatures are younger than the maximum age.
 */
export function createReadinessProbe(options: {
  readonly ping: ProbeClamd
  readonly signatureAge: ProbeSignatureAge
  readonly now: () => number
  readonly ttlMs?: number
  readonly maxAgeHours?: number
}): ReadinessProbe {
  const ttlMs = options.ttlMs ?? READINESS_TTL_MS
  const maxAgeHours = options.maxAgeHours ?? SIGNATURE_MAX_AGE_HOURS

  let cached: Readiness | null = null
  let expiresAt = 0

  return async (): Promise<Readiness> => {
    if (cached !== null && options.now() < expiresAt) {
      return cached
    }

    const clamd = await options.ping()
    const signatureAgeHours = await options.signatureAge()
    const fresh = signatureAgeHours !== null && signatureAgeHours < maxAgeHours

    const readiness: Readiness = {
      ready: clamd && fresh,
      clamd,
      signatureAgeHours: signatureAgeHours === null ? null : Math.floor(signatureAgeHours),
    }

    cached = readiness
    expiresAt = options.now() + ttlMs

    return readiness
  }
}
