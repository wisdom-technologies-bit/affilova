import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabase/server"

import { GET } from "./route"

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }))

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

type ExchangeResult = { data: unknown; error: { code?: string; message?: string } | null }

function mockExchange(result: ExchangeResult | Error): void {
  const exchangeCodeForSession = vi.fn(async (_code: string) => {
    if (result instanceof Error) {
      throw result
    }

    return result
  })

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { exchangeCodeForSession },
  } as unknown as ServerClient)
}

function request(url: string): NextRequest {
  return new NextRequest(new URL(url))
}

function locationOf(response: Response): URL {
  const header = response.headers.get("location")

  expect(header).not.toBeNull()

  return new URL(header ?? "")
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to the next path", async () => {
    mockExchange({ data: { session: {} }, error: null })

    const response = await GET(
      request("https://affilova.vercel.app/auth/callback?code=one-time-code&next=%2Fdashboard"),
    )

    expect(response.status).toBe(307)
    expect(locationOf(response).href).toBe("https://affilova.vercel.app/dashboard")
  })

  it("uses the request origin for the redirect", async () => {
    mockExchange({ data: { session: {} }, error: null })

    const response = await GET(
      request("https://affiliates.affilova.vercel.app/auth/callback?code=c&next=%2Fdashboard"),
    )

    expect(locationOf(response).origin).toBe("https://affiliates.affilova.vercel.app")
  })

  it("redirects to the root when no next is given", async () => {
    mockExchange({ data: { session: {} }, error: null })

    const response = await GET(request("https://affilova.vercel.app/auth/callback?code=c"))

    expect(locationOf(response).pathname).toBe("/")
  })

  it("redirects to the login page when the code is missing", async () => {
    mockExchange({ data: { session: {} }, error: null })

    const response = await GET(request("https://affilova.vercel.app/auth/callback"))

    expect(locationOf(response).pathname).toBe("/auth/login")
    expect(locationOf(response).searchParams.get("error")).toBe("callback_failed")
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it("redirects to the login page when the exchange fails", async () => {
    mockExchange({ data: null, error: { code: "flow_state_not_found", message: "no flow state" } })

    const response = await GET(
      request("https://affilova.vercel.app/auth/callback?code=stale&next=%2Fdashboard"),
    )

    expect(locationOf(response).pathname).toBe("/auth/login")
    expect(locationOf(response).searchParams.get("error")).toBe("callback_failed")
  })

  it("redirects to the login page when the exchange throws", async () => {
    mockExchange(new Error("cookie store unavailable"))

    const response = await GET(request("https://affilova.vercel.app/auth/callback?code=c"))

    expect(locationOf(response).pathname).toBe("/auth/login")
    expect(locationOf(response).searchParams.get("error")).toBe("callback_failed")
  })

  it("falls back to the root for open-redirect attempts", async () => {
    mockExchange({ data: { session: {} }, error: null })

    const attempts = [
      "//evil.com",
      "https://evil.com",
      "/%2F%2Fevil.com",
      "/\\evil.com",
      "javascript:alert(1)",
    ]

    for (const next of attempts) {
      const response = await GET(
        request(
          `https://affilova.vercel.app/auth/callback?code=c&next=${encodeURIComponent(next)}`,
        ),
      )

      const location = locationOf(response)

      expect(location.origin).toBe("https://affilova.vercel.app")
      expect(location.pathname).toBe("/")
      expect(location.href).not.toContain("evil.com")
    }
  })
})
