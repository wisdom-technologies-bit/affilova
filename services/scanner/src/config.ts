/**
 * Environment parsing and validation.
 *
 * `loadConfig` is the only place that reads `process.env`. Every required value
 * that is missing or malformed raises a `ConfigError` whose message names the
 * offending variable, so startup fails with an actionable error instead of
 * running half configured. Secret values are never included in errors.
 */

export type ConfigEnv = Readonly<Record<string, string | undefined>>

export type ScannerConfig = {
  readonly port: number
  readonly sharedSecret: string
  readonly callbackSecret: string
  readonly allowedCallbackOrigins: readonly string[]
  readonly allowedDownloadHostSuffix: string
  readonly maxFileBytes: number
  readonly workDir: string
  readonly concurrency: number
  readonly queueLimit: number
}

export const DEFAULT_PORT = 10000
export const DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIX = ".r2.cloudflarestorage.com"
export const DEFAULT_MAX_FILE_BYTES = 2147483648
export const DEFAULT_WORK_DIR = "/data/tmp"
export const DEFAULT_CONCURRENCY = 2
export const DEFAULT_QUEUE_LIMIT = 100
export const MIN_SECRET_LENGTH = 32

export class ConfigError extends Error {
  readonly variable: string

  constructor(variable: string, reason: string) {
    super(`${variable} ${reason}`)
    this.name = "ConfigError"
    this.variable = variable
  }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ""
}

function readSecret(env: ConfigEnv, name: string): string {
  const raw = env[name]

  if (raw === undefined || raw.trim() === "") {
    throw new ConfigError(name, "is required")
  }

  if (raw.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(name, `must be at least ${MIN_SECRET_LENGTH} characters long`)
  }

  return raw
}

function readInteger(env: ConfigEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]

  if (isBlank(raw)) {
    return fallback
  }

  const trimmed = raw === undefined ? "" : raw.trim()

  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigError(name, "must be a whole number")
  }

  const value = Number(trimmed)

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(name, `must be between ${min} and ${max}`)
  }

  return value
}

function readRequired(env: ConfigEnv, name: string): string {
  const raw = env[name]

  if (isBlank(raw)) {
    throw new ConfigError(name, "is required")
  }

  return raw === undefined ? "" : raw.trim()
}

/**
 * Parses the comma separated callback origin allowlist into normalised origins
 * (`https://host[:port]`, no trailing slash).
 */
function readOrigins(env: ConfigEnv, name: string): readonly string[] {
  const raw = env[name]

  if (isBlank(raw)) {
    throw new ConfigError(name, "is required")
  }

  const origins = new Set<string>()
  const entries = (raw === undefined ? "" : raw).split(",")

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index].trim()

    if (entry === "") {
      continue
    }

    let parsed: URL

    try {
      parsed = new URL(entry)
    } catch {
      throw new ConfigError(name, `entry ${index + 1} is not a valid URL`)
    }

    if (parsed.protocol !== "https:") {
      throw new ConfigError(name, `entry ${index + 1} must use https`)
    }

    if (parsed.username !== "" || parsed.password !== "") {
      throw new ConfigError(name, `entry ${index + 1} must not embed credentials`)
    }

    if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      throw new ConfigError(name, `entry ${index + 1} must be an origin without a path, query or fragment`)
    }

    origins.add(parsed.origin)
  }

  if (origins.size === 0) {
    throw new ConfigError(name, "must list at least one origin")
  }

  return [...origins]
}

/**
 * Normalises the download host suffix to a lowercase value with a single
 * leading dot, so the guard can compare `.r2.cloudflarestorage.com`.
 */
function readHostSuffix(env: ConfigEnv, name: string): string {
  const raw = env[name]
  const base = isBlank(raw) ? DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIX : (raw === undefined ? "" : raw.trim().toLowerCase())
  const withoutTrailingDots = base.replace(/\.+$/, "")
  const suffix = withoutTrailingDots.startsWith(".") ? withoutTrailingDots : `.${withoutTrailingDots}`

  if (suffix === ".") {
    throw new ConfigError(name, "must be a host suffix such as .r2.cloudflarestorage.com")
  }

  return suffix
}

/**
 * Reads and validates the whole configuration. Throws `ConfigError` for the
 * first offending variable.
 */
export function loadConfig(env: ConfigEnv = process.env): ScannerConfig {
  return {
    port: readInteger(env, "PORT", DEFAULT_PORT, 1, 65535),
    sharedSecret: readSecret(env, "SCANNER_SHARED_SECRET"),
    callbackSecret: readSecret(env, "SCANNER_CALLBACK_SECRET"),
    allowedCallbackOrigins: readOrigins(env, "ALLOWED_CALLBACK_ORIGINS"),
    allowedDownloadHostSuffix: readHostSuffix(env, "ALLOWED_DOWNLOAD_HOST_SUFFIX"),
    maxFileBytes: readInteger(env, "MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES, 1, Number.MAX_SAFE_INTEGER),
    workDir: isBlank(env.WORK_DIR) ? DEFAULT_WORK_DIR : readRequired(env, "WORK_DIR"),
    concurrency: readInteger(env, "CONCURRENCY", DEFAULT_CONCURRENCY, 1, 1024),
    queueLimit: readInteger(env, "QUEUE_LIMIT", DEFAULT_QUEUE_LIMIT, 1, 1_000_000),
  }
}
