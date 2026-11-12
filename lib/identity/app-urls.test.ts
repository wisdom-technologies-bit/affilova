import { beforeEach, describe, expect, it, vi } from "vitest"

// appUrl reads the host map straight from process.env (through hostMapFromEnv)
// and the rest of the environment through lib/env.ts, which parses lazily and
// caches. Each test therefore sets the environment, resets the module registry
// and imports a fresh copy.

const BASE_ENV: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_COOKIE_DOMAIN: "",
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
}

function setEnv(overrides: Record<string, string> = {}): void {
  const values = { ...BASE_ENV, ...overrides }

  for (const key of Object.keys(BASE_ENV)) {
    process.env[key] = values[key]
  }
}

async function loadAppUrl(hostMap?: Record<string, string>) {
  vi.resetModules()

  if (hostMap === undefined) {
    vi.doUnmock("@/lib/hosts")
  } else {
    // lib/env.ts requires a host for every app, so the "no host for this app"
    // branches are driven by the host map itself.
    vi.doMock("@/lib/hosts", () => ({ hostMapFromEnv: () => hostMap }))
  }

  return (await import("./app-urls")).appUrl
}

beforeEach(() => {
  setEnv()
})

describe("appUrl", () => {
  it("uses the host configured for the app", async () => {
    const appUrl = await loadAppUrl()

    expect(appUrl("public", "/auth/confirm")).toBe("https://affilova.vercel.app/auth/confirm")
    expect(appUrl("affiliate", "/auth/callback")).toBe(
      "https://affiliates.affilova.vercel.app/auth/callback",
    )
    expect(appUrl("admin", "/")).toBe("https://admin.affilova.vercel.app/")
  })

  it("keeps the query string of the path", async () => {
    const appUrl = await loadAppUrl()

    expect(appUrl("public", "/auth/confirm?next=/auth/reset-password")).toBe(
      "https://affilova.vercel.app/auth/confirm?next=/auth/reset-password",
    )
  })

  it("falls back to the public host when the app has no host", async () => {
    const appUrl = await loadAppUrl({ public: "affilova.vercel.app" })

    expect(appUrl("affiliate", "/dashboard")).toBe("https://affilova.vercel.app/dashboard")
  })

  it("uses localhost in development when no host is configured", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "development" })
    const appUrl = await loadAppUrl({})

    expect(appUrl("public", "/dashboard")).toBe("http://localhost:3000/dashboard")
    expect(appUrl("affiliate", "/dashboard")).toBe("http://localhost:3000/dashboard")
  })

  it("prefers a configured host in development", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "development" })
    const appUrl = await loadAppUrl({ affiliate: "affiliates.affilova.vercel.app" })

    expect(appUrl("affiliate", "/dashboard")).toBe(
      "https://affiliates.affilova.vercel.app/dashboard",
    )
  })

  it("falls back to the canonical app URL when no host is configured at all", async () => {
    const appUrl = await loadAppUrl({})

    expect(appUrl("affiliate", "/dashboard")).toBe("https://affilova.example.com/dashboard")
  })

  it("throws when the path does not start with a slash", async () => {
    const appUrl = await loadAppUrl()

    expect(() => appUrl("public", "auth/confirm")).toThrow(/must start with "\/"/)
    expect(() => appUrl("public", "")).toThrow(/must start with "\/"/)
  })
})
