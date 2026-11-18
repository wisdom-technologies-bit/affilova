import { describe, expect, it } from "vitest"

import {
  ConfigError,
  DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIX,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_PORT,
  DEFAULT_QUEUE_LIMIT,
  DEFAULT_WORK_DIR,
  MIN_SECRET_LENGTH,
  loadConfig,
} from "#config"
import type { ConfigEnv } from "#config"

const SECRET = "0123456789abcdef0123456789abcdef"

function validEnv(overrides: ConfigEnv = {}): ConfigEnv {
  return {
    SCANNER_SHARED_SECRET: `shared-${SECRET}`,
    SCANNER_CALLBACK_SECRET: `callback-${SECRET}`,
    ALLOWED_CALLBACK_ORIGINS: "https://app.affilova.test",
    ...overrides,
  }
}

function configErrorFrom(env: ConfigEnv): ConfigError {
  try {
    loadConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) {
      return error
    }

    throw error
  }

  throw new Error("loadConfig did not throw")
}

describe("loadConfig", () => {
  it("applies every documented default", () => {
    const config = loadConfig(validEnv())

    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.maxFileBytes).toBe(DEFAULT_MAX_FILE_BYTES)
    expect(config.workDir).toBe(DEFAULT_WORK_DIR)
    expect(config.concurrency).toBe(DEFAULT_CONCURRENCY)
    expect(config.queueLimit).toBe(DEFAULT_QUEUE_LIMIT)
    expect(config.allowedDownloadHostSuffix).toBe(DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIX)
    expect(config.allowedCallbackOrigins).toEqual(["https://app.affilova.test"])
  })

  it.each([
    ["SCANNER_SHARED_SECRET"],
    ["SCANNER_CALLBACK_SECRET"],
    ["ALLOWED_CALLBACK_ORIGINS"],
  ])("names %s when it is missing", (variable) => {
    const env: Record<string, string | undefined> = { ...validEnv() }
    delete env[variable]

    const error = configErrorFrom(env)

    expect(error.variable).toBe(variable)
    expect(error.message).toContain(variable)
    expect(error.message).toContain("required")
  })

  it("treats a blank required value as missing", () => {
    const error = configErrorFrom(validEnv({ SCANNER_SHARED_SECRET: "   " }))

    expect(error.variable).toBe("SCANNER_SHARED_SECRET")
  })

  it.each([
    ["SCANNER_SHARED_SECRET"],
    ["SCANNER_CALLBACK_SECRET"],
  ])("rejects a short %s without echoing it", (variable) => {
    const error = configErrorFrom(validEnv({ [variable]: "too-short" }))

    expect(error.variable).toBe(variable)
    expect(error.message).toContain(String(MIN_SECRET_LENGTH))
    expect(error.message).not.toContain("too-short")
  })

  it("accepts exactly the minimum secret length", () => {
    const config = loadConfig(validEnv({ SCANNER_SHARED_SECRET: "x".repeat(MIN_SECRET_LENGTH) }))

    expect(config.sharedSecret).toHaveLength(MIN_SECRET_LENGTH)
  })

  it("keeps secret whitespace intact", () => {
    const secret = `  ${SECRET}  `
    const config = loadConfig(validEnv({ SCANNER_CALLBACK_SECRET: secret }))

    expect(config.callbackSecret).toBe(secret)
  })

  it("reads the overrides", () => {
    const config = loadConfig(
      validEnv({
        PORT: "9090",
        MAX_FILE_BYTES: "1024",
        WORK_DIR: "/tmp/scanner-work",
        CONCURRENCY: "4",
        QUEUE_LIMIT: "7",
        ALLOWED_DOWNLOAD_HOST_SUFFIX: "storage.affilova.test",
      }),
    )

    expect(config.port).toBe(9090)
    expect(config.maxFileBytes).toBe(1024)
    expect(config.workDir).toBe("/tmp/scanner-work")
    expect(config.concurrency).toBe(4)
    expect(config.queueLimit).toBe(7)
    expect(config.allowedDownloadHostSuffix).toBe(".storage.affilova.test")
  })

  it.each([
    ["PORT", "abc"],
    ["PORT", "0"],
    ["PORT", "70000"],
    ["PORT", "-1"],
    ["CONCURRENCY", "0"],
    ["QUEUE_LIMIT", "0"],
    ["MAX_FILE_BYTES", "0"],
    ["MAX_FILE_BYTES", "1.5"],
  ])("rejects %s=%s", (variable, value) => {
    const error = configErrorFrom(validEnv({ [variable]: value }))

    expect(error.variable).toBe(variable)
  })

  it("normalises the download host suffix", () => {
    expect(loadConfig(validEnv({ ALLOWED_DOWNLOAD_HOST_SUFFIX: "R2.CloudflareStorage.com." })).allowedDownloadHostSuffix).toBe(
      ".r2.cloudflarestorage.com",
    )
  })

  it("accepts several callback origins and removes duplicates", () => {
    const config = loadConfig(
      validEnv({
        ALLOWED_CALLBACK_ORIGINS: "https://app.affilova.test, https://app.affilova.test/,https://staging.affilova.test:8443",
      }),
    )

    expect(config.allowedCallbackOrigins).toEqual([
      "https://app.affilova.test",
      "https://staging.affilova.test:8443",
    ])
  })

  it.each([
    ["http://app.affilova.test", "https"],
    ["https://app.affilova.test/api/internal/scan-result", "origin"],
    ["https://app.affilova.test?x=1", "origin"],
    ["https://user:pass@app.affilova.test", "credentials"],
    ["not a url", "valid URL"],
    [",,", "at least one origin"],
  ])("rejects the callback origin %s", (value, expected) => {
    const error = configErrorFrom(validEnv({ ALLOWED_CALLBACK_ORIGINS: value }))

    expect(error.variable).toBe("ALLOWED_CALLBACK_ORIGINS")
    expect(error.message).toContain(expected)
  })
})
