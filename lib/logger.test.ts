import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The Sentry module is mocked so the tests can see whether an error was
// reported, without a network or an initialised SDK.
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: sentry.captureException,
}))

import { logger } from "./logger"

type Line = Record<string, unknown>

let lines: Line[]

function capture(level: "log" | "warn" | "error"): void {
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    expect(args).toHaveLength(1)
    lines.push(JSON.parse(String(args[0])) as Line)
  })
}

function last(): Line {
  const line = lines.at(-1)

  expect(line).toBeDefined()

  return line ?? {}
}

beforeEach(() => {
  lines = []
  sentry.captureException.mockClear()
  capture("log")
  capture("warn")
  capture("error")
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "development")
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("logger", () => {
  it("writes one JSON line with level, event, time and the fields", () => {
    logger.info("job_ran", { type: "process-queue", completed: 2 })

    expect(lines).toHaveLength(1)
    expect(last().level).toBe("info")
    expect(last().event).toBe("job_ran")
    expect(last().type).toBe("process-queue")
    expect(last().completed).toBe(2)
    expect(typeof last().time).toBe("string")
    expect(new Date(String(last().time)).toISOString()).toBe(last().time)
  })

  it("uses the matching console method for each level", () => {
    const info = vi.spyOn(console, "log")
    const warn = vi.spyOn(console, "warn")
    const error = vi.spyOn(console, "error")

    logger.info("a")
    logger.warn("b")
    logger.error("c")

    expect(info).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("redacts a field whose key looks like a credential", () => {
    logger.info("sign_in", {
      email: "ada@example.com",
      password: "hunter2",
      pass: "x",
      token: "t",
      accessToken: "t",
      refresh_token: "t",
      secret: "s",
      authorization: "Bearer a",
      cookie: "c",
      apiKey: "k",
      api_key: "k",
      otp: "123456",
      status_code: 500,
    })

    for (const key of [
      "password",
      "pass",
      "token",
      "accessToken",
      "refresh_token",
      "secret",
      "authorization",
      "cookie",
      "apiKey",
      "api_key",
      "otp",
      "status_code",
    ]) {
      expect(last()[key], `${key} should be redacted`).toBe("[redacted]")
    }

    // An email address is masked, never redacted: it is still useful.
    expect(last().email).toBe("a***@example.com")
  })

  it("redacts by key pattern inside a nested object", () => {
    logger.warn("nested", { context: { password: "hunter2", route: "/checkout" } })

    expect(last().context).toEqual({ password: "[redacted]", route: "/checkout" })
  })

  it("masks an email address in a value", () => {
    logger.info("invite", { note: "sent to bob@example.com" })

    expect(last().note).toBe("sent to b***@example.com")
  })

  it("turns an Error into name and message", () => {
    logger.error("boom", { error: new TypeError("Failed to fetch") })

    const shape = last().error as Line

    expect(shape.name).toBe("TypeError")
    expect(shape.message).toBe("Failed to fetch")
  })

  it("includes the stack outside production and leaves it out in production", () => {
    logger.error("boom", { error: new Error("Failed to fetch") })

    expect(typeof (last().error as Line).stack).toBe("string")

    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production")
    logger.error("boom", { error: new Error("Failed to fetch") })

    expect((last().error as Line).stack).toBeUndefined()
  })

  it("cuts a value longer than 500 characters", () => {
    logger.info("long", { note: "x".repeat(900) })

    expect(String(last().note)).toHaveLength(500)
  })

  it("never throws on a circular object", () => {
    const circular: Record<string, unknown> = { note: "ada@example.com" }
    circular.self = circular

    expect(() => logger.info("circular", { circular })).not.toThrow()

    const shape = last().circular as Line

    expect(shape.note).toBe("a***@example.com")
    expect(shape.self).toBe("[circular]")
  })

  it("never throws on values JSON cannot represent", () => {
    expect(() =>
      logger.info("odd", {
        big: BigInt(10),
        when: new Date("2026-11-14T09:00:00.000Z"),
        missing: undefined,
        fn: () => undefined,
        list: [1, "ada@example.com", null],
      }),
    ).not.toThrow()

    expect(last().big).toBe("10")
    expect(last().when).toBe("2026-11-14T09:00:00.000Z")
    expect(last().list).toEqual([1, "a***@example.com", null])
  })

  it("reports an Error to Sentry only when a DSN is set", () => {
    const failure = new Error("Failed to fetch")

    logger.error("boom", { error: failure })

    expect(sentry.captureException).not.toHaveBeenCalled()

    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://examplePublicKey@o0.ingest.sentry.io/0")
    logger.error("boom", { error: failure })

    expect(sentry.captureException).toHaveBeenCalledTimes(1)
    expect(sentry.captureException).toHaveBeenCalledWith(failure)
  })

  it("does not report anything for info or warn", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://examplePublicKey@o0.ingest.sentry.io/0")

    logger.info("a", { error: new Error("x") })
    logger.warn("b", { error: new Error("x") })

    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it("does not report a non-Error field", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://examplePublicKey@o0.ingest.sentry.io/0")

    logger.error("boom", { error: { message: "not an Error instance" } })

    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
