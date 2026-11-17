import { beforeEach, describe, expect, it, vi } from "vitest"

// The rate limiter talks to Postgres through the service role client only. The
// mock records the RPC call and replays one prepared answer.
const rpcState = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: { data: null, error: null } as { data: unknown; error: unknown },
  throws: null as Error | null,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcState.calls.push({ name, args })

      if (rpcState.throws) {
        throw rpcState.throws
      }

      return rpcState.answer
    },
  }),
}))

import { clientIpFromHeaders, rateLimit, rateLimitKey } from "./rate-limit"

const KEY = "a".repeat(64)
const RESET_AT = "2026-11-14T09:10:00.000Z"

function answerWith(data: unknown, error: unknown = null) {
  rpcState.answer = { data, error }
}

let logged: string[] = []

// The logger writes one JSON line per call; the tests read the fields back.
function lastLog(): Record<string, unknown> {
  const line = logged[0]

  expect(line).toBeDefined()

  return JSON.parse(String(line)) as Record<string, unknown>
}

beforeEach(() => {
  rpcState.calls.length = 0
  rpcState.throws = null
  answerWith([{ allowed: true, remaining: 4, reset_at: RESET_AT }])
  logged = []
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((value) => String(value)).join(" "))
  })
})

describe("rateLimit", () => {
  it("calls rate_limit_hit with the snake_case arguments the function expects", async () => {
    await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(rpcState.calls).toEqual([
      {
        name: "rate_limit_hit",
        args: { p_key: KEY, p_limit: 5, p_window_seconds: 600 },
      },
    ])
  })

  it("returns the allowed answer with a Date", async () => {
    const result = await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
    expect(result.resetAt).toBeInstanceOf(Date)
    expect(result.resetAt.toISOString()).toBe(RESET_AT)
    expect(logged).toHaveLength(0)
  })

  it("returns a blocked answer unchanged", async () => {
    answerWith([{ allowed: false, remaining: 0, reset_at: RESET_AT }])

    const result = await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it("allows the request and logs once when the database answers with an error", async () => {
    answerWith(null, { message: "connection refused", code: "08006" })

    const result = await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(5)
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now() - 1000)
    expect(logged).toHaveLength(1)

    const line = lastLog()

    expect(line.level).toBe("error")
    expect(line.event).toBe("rate_limit_lookup_failed")
    expect(line.policy).toBe("allow")
    expect(line.reason).toBe("connection refused")
  })

  it("denies the request when onError is deny", async () => {
    answerWith(null, { message: "connection refused" })

    const result = await rateLimit({
      key: KEY,
      limit: 5,
      windowSeconds: 600,
      onError: "deny",
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(logged).toHaveLength(1)
    expect(lastLog().policy).toBe("deny")
  })

  it("never throws when the client itself throws, and honours onError", async () => {
    rpcState.throws = new Error("socket hang up")

    const allowed = await rateLimit({ key: KEY, limit: 3, windowSeconds: 60 })

    expect(allowed.allowed).toBe(true)
    expect(allowed.remaining).toBe(3)
    expect(logged).toHaveLength(1)

    logged = []

    const denied = await rateLimit({
      key: KEY,
      limit: 3,
      windowSeconds: 60,
      onError: "deny",
    })

    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
    expect(logged).toHaveLength(1)
  })

  it("treats an empty or malformed answer as a failure", async () => {
    answerWith([])

    const empty = await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(empty.allowed).toBe(true)
    expect(logged).toHaveLength(1)

    logged = []
    answerWith([{ allowed: "yes", remaining: "four" }])

    const malformed = await rateLimit({
      key: KEY,
      limit: 5,
      windowSeconds: 600,
      onError: "deny",
    })

    expect(malformed.allowed).toBe(false)
    expect(logged).toHaveLength(1)
  })

  it("keeps the log line short", async () => {
    answerWith(null, { message: "x".repeat(5000) })

    await rateLimit({ key: KEY, limit: 5, windowSeconds: 600 })

    expect(logged).toHaveLength(1)

    // The message is cut to 200 characters before it reaches the logger, so a
    // database that answers with a novel cannot fill a log line.
    expect(String(lastLog().reason)).toHaveLength(200)
    expect(logged[0].length).toBeLessThan(400)
  })
})

describe("rateLimitKey", () => {
  it("is a stable SHA-256 hex digest of the joined parts", async () => {
    const first = rateLimitKey(["sign-in", "ip", "203.0.113.7"])
    const second = rateLimitKey(["sign-in", "ip", "203.0.113.7"])

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when any part changes", () => {
    const base = rateLimitKey(["sign-in", "ip", "203.0.113.7"])

    expect(rateLimitKey(["sign-up", "ip", "203.0.113.7"])).not.toBe(base)
    expect(rateLimitKey(["sign-in", "email", "203.0.113.7"])).not.toBe(base)
    expect(rateLimitKey(["sign-in", "ip", "203.0.113.8"])).not.toBe(base)
  })

  it("never contains the raw input, so an IP or email cannot leak", () => {
    const ip = "203.0.113.7"
    const email = "ada@example.com"

    const fromIp = rateLimitKey(["sign-in", "ip", ip])
    const fromEmail = rateLimitKey(["sign-in", "email", email])

    expect(fromIp).not.toContain(ip)
    expect(fromEmail).not.toContain(email)
    expect(fromEmail).not.toContain("ada")
    expect(fromEmail).not.toContain("example.com")
  })
})

describe("clientIpFromHeaders", () => {
  it("takes the only x-forwarded-for value", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" })

    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7")
  })

  it("takes the first entry of a proxy chain and trims it", () => {
    const headers = new Headers({
      "x-forwarded-for": "  203.0.113.7 , 70.41.3.18, 150.172.238.178",
    })

    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.4" })

    expect(clientIpFromHeaders(headers)).toBe("198.51.100.4")
  })

  it("falls back to x-real-ip when x-forwarded-for is present but empty", () => {
    const headers = new Headers({
      "x-forwarded-for": "   ",
      "x-real-ip": "198.51.100.4",
    })

    expect(clientIpFromHeaders(headers)).toBe("198.51.100.4")
  })

  it("answers unknown when neither header is usable", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown")
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "" }))).toBe("unknown")
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "   " }))).toBe("unknown")
  })
})
