import { beforeEach, describe, expect, it, vi } from "vitest"

import { signCallback } from "@/lib/scanning/signature"

import * as routeModule from "./route"

// The callback route is exercised through its real signature check: the bodies
// here are signed with the same secret the route reads, so a change to the
// signed string fails these tests rather than passing them.

const CALLBACK_SECRET = "fedcba9876543210fedcba9876543210"

process.env.SCANNER_URL = "https://scanner.example.com"
process.env.SCANNER_SHARED_SECRET = "0123456789abcdef0123456789abcdef"
process.env.SCANNER_CALLBACK_SECRET = CALLBACK_SECRET

const state = vi.hoisted(() => ({
  rpc: null as null | ((name: string, args: Record<string, unknown>) => unknown),
  rpcError: null as null | { message: string },
  enqueued: [] as { type: string; payload?: Record<string, unknown>; dedupeKey?: string }[],
  enqueueError: null as Error | null,
  allowed: true,
  logs: [] as { level: string; event: string; fields?: Record<string, unknown> }[],
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (state.rpcError !== null) {
        return { data: null, error: state.rpcError }
      }

      return { data: state.rpc?.(name, args) ?? null, error: null }
    },
  }),
}))

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: async (input: { type: string; payload?: Record<string, unknown>; dedupeKey?: string }) => {
    if (state.enqueueError !== null) {
      throw state.enqueueError
    }

    state.enqueued.push(input)

    return "job-id"
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimitKey: (parts: readonly string[]) => parts.join(":"),
  clientIpFromHeaders: () => "203.0.113.7",
  rateLimit: async () => ({
    allowed: state.allowed,
    remaining: state.allowed ? 1 : 0,
    resetAt: new Date(0),
  }),
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: (event: string, fields?: Record<string, unknown>) =>
      state.logs.push({ level: "info", event, fields }),
    warn: (event: string, fields?: Record<string, unknown>) =>
      state.logs.push({ level: "warn", event, fields }),
    error: (event: string, fields?: Record<string, unknown>) =>
      state.logs.push({ level: "error", event, fields }),
  },
}))

const FILE_ID = "20000000-0000-4000-8000-000000000001"
const SCAN_ID = "30000000-0000-4000-8000-000000000001"

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scanId: SCAN_ID,
    fileId: FILE_ID,
    verdict: "clean",
    detail: null,
    sha256: "a".repeat(64),
    detectedMime: "application/pdf",
    engine: "clamav-1.3",
    signatureVersion: "20261115",
    scannedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  })
}

function call(
  rawBody: string,
  options: {
    timestamp?: number | string
    signature?: string
    headers?: Record<string, string>
  } = {},
) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  const headers = new Headers({
    "content-type": "application/json",
    "x-scanner-timestamp": timestamp,
    "x-scanner-signature":
      options.signature ?? signCallback(CALLBACK_SECRET, timestamp, rawBody),
    ...(options.headers ?? {}),
  })

  return routeModule.POST(
    new Request("http://localhost/api/internal/scan-result", {
      method: "POST",
      headers,
      body: rawBody,
    }),
  )
}

beforeEach(() => {
  state.rpc = null
  state.rpcError = null
  state.enqueued = []
  state.enqueueError = null
  state.allowed = true
  state.logs = []
})

describe("POST /api/internal/scan-result", () => {
  it("records a clean verdict and answers ok", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    state.rpc = (name, args) => {
      calls.push({ name, args })

      return { duplicate: false, needs_quarantine: false, storage_key: null }
    }

    const response = await call(body())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        name: "record_scan_result",
        args: {
          p_scan: SCAN_ID,
          p_file: FILE_ID,
          p_verdict: "clean",
          p_detail: null,
          p_sha256: "a".repeat(64),
          p_detected_mime: "application/pdf",
          p_engine: "clamav-1.3",
          p_signature_version: "20261115",
        },
      },
    ])
    expect(state.enqueued).toEqual([])
  })

  it.each(["clean", "infected", "rejected", "needs_review", "error"])(
    "accepts a correctly signed %s callback",
    async (verdict) => {
      const response = await call(body({ verdict }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    },
  )

  it("answers 401 with an empty body for a bad signature", async () => {
    const response = await call(body(), { signature: "0".repeat(64) })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("answers 401 with an empty body for a missing signature", async () => {
    const response = await call(body(), { headers: { "x-scanner-signature": "" } })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("answers 401 for a body that was changed after signing", async () => {
    const signed = body()
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = signCallback(CALLBACK_SECRET, timestamp, signed)

    const response = await call(body({ verdict: "clean", detail: "tampered" }), {
      timestamp,
      signature,
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("answers 401 for a timestamp outside the five minute window", async () => {
    const old = Math.floor(Date.now() / 1000) - 400
    const response = await call(body(), { timestamp: old })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("answers 400 for malformed JSON", async () => {
    const response = await call("{not json")

    expect(response.status).toBe(400)
    expect(await response.text()).toBe("")
  })

  it("answers 400 for a well-formed body that is not a scan result", async () => {
    const response = await call(body({ verdict: "maybe" }))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe("")
  })

  it("answers 413 for a body over 16 KB, before reading it", async () => {
    const huge = body({ detail: "x".repeat(17 * 1024) })
    const response = await call(huge)

    expect(response.status).toBe(413)
    expect(await response.text()).toBe("")
  })

  it("answers 200 for a duplicate callback", async () => {
    state.rpc = () => ({ duplicate: true, needs_quarantine: false, storage_key: null })

    const response = await call(body({ verdict: "infected" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(state.enqueued).toEqual([])
  })

  it("answers 200 for a result whose scan id is stale", async () => {
    state.rpc = () => ({ stale: true })

    const response = await call(body({ verdict: "infected" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it("queues a quarantine copy for an infected file", async () => {
    state.rpc = () => ({
      needs_quarantine: true,
      storage_key: "products/p/f/guide.pdf",
    })

    const response = await call(body({ verdict: "infected", detail: "Eicar-Test-Signature" }))

    expect(response.status).toBe(200)
    expect(state.enqueued).toEqual([
      {
        type: "quarantine_file",
        payload: { storageKey: "products/p/f/guide.pdf" },
        dedupeKey: "quarantine_file:products/p/f/guide.pdf",
      },
    ])
  })

  it("logs an infection at error level with the file, verdict and detail only", async () => {
    state.rpc = () => ({ needs_quarantine: true, storage_key: "products/p/f/guide.pdf" })

    await call(body({ verdict: "infected", detail: "Eicar-Test-Signature" }))

    const entry = state.logs.find((log) => log.event === "scan_file_rejected")

    expect(entry?.level).toBe("error")
    expect(entry?.fields).toEqual({
      fileId: FILE_ID,
      verdict: "infected",
      detail: "Eicar-Test-Signature",
    })
  })

  it("logs a rejection at error level too", async () => {
    await call(body({ verdict: "rejected", detail: "type_mismatch" }))

    expect(state.logs.some((log) => log.level === "error" && log.event === "scan_file_rejected")).toBe(
      true,
    )
  })

  it("does not log a clean verdict as an error", async () => {
    await call(body({ verdict: "clean" }))

    expect(state.logs.some((log) => log.level === "error")).toBe(false)
  })

  it("answers 200 even when the quarantine job cannot be queued", async () => {
    state.rpc = () => ({ needs_quarantine: true, storage_key: "products/p/f/guide.pdf" })
    state.enqueueError = new Error("queue is down")

    const response = await call(body({ verdict: "infected" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(state.logs.some((log) => log.event === "scan_callback_quarantine_enqueue_failed")).toBe(
      true,
    )
  })

  it("answers 500 without detail when the result cannot be recorded", async () => {
    state.rpcError = { message: 'relation "file_scan_events" does not exist' }

    const response = await call(body())

    expect(response.status).toBe(500)
    expect(await response.text()).toBe("")
  })

  it("answers 429 when the caller is over the limit", async () => {
    state.allowed = false

    const response = await call(body())

    expect(response.status).toBe(429)
    expect(await response.text()).toBe("")
    expect(state.enqueued).toEqual([])
  })

  it("refuses every method except POST", async () => {
    const response = await routeModule.GET()

    expect(response.status).toBe(405)
    expect(await response.text()).toBe("")
  })
})
