import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabase/server"

import { GET } from "./route"

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }))

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

type VerifyArgs = { type: string; token_hash: string }

type VerifyResult = { data: unknown; error: { code?: string; message?: string } | null }

const verifyOtp = vi.fn(async (_args: VerifyArgs): Promise<VerifyResult> => ({
  data: { user: {} },
  error: null,
}))

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
  verifyOtp.mockResolvedValue({ data: { user: {} }, error: null })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { verifyOtp },
  } as unknown as ServerClient)
})

describe("GET /auth/confirm", () => {
  it("accepts every email token type Supabase issues", async () => {
    const types = ["signup", "invite", "magiclink", "recovery", "email_change", "email"]

    for (const type of types) {
      const response = await GET(
        request(
          `https://affilova.vercel.app/auth/confirm?token_hash=hash-${type}&type=${type}&next=%2Fdashboard`,
        ),
      )

      expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: `hash-${type}` })
      expect(locationOf(response).pathname).toBe("/dashboard")
    }

    expect(verifyOtp).toHaveBeenCalledTimes(types.length)
  })

  it("sends a recovery link on to the reset-password page", async () => {
    const response = await GET(
      request(
        "https://affilova.vercel.app/auth/confirm?token_hash=abc&type=recovery&next=%2Fauth%2Freset-password",
      ),
    )

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" })
    expect(locationOf(response).pathname).toBe("/auth/reset-password")
  })

  it("normalises the type before matching", async () => {
    await GET(request("https://affilova.vercel.app/auth/confirm?token_hash=abc&type=%20Signup%20"))

    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" })
  })

  it("redirects to the root when no next is given", async () => {
    const response = await GET(
      request("https://affilova.vercel.app/auth/confirm?token_hash=abc&type=signup"),
    )

    expect(locationOf(response).pathname).toBe("/")
  })

  it("uses the request origin for the redirect", async () => {
    const response = await GET(
      request("https://account.affilova.vercel.app/auth/confirm?token_hash=abc&type=signup"),
    )

    expect(locationOf(response).origin).toBe("https://account.affilova.vercel.app")
  })

  it("rejects a missing token_hash", async () => {
    const response = await GET(request("https://affilova.vercel.app/auth/confirm?type=signup"))

    expect(locationOf(response).pathname).toBe("/sign-in")
    expect(locationOf(response).searchParams.get("error")).toBe("link_invalid")
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it("rejects a missing type", async () => {
    const response = await GET(request("https://affilova.vercel.app/auth/confirm?token_hash=abc"))

    expect(locationOf(response).searchParams.get("error")).toBe("link_invalid")
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it("rejects a type Supabase does not issue", async () => {
    for (const type of ["sms", "phone_change", "magic", "", "signup%20signup"]) {
      const response = await GET(
        request(
          `https://affilova.vercel.app/auth/confirm?token_hash=abc&type=${encodeURIComponent(type)}`,
        ),
      )

      expect(locationOf(response).searchParams.get("error")).toBe("link_invalid")
    }

    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it("redirects to the login page when the token is rejected", async () => {
    verifyOtp.mockResolvedValue({ data: null, error: { code: "otp_expired", message: "expired" } })

    const response = await GET(
      request("https://affilova.vercel.app/auth/confirm?token_hash=old&type=recovery"),
    )

    expect(locationOf(response).pathname).toBe("/sign-in")
    expect(locationOf(response).searchParams.get("error")).toBe("link_invalid")
  })

  it("redirects to the login page when the client cannot be created", async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error("no cookie store"))

    const response = await GET(
      request("https://affilova.vercel.app/auth/confirm?token_hash=abc&type=signup"),
    )

    expect(locationOf(response).searchParams.get("error")).toBe("link_invalid")
  })

  it("falls back to the root for open-redirect attempts", async () => {
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
          `https://affilova.vercel.app/auth/confirm?token_hash=abc&type=signup&next=${encodeURIComponent(next)}`,
        ),
      )

      const location = locationOf(response)

      expect(location.origin).toBe("https://affilova.vercel.app")
      expect(location.pathname).toBe("/")
      expect(location.href).not.toContain("evil.com")
    }
  })

  it("never reflects the token or an unknown query value into the redirect", async () => {
    const response = await GET(
      request(
        "https://affilova.vercel.app/auth/confirm?token_hash=secret-token&type=signup&error=%3Cscript%3E",
      ),
    )

    const location = locationOf(response)

    expect(location.href).toBe("https://affilova.vercel.app/")
    expect(location.href).not.toContain("secret-token")
    expect(location.href).not.toContain("script")
  })
})
