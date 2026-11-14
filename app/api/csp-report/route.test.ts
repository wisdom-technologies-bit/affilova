import { beforeEach, describe, expect, it, vi } from "vitest"

// The route rate limits before it reads anything, through the service role
// client. The mock lets a test choose whether the limiter allows the request.
const rpcState = vi.hoisted(() => ({
  allowed: true,
  calls: 0,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async () => {
      rpcState.calls += 1

      return {
        data: [
          {
            allowed: rpcState.allowed,
            remaining: rpcState.allowed ? 59 : 0,
            reset_at: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
        error: null,
      }
    },
  }),
}))

import * as routeModule from "./route"

const { POST } = routeModule

const DOCUMENT_URL = "https://affilova.vercel.app/dashboard/vendor/products/01H8XYZ?token=secret123"

function cspReportBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "csp-report": {
      "document-uri": DOCUMENT_URL,
      "violated-directive": "script-src 'self'",
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://evil.example/tracker.js?id=99&email=ada@example.com",
      "source-file": DOCUMENT_URL,
      "line-number": 42,
      ...overrides,
    },
  })
}

function postRequest(body: string, contentType = "application/csp-report"): Request {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  })
}

let warnings: string[] = []

// The logger writes one JSON line per call.
function lastWarning(): Record<string, unknown> {
  const line = warnings[0]

  expect(line).toBeDefined()

  return JSON.parse(String(line)) as Record<string, unknown>
}

beforeEach(() => {
  rpcState.allowed = true
  rpcState.calls = 0
  warnings = []
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "))
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("POST /api/csp-report", () => {
  it("answers 204 for a normal report and logs exactly one line", async () => {
    const response = await POST(postRequest(cspReportBody()))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    expect(warnings).toHaveLength(1)
  })

  it("logs the directive and the blocked origin only", async () => {
    await POST(postRequest(cspReportBody()))

    expect(warnings).toHaveLength(1)

    const parsed = lastWarning()

    expect(parsed.level).toBe("warn")
    expect(parsed.event).toBe("csp_report_violation")
    expect(parsed.directive).toBe("script-src-elem")
    expect(parsed.blocked_origin).toBe("https://evil.example")

    const line = warnings[0] ?? ""

    // No document path, no ids, no query string, no email address.
    expect(line).not.toContain("dashboard")
    expect(line).not.toContain("01H8XYZ")
    expect(line).not.toContain("token")
    expect(line).not.toContain("secret123")
    expect(line).not.toContain("id=99")
    expect(line).not.toContain("ada@example.com")
    expect(line).not.toContain("tracker.js")
    expect(line).not.toContain("affilova.vercel.app")
  })

  it("falls back to violated-directive when there is no effective-directive", async () => {
    await POST(
      postRequest(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "img-src 'self'",
            "blocked-uri": "https://cdn.example.net/a.png?x=1",
          },
        }),
      ),
    )

    const parsed = lastWarning()

    expect(parsed.directive).toBe("img-src")
    expect(parsed.blocked_origin).toBe("https://cdn.example.net")
  })

  it("keeps a keyword blocked-uri as it is", async () => {
    await POST(
      postRequest(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "script-src",
            "blocked-uri": "inline",
          },
        }),
      ),
    )

    const parsed = lastWarning()

    expect(parsed.directive).toBe("script-src")
    expect(parsed.blocked_origin).toBe("inline")
  })

  it("accepts the application/json reporting API shape", async () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        body: {
          effectiveDirective: "script-src-elem",
          blockedURL: "https://evil.example/x.js?a=1",
        },
      },
    ])

    const response = await POST(postRequest(body, "application/json"))

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("https://evil.example")
    expect(warnings[0]).not.toContain("a=1")
  })

  it("accepts a content type with a charset parameter", async () => {
    const response = await POST(postRequest(cspReportBody(), "application/csp-report; charset=utf-8"))

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(1)
  })

  it("answers 413 for a body over 8 KB and logs nothing", async () => {
    const oversized = JSON.stringify({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.example/x.js",
        padding: "a".repeat(9 * 1024),
      },
    })

    expect(oversized.length).toBeGreaterThan(8 * 1024)

    const response = await POST(postRequest(oversized))

    expect(response.status).toBe(413)
    expect(warnings).toHaveLength(0)
  })

  it("answers 413 from the declared length without reading the body", async () => {
    const request = new Request("http://localhost/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": String(64 * 1024),
      },
      body: cspReportBody(),
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(warnings).toHaveLength(0)
  })

  it("answers 204 and logs nothing when the limiter says no", async () => {
    rpcState.allowed = false

    const response = await POST(postRequest(cspReportBody()))

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(0)
    // One cheap lookup, and the body never parsed.
    expect(rpcState.calls).toBe(1)
  })

  it("answers 204 for malformed JSON without logging", async () => {
    const response = await POST(postRequest("{not json"))

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(0)
  })

  it("answers 204 for an unsupported content type without logging", async () => {
    const response = await POST(postRequest(cspReportBody(), "text/plain"))

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(0)
  })

  it("answers 204 for an empty body", async () => {
    const request = new Request("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
    })

    const response = await POST(request)

    expect(response.status).toBe(204)
    expect(warnings).toHaveLength(0)
  })

  it("exports POST only, so the reports cannot be read back", () => {
    expect(typeof POST).toBe("function")

    const exported = Object.keys(routeModule).sort()

    expect(exported).toContain("POST")
    expect(exported).not.toContain("GET")
    expect(exported).not.toContain("PUT")
    expect(exported).not.toContain("DELETE")
    expect(exported).not.toContain("PATCH")
    expect(exported).not.toContain("HEAD")
    expect(exported).not.toContain("OPTIONS")
  })
})
