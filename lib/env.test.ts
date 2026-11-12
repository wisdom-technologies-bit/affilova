import { describe, expect, it } from "vitest"

import { parsePublicEnv, parseServerEnv } from "./env"

const validPublicSource = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.vercel.app",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
}

const validServerSource = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "0123456789abcdef0123456789abcdef",
}

describe("parsePublicEnv", () => {
  it("accepts a complete set of public variables", () => {
    const env = parsePublicEnv(validPublicSource)

    expect(env.NEXT_PUBLIC_APP_ENV).toBe("production")
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://affilova.vercel.app")
    expect(env.NEXT_PUBLIC_HOST_ADMIN).toBe("admin.affilova.vercel.app")
  })

  it("rejects a host name that includes a protocol", () => {
    expect(() =>
      parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_HOST_PUBLIC: "https://affilova.vercel.app" }),
    ).toThrow(/NEXT_PUBLIC_HOST_PUBLIC/)
  })

  it("rejects an unknown NEXT_PUBLIC_APP_ENV", () => {
    expect(() =>
      parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_APP_ENV: "staging" }),
    ).toThrow(/NEXT_PUBLIC_APP_ENV/)
  })

  it("reports every missing public variable by name", () => {
    let message = ""

    try {
      parsePublicEnv({})
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("NEXT_PUBLIC_APP_ENV")
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  })

  it("allows the optional public variables to be absent", () => {
    const env = parsePublicEnv(validPublicSource)

    expect(env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY).toBeUndefined()
    expect(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined()
  })
})

describe("parseServerEnv", () => {
  it("accepts a complete set of server variables", () => {
    const env = parseServerEnv(validServerSource)

    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-key")
    expect(env.CRON_SECRET).toHaveLength(32)
  })

  it("names SUPABASE_SERVICE_ROLE_KEY when it is missing", () => {
    expect(() =>
      parseServerEnv({ ...validServerSource, SUPABASE_SERVICE_ROLE_KEY: undefined }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it("rejects a CRON_SECRET shorter than 32 characters", () => {
    expect(() => parseServerEnv({ ...validServerSource, CRON_SECRET: "too-short" })).toThrow(
      /CRON_SECRET/,
    )
  })

  it("allows the optional server variables to be absent", () => {
    const env = parseServerEnv(validServerSource)

    expect(env.PAYSTACK_SECRET_KEY).toBeUndefined()
    expect(env.R2_ACCOUNT_ID).toBeUndefined()
    expect(env.BREVO_API_KEY).toBeUndefined()
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined()
    expect(env.CLOUDINARY_API_KEY).toBeUndefined()
    expect(env.COOKIE_DOMAIN).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.JWT_SECRET).toBeUndefined()
  })
})
