import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { middleware } from "./middleware"
import { APP_OVERRIDE_COOKIE } from "./lib/host-routing"
import { APP_HEADER, type AppName } from "./lib/hosts"
import { TEST_JWT_SECRET } from "./tests/helpers/legacy-jwt"

// What the middleware does per host: which app it resolves, which paths it
// rewrites, which it blocks and which it passes through.

const HOSTS: Record<AppName, string> = {
  public: "affilova.vercel.app",
  affiliate: "affilova-dashboard.vercel.app",
  merchant: "affilova-merchant.vercel.app",
  account: "affilova-account.vercel.app",
  admin: "affilova-admin.vercel.app",
}

const ENV: Record<string, string> = {
  NEXT_PUBLIC_HOST_PUBLIC: HOSTS.public,
  NEXT_PUBLIC_HOST_AFFILIATE: HOSTS.affiliate,
  NEXT_PUBLIC_HOST_MERCHANT: HOSTS.merchant,
  NEXT_PUBLIC_HOST_ACCOUNT: HOSTS.account,
  NEXT_PUBLIC_HOST_ADMIN: HOSTS.admin,
}

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  process.env.NEXT_PUBLIC_APP_ENV = "production"

  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

type Call = {
  host?: string
  cookie?: string
  path?: string
}

function request({ host = HOSTS.public, cookie, path = "/" }: Call = {}): NextRequest {
  const headers: Record<string, string> = { host }

  if (cookie !== undefined) {
    headers.cookie = cookie
  }

  return new NextRequest(`https://${host}${path}`, { headers })
}

type Result =
  | { kind: "pass"; app: string | null }
  | { kind: "rewrite"; to: string; app: string | null }
  | { kind: "not-found"; status: number }
  | { kind: "redirect"; location: string }

async function call(options: Call = {}): Promise<{ result: Result; setCookie: string[] }> {
  const response = await middleware(request(options))
  const setCookie = response.headers.getSetCookie()
  const app = response.headers.get(`x-middleware-request-${APP_HEADER}`)
  const location = response.headers.get("location")
  const rewrite = response.headers.get("x-middleware-rewrite")

  if (location !== null) {
    return { result: { kind: "redirect", location }, setCookie }
  }

  if (rewrite !== null) {
    return { result: { kind: "rewrite", to: new URL(rewrite).pathname + new URL(rewrite).search, app }, setCookie }
  }

  if (response.status === 404) {
    return { result: { kind: "not-found", status: response.status }, setCookie }
  }

  return { result: { kind: "pass", app }, setCookie }
}

beforeEach(() => {
  setEnv()
})

describe("middleware: each host serves its own app", () => {
  it("rewrites the root of each app host to its shell", async () => {
    for (const app of ["affiliate", "merchant", "account", "admin"] as const) {
      const { result } = await call({ host: HOSTS[app], path: "/" })

      expect(result, app).toEqual({ kind: "rewrite", to: `/hosts/${app}`, app })
    }
  })

  it("passes the public root through unchanged", async () => {
    await expect(call({ path: "/" })).resolves.toMatchObject({
      result: { kind: "pass", app: "public" },
    })
  })

  it("rewrites a nested path and keeps its query string", async () => {
    await expect(call({ host: HOSTS.merchant, path: "/products?page=2" })).resolves.toMatchObject({
      result: { kind: "rewrite", to: "/hosts/merchant/products?page=2", app: "merchant" },
    })
  })

  it("passes the shared paths through on an app host", async () => {
    await expect(call({ host: HOSTS.merchant, path: "/api/health" })).resolves.toMatchObject({
      result: { kind: "pass", app: "merchant" },
    })
    await expect(call({ host: HOSTS.admin, path: "/sign-in" })).resolves.toMatchObject({
      result: { kind: "pass", app: "admin" },
    })
    await expect(
      call({ host: HOSTS.account, path: "/auth/login?next=%2F" }),
    ).resolves.toMatchObject({ result: { kind: "pass", app: "account" } })
  })

  it("passes static files through on an app host", async () => {
    await expect(
      call({ host: HOSTS.merchant, path: "/brand/affilova-icon.svg" }),
    ).resolves.toMatchObject({ result: { kind: "pass", app: "merchant" } })
    await expect(call({ host: HOSTS.merchant, path: "/favicon.ico" })).resolves.toMatchObject({
      result: { kind: "pass", app: "merchant" },
    })
  })

  it("does not redirect a signed-out visitor itself: the layout does that", async () => {
    const { result } = await call({ host: HOSTS.merchant, path: "/" })

    expect(result.kind).toBe("rewrite")
  })
})

describe("middleware: the internal tree is blocked on every host", () => {
  it("returns 404 for /hosts/*", async () => {
    for (const host of Object.values(HOSTS)) {
      for (const path of ["/hosts", "/hosts/admin", "/hosts/merchant/products"]) {
        const { result } = await call({ host, path })

        expect(result, `${host} ${path}`).toEqual({ kind: "not-found", status: 404 })
      }
    }
  })

  it("returns 404 for an encoded /hosts path", async () => {
    for (const host of Object.values(HOSTS)) {
      const { result } = await call({ host, path: "/%68osts/admin" })

      expect(result, host).toEqual({ kind: "not-found", status: 404 })
    }
  })
})

describe("middleware: the legacy paths on an app host belong to the shell", () => {
  it("rewrites /dashboard/* instead of running the legacy redirects", async () => {
    await expect(
      call({ host: HOSTS.admin, path: "/dashboard/vendor", cookie: "auth-token=nonsense" }),
    ).resolves.toMatchObject({
      result: { kind: "rewrite", to: "/hosts/admin/dashboard/vendor", app: "admin" },
    })
  })

  it("rewrites /admin instead of redirecting a signed-out visitor", async () => {
    await expect(call({ host: HOSTS.merchant, path: "/admin" })).resolves.toMatchObject({
      result: { kind: "rewrite", to: "/hosts/merchant/admin", app: "merchant" },
    })
  })
})

describe("middleware: the preview override", () => {
  it("ignores ?app= in production", async () => {
    const { result, setCookie } = await call({ host: HOSTS.merchant, path: "/?app=admin" })

    expect(result).toMatchObject({ kind: "rewrite", to: "/hosts/merchant?app=admin", app: "merchant" })
    expect(setCookie).toEqual([])
  })

  it("sets the cookie and switches app in preview", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "preview" })

    const { result, setCookie } = await call({ host: HOSTS.public, path: "/?app=admin" })

    // The query string is kept, as it is on every rewrite.
    expect(result).toMatchObject({ kind: "rewrite", to: "/hosts/admin?app=admin", app: "admin" })
    expect(setCookie).toHaveLength(1)
    expect(setCookie[0]).toContain(`${APP_OVERRIDE_COOKIE}=admin`)
    expect(setCookie[0]).toContain("Path=/")
    expect(setCookie[0]).toContain("SameSite=lax")
    expect(setCookie[0]).toContain("HttpOnly")
    expect(setCookie[0]).not.toContain("Secure")
    // A session cookie: no expiry.
    expect(setCookie[0]).not.toMatch(/Max-Age|Expires/i)
  })

  it("reads the cookie on a later request", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "preview" })

    const { result, setCookie } = await call({
      host: HOSTS.merchant,
      path: "/products",
      cookie: `${APP_OVERRIDE_COOKIE}=account`,
    })

    expect(result).toMatchObject({ kind: "rewrite", to: "/hosts/account/products", app: "account" })
    expect(setCookie).toEqual([])
  })

  it("lets the parameter win over the cookie", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "preview" })

    const { result } = await call({
      host: HOSTS.merchant,
      path: "/?app=affiliate",
      cookie: `${APP_OVERRIDE_COOKIE}=account`,
    })

    expect(result).toMatchObject({ app: "affiliate" })
  })

  it("ignores an invalid cookie and an invalid parameter", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "preview" })

    await expect(
      call({ host: HOSTS.merchant, path: "/", cookie: `${APP_OVERRIDE_COOKIE}=wizard` }),
    ).resolves.toMatchObject({ result: { app: "merchant" } })

    await expect(call({ host: HOSTS.merchant, path: "/?app=wizard" })).resolves.toMatchObject({
      result: { app: "merchant" },
    })
  })

  it("has no effect when the app environment is not configured", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: undefined })

    const { result, setCookie } = await call({
      host: HOSTS.merchant,
      path: "/?app=admin",
      cookie: `${APP_OVERRIDE_COOKIE}=admin`,
    })

    expect(result).toMatchObject({ app: "merchant" })
    expect(setCookie).toEqual([])
  })
})

describe("middleware: a host that is not configured", () => {
  it("is treated as the public host", async () => {
    await expect(
      call({ host: "elsewhere.example.com", path: "/products" }),
    ).resolves.toMatchObject({ result: { kind: "pass", app: "public" } })
  })

  it("still blocks the internal tree", async () => {
    await expect(call({ host: "elsewhere.example.com", path: "/hosts/admin" })).resolves.toMatchObject({
      result: { kind: "not-found", status: 404 },
    })
  })
})
