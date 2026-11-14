import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/identity/session"
import { isPasswordBreached } from "@/lib/identity/password"

import {
  requestPasswordResetAction,
  signInAction,
  signInWithGoogleAction,
  signOutAction,
  signUpAction,
  updatePasswordAction,
} from "./actions"

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock("@/lib/identity/session", () => ({ getAuthUser: vi.fn() }))
vi.mock("@/lib/identity/password", () => ({ isPasswordBreached: vi.fn() }))

// The limiter is exercised in lib/rate-limit.test.ts; here it only has to be
// countable. A test blocks one budget by naming a fragment of its key.
const limitState = vi.hoisted(() => ({
  blockedParts: [] as string[],
  keys: [] as string[],
  parts: [] as string[][],
  calls: [] as { key: string; limit: number; windowSeconds: number; onError?: string }[],
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimitKey: (parts: readonly string[]) => {
    limitState.parts.push([...parts])

    return `sha256:${parts.join(":")}`
  },
  rateLimit: async (options: {
    key: string
    limit: number
    windowSeconds: number
    onError?: "allow" | "deny"
  }) => {
    limitState.keys.push(options.key)
    limitState.calls.push(options)

    const blocked = limitState.blockedParts.some((part) => options.key.includes(part))

    return {
      allowed: !blocked,
      remaining: blocked ? 0 : 1,
      resetAt: new Date("2026-11-14T09:00:00.000Z"),
    }
  },
  clientIpFromHeaders: () => "203.0.113.7",
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}))

// appUrl() inside the actions reads these through lib/env.ts. Values are read
// lazily, so setting them here is enough.
process.env.NEXT_PUBLIC_APP_ENV = "production"
process.env.NEXT_PUBLIC_APP_URL = "https://affilova.example.com"
process.env.NEXT_PUBLIC_HOST_PUBLIC = "affilova.vercel.app"
process.env.NEXT_PUBLIC_HOST_AFFILIATE = "affiliates.affilova.vercel.app"
process.env.NEXT_PUBLIC_HOST_MERCHANT = "merchants.affilova.vercel.app"
process.env.NEXT_PUBLIC_HOST_ACCOUNT = "account.affilova.vercel.app"
process.env.NEXT_PUBLIC_HOST_ADMIN = "admin.affilova.vercel.app"
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

type AuthError = { code?: string; message?: string } | null

type SignUpArgs = {
  email: string
  password: string
  options: { data: Record<string, string>; emailRedirectTo: string; captchaToken?: string }
}

type SignInArgs = {
  email: string
  password: string
  options?: { captchaToken?: string }
}

type OAuthArgs = {
  provider: string
  options: { redirectTo: string; skipBrowserRedirect: boolean }
}

type ResetArgs = { redirectTo: string; captchaToken?: string }

type UpdateArgs = { password: string }

type Result<T> = { data: T; error: AuthError }

function ok<T>(data: T): Result<T> {
  return { data, error: null }
}

function fail<T>(code: string, message: string): Result<T> {
  return { data: null as T, error: { code, message } }
}

function mockSupabase(auth: Record<string, unknown>): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth } as unknown as ServerClient)
}

const VALID_SIGNUP = {
  email: "  Person@Example.com ",
  password: "correct horse battery",
  firstName: " Ada ",
  lastName: "Lovelace",
  captchaToken: "turnstile-token",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isPasswordBreached).mockResolvedValue(false)
  vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1", email: "person@example.com" })
  limitState.blockedParts = []
  limitState.keys = []
  limitState.parts = []
  limitState.calls = []
})

describe("signUpAction", () => {
  it("passes the metadata, the confirm link and the captcha token to Supabase", async () => {
    const signUp = vi.fn(async (_args: SignUpArgs) => ok({ user: null, session: null }))
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: true, message: "Check your email to confirm your account" })
    expect(signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "correct horse battery",
      options: {
        data: { first_name: "Ada", last_name: "Lovelace" },
        emailRedirectTo: "https://affilova.vercel.app/auth/confirm",
        captchaToken: "turnstile-token",
      },
    })
  })

  it("returns the same body for a new user and for an obfuscated existing user", async () => {
    const signUp = vi.fn(async (_args: SignUpArgs) => ok({ user: null, session: null }))
    mockSupabase({ signUp })

    const newUser = await signUpAction(VALID_SIGNUP)

    // Supabase answers an address that already exists with a user that has no
    // identities, so a caller must not be able to tell the two apart.
    const obfuscated = vi.fn(async (_args: SignUpArgs) =>
      ok({ user: { id: "existing", identities: [] }, session: null }),
    )
    mockSupabase({ signUp: obfuscated })

    const existingUser = await signUpAction(VALID_SIGNUP)

    expect(existingUser).toEqual(newUser)
  })

  it("returns the same body when Supabase answers with an explicit email_exists error", async () => {
    const signUp = vi.fn(async (_args: SignUpArgs) =>
      fail<unknown>("email_exists", "A user with this email address has already been registered"),
    )
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: true, message: "Check your email to confirm your account" })
  })

  it("blocks a breached password without calling Supabase", async () => {
    vi.mocked(isPasswordBreached).mockResolvedValue(true)
    const signUp = vi.fn(async (_args: SignUpArgs) => ok({ user: null, session: null }))
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({
      ok: false,
      error: "This password has appeared in a data breach. Choose a different one.",
    })
    expect(isPasswordBreached).toHaveBeenCalledWith("correct horse battery")
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it("never returns a raw Supabase message", async () => {
    const signUp = vi.fn(async (_args: SignUpArgs) =>
      fail<unknown>(
        "unexpected_failure",
        'duplicate key value violates unique constraint "profiles_email_lower_key"',
      ),
    )
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
    expect(JSON.stringify(result)).not.toContain("duplicate key")
    expect(JSON.stringify(result)).not.toContain("profiles_email_lower_key")
  })

  it("returns the captcha message when the captcha fails", async () => {
    const signUp = vi.fn(async (_args: SignUpArgs) => fail<unknown>("captcha_failed", "captcha protection: request disallowed"))
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: false, error: "Verification failed. Please try again." })
  })

  it("rejects invalid input before doing any work", async () => {
    const result = await signUpAction({ ...VALID_SIGNUP, password: "short" })

    expect(result.ok).toBe(false)
    expect(isPasswordBreached).not.toHaveBeenCalled()
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it("returns a generic error instead of throwing when the client cannot be created", async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error("no cookies"))

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })
})

describe("signInAction", () => {
  it("returns the safe next path on success", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) => ok({ user: {}, session: {} }))
    mockSupabase({ signInWithPassword })

    const result = await signInAction({
      email: "person@example.com",
      password: "secret",
      captchaToken: "turnstile-token",
      next: "/dashboard/affiliate",
    })

    expect(result).toEqual({ ok: true, redirectTo: "/dashboard/affiliate" })
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "secret",
      options: { captchaToken: "turnstile-token" },
    })
  })

  it("falls back to / for an unsafe next value", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) => ok({ user: {}, session: {} }))
    mockSupabase({ signInWithPassword })

    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      const result = await signInAction({
        email: "person@example.com",
        password: "secret",
        next,
      })

      expect(result).toEqual({ ok: true, redirectTo: "/" })
    }
  })

  it("returns the fixed message for invalid credentials", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) =>
      fail<unknown>("invalid_credentials", "Invalid login credentials"),
    )
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "wrong" })

    expect(result).toEqual({ ok: false, error: "Incorrect email or password." })
  })

  it("asks for confirmation when the email is not confirmed", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) =>
      fail<unknown>("email_not_confirmed", "Email not confirmed"),
    )
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "secret" })

    expect(result).toEqual({ ok: false, error: "Confirm your email address first." })
  })

  it("returns the captcha message when the captcha fails", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) =>
      fail<unknown>("captcha_failed", "captcha protection: request disallowed"),
    )
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "secret" })

    expect(result).toEqual({ ok: false, error: "Verification failed. Please try again." })
  })

  it("never returns a raw Supabase message", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) =>
      fail<unknown>("unexpected_failure", "relation auth.users does not exist"),
    )
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "secret" })

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })

  it("rejects an empty password", async () => {
    const result = await signInAction({ email: "person@example.com", password: "" })

    expect(result.ok).toBe(false)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })
})

describe("signInWithGoogleAction", () => {
  it("returns the provider URL without redirecting the browser", async () => {
    const signInWithOAuth = vi.fn(async (_args: OAuthArgs) =>
      ok({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" }),
    )
    mockSupabase({ signInWithOAuth })

    const result = await signInWithGoogleAction()

    expect(result).toEqual({
      ok: true,
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    })
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://affilova.vercel.app/auth/callback",
        skipBrowserRedirect: true,
      },
    })
  })

  it("returns a safe error when the provider fails", async () => {
    const signInWithOAuth = vi.fn(async (_args: OAuthArgs) =>
      fail<{ url: string | null }>("provider_disabled", "Provider is not enabled"),
    )
    mockSupabase({ signInWithOAuth })

    const result = await signInWithGoogleAction()

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })

  it("returns a safe error when no URL comes back", async () => {
    const signInWithOAuth = vi.fn(async (_args: OAuthArgs) => ok({ url: null }))
    mockSupabase({ signInWithOAuth })

    const result = await signInWithGoogleAction()

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })
})

describe("signOutAction", () => {
  it("signs out and reports success", async () => {
    const signOut = vi.fn(async () => ok({}))
    mockSupabase({ signOut })

    await expect(signOutAction()).resolves.toEqual({ ok: true })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("still reports success when Supabase fails", async () => {
    const signOut = vi.fn(async () => fail<unknown>("unexpected_failure", "network"))
    mockSupabase({ signOut })

    await expect(signOutAction()).resolves.toEqual({ ok: true })
  })
})

describe("requestPasswordResetAction", () => {
  it("sends the recovery link to the confirm route with the reset next step", async () => {
    const resetPasswordForEmail = vi.fn(async (_email: string, _args: ResetArgs) => ok({}))
    mockSupabase({ resetPasswordForEmail })

    const result = await requestPasswordResetAction({
      email: " Person@Example.com ",
      captchaToken: "turnstile-token",
    })

    expect(result).toEqual({ ok: true })
    expect(resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: "https://affilova.vercel.app/auth/confirm?next=/auth/reset-password",
      captchaToken: "turnstile-token",
    })
  })

  it("always reports success, even when Supabase fails", async () => {
    const resetPasswordForEmail = vi.fn(async (_email: string, _args: ResetArgs) =>
      fail<unknown>("user_not_found", "User not found"),
    )
    mockSupabase({ resetPasswordForEmail })

    await expect(
      requestPasswordResetAction({ email: "missing@example.com" }),
    ).resolves.toEqual({ ok: true })
  })

  it("rejects an invalid email without calling Supabase", async () => {
    const result = await requestPasswordResetAction({ email: "not-an-email" })

    expect(result.ok).toBe(false)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })
})

describe("updatePasswordAction", () => {
  it("requires a signed-in user", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null)
    const updateUser = vi.fn(async (_args: UpdateArgs) => ok({}))
    mockSupabase({ updateUser })

    const result = await updatePasswordAction({ password: "a-new-password" })

    expect(result).toEqual({
      ok: false,
      error: "You need to sign in again to change your password.",
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it("blocks a breached password without calling Supabase", async () => {
    vi.mocked(isPasswordBreached).mockResolvedValue(true)
    const updateUser = vi.fn(async (_args: UpdateArgs) => ok({}))
    mockSupabase({ updateUser })

    const result = await updatePasswordAction({ password: "a-new-password" })

    expect(result).toEqual({
      ok: false,
      error: "This password has appeared in a data breach. Choose a different one.",
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it("updates the password for a signed-in user", async () => {
    const updateUser = vi.fn(async (_args: UpdateArgs) => ok({ user: {} }))
    mockSupabase({ updateUser })

    const result = await updatePasswordAction({ password: "a-new-password" })

    expect(result).toEqual({ ok: true })
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-password" })
  })

  it("rejects a password that is too short", async () => {
    const result = await updatePasswordAction({ password: "a".repeat(9) })

    expect(result.ok).toBe(false)
    expect(isPasswordBreached).not.toHaveBeenCalled()
  })

  it("returns a safe error when Supabase refuses", async () => {
    const updateUser = vi.fn(async (_args: UpdateArgs) =>
      fail<unknown>("same_password", "New password should be different from the old password."),
    )
    mockSupabase({ updateUser })

    const result = await updatePasswordAction({ password: "a-new-password" })

    expect(result).toEqual({
      ok: false,
      error: "Choose a password you have not used before.",
    })
  })
})

describe("rate limits on the auth actions", () => {
  const THROTTLED = "Too many attempts. Please wait a few minutes and try again."

  it("counts a sign-in attempt against both the address and the email", async () => {
    const signInWithPassword = vi.fn(async (_args: SignInArgs) => ok({ user: {}, session: {} }))
    mockSupabase({ signInWithPassword })

    await signInAction({ email: "Person@Example.com", password: "secret" })

    const budgets = limitState.calls.map((call) => [call.limit, call.windowSeconds])

    expect(budgets).toEqual([
      [10, 600],
      [5, 600],
    ])
    expect(limitState.parts).toEqual([
      ["sign-in", "ip", "203.0.113.7"],
      ["sign-in", "email", "person@example.com"],
    ])
    // Whatever reaches the limiter is the hash, never the raw value.
    expect(limitState.keys.every((key) => key.startsWith("sha256:"))).toBe(true)
    expect(limitState.calls.every((call) => call.onError === "allow")).toBe(true)
  })

  it("refuses a sign-in when the address has spent its budget", async () => {
    limitState.blockedParts = ["sign-in:ip:"]
    const signInWithPassword = vi.fn(async (_args: SignInArgs) => ok({ user: {}, session: {} }))
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "secret" })

    expect(result).toEqual({ ok: false, error: THROTTLED })
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("refuses a sign-in when the email has spent its budget", async () => {
    limitState.blockedParts = ["sign-in:email:"]
    const signInWithPassword = vi.fn(async (_args: SignInArgs) => ok({ user: {}, session: {} }))
    mockSupabase({ signInWithPassword })

    const result = await signInAction({ email: "person@example.com", password: "secret" })

    expect(result).toEqual({ ok: false, error: THROTTLED })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it("counts a sign-up against the address, five per hour", async () => {
    limitState.blockedParts = ["sign-up:ip:"]
    const signUp = vi.fn(async (_args: SignUpArgs) => ok({ user: null, session: null }))
    mockSupabase({ signUp })

    const result = await signUpAction(VALID_SIGNUP)

    expect(result).toEqual({ ok: false, error: THROTTLED })
    expect(limitState.calls).toEqual([
      expect.objectContaining({ limit: 5, windowSeconds: 3600, onError: "allow" }),
    ])
    expect(limitState.parts).toEqual([["sign-up", "ip", "203.0.113.7"]])
    // Nothing expensive runs after a refusal: no breach lookup, no Supabase.
    expect(isPasswordBreached).not.toHaveBeenCalled()
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it("counts a password reset against the address and the email", async () => {
    const resetPasswordForEmail = vi.fn(async (_email: string, _args: ResetArgs) =>
      ok({ data: {}, error: null }),
    )
    mockSupabase({ resetPasswordForEmail })

    await requestPasswordResetAction({ email: "person@example.com" })

    expect(limitState.calls.map((call) => [call.limit, call.windowSeconds])).toEqual([
      [5, 3600],
      [3, 3600],
    ])
    expect(limitState.parts).toEqual([
      ["request-password-reset", "ip", "203.0.113.7"],
      ["request-password-reset", "email", "person@example.com"],
    ])
  })

  it("refuses a password reset when the email has spent its budget", async () => {
    limitState.blockedParts = ["request-password-reset:email:"]
    const resetPasswordForEmail = vi.fn(async (_email: string, _args: ResetArgs) =>
      ok({ data: {}, error: null }),
    )
    mockSupabase({ resetPasswordForEmail })

    const result = await requestPasswordResetAction({ email: "person@example.com" })

    expect(result).toEqual({ ok: false, error: THROTTLED })
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it("counts a password update against the user, ten per hour", async () => {
    const updateUser = vi.fn(async (_args: UpdateArgs) => ok({ user: {} }))
    mockSupabase({ updateUser })

    await updatePasswordAction({ password: "a-new-password" })

    expect(limitState.calls).toEqual([
      expect.objectContaining({ limit: 10, windowSeconds: 3600, onError: "allow" }),
    ])
    expect(limitState.parts).toEqual([["update-password", "user", "user-1"]])
  })

  it("refuses a password update when the user has spent the budget", async () => {
    limitState.blockedParts = ["update-password:user:"]
    const updateUser = vi.fn(async (_args: UpdateArgs) => ok({ user: {} }))
    mockSupabase({ updateUser })

    const result = await updatePasswordAction({ password: "a-new-password" })

    expect(result).toEqual({ ok: false, error: THROTTLED })
    expect(isPasswordBreached).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it("does not count an attempt that a schema rejected", async () => {
    await signInAction({ email: "not-an-email", password: "secret" })

    expect(limitState.calls).toHaveLength(0)
  })
})
