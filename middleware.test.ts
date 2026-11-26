import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { middleware } from "./middleware"
import { APP_HEADER } from "./lib/hosts"

// What the middleware forwards on every request: the app header. The legacy
// token checks and role redirects were removed together with lib/auth.ts, so
// the middleware no longer reads a session and never redirects.

const PUBLIC_HOST = "affilova.vercel.app"
const ADMIN_HOST = "admin.affilova.vercel.app"

const HOST_ENV = {
  NEXT_PUBLIC_HOST_PUBLIC: PUBLIC_HOST,
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliate.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchant.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: ADMIN_HOST,
} as const

function request(path: string, host: string = PUBLIC_HOST): NextRequest {
  return new NextRequest(`https://${host}${path}`, { headers: { host } })
}

function forwardedApp(response: Response): string | null {
  return response.headers.get(`x-middleware-request-${APP_HEADER}`)
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_ENV = "production"

  for (const [key, value] of Object.entries(HOST_ENV)) {
    process.env[key] = value
  }
})

describe("middleware: it no longer reads a session", () => {
  it("passes the former legacy paths through on the public host without a redirect", async () => {
    for (const path of ["/dashboard", "/dashboard/vendor", "/admin", "/auth/login", "/auth/register"]) {
      const response = await middleware(request(path))

      expect(response.headers.get("location")).toBeNull()
      expect(response.headers.get("x-middleware-next")).toBe("1")
      expect(forwardedApp(response)).toBe("public")
    }
  })

  it("ignores a stale auth-token cookie", async () => {
    const response = await middleware(
      new NextRequest(`https://${PUBLIC_HOST}/dashboard`, {
        headers: { host: PUBLIC_HOST, cookie: "auth-token=nonsense" },
      }),
    )

    expect(response.headers.get("location")).toBeNull()
    expect(forwardedApp(response)).toBe("public")
  })
})

describe("middleware: the app header it forwards", () => {
  it("sets the public app for the public host", async () => {
    expect(forwardedApp(await middleware(request("/sign-in")))).toBe("public")
  })

  it("sets the app the host maps to", async () => {
    expect(forwardedApp(await middleware(request("/sign-in", ADMIN_HOST)))).toBe("admin")
  })

  it("replaces a spoofed header sent by the client", async () => {
    const spoofed = new NextRequest(`https://${PUBLIC_HOST}/sign-in`, {
      headers: { host: PUBLIC_HOST, [APP_HEADER]: "admin" },
    })

    expect(forwardedApp(await middleware(spoofed))).toBe("public")
  })

  it("ignores the override in production", async () => {
    expect(forwardedApp(await middleware(request("/sign-in?app=admin")))).toBe("public")
  })
})
