import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import { middleware } from "./middleware"
import { APP_HEADER } from "./lib/hosts"
import { TEST_JWT_SECRET } from "./tests/helpers/legacy-jwt"

// Characterization tests for the legacy middleware.
//
// These describe what middleware.ts already does on the paths its old matcher
// covered, before any host routing exists: every redirect, every pass-through
// and the app header it forwards. They were written and run against the
// unchanged file, and they must keep passing unchanged as host routing is added.
//
// Tokens are real HS256 tokens signed with the same library the app uses, so
// verification runs for real; nothing here reaches the network.

const PUBLIC_HOST = "affilova.vercel.app"
const ADMIN_HOST = "admin.affilova.vercel.app"

const HOST_ENV = {
  NEXT_PUBLIC_HOST_PUBLIC: PUBLIC_HOST,
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliate.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchant.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: ADMIN_HOST,
} as const

type TokenRole = "admin" | "vendor" | "affiliate" | "user" | "no-role" | "absurd"

const ROLES: Record<TokenRole, string | undefined> = {
  admin: "admin",
  vendor: "vendor",
  affiliate: "affiliate",
  user: "user",
  "no-role": "",
  absurd: "wizard",
}

async function tokenFor(role: TokenRole): Promise<string> {
  const { SignJWT } = await import("jose")

  const claims: Record<string, string> = {
    userId: `usr_${role}`,
    alphanumericId: "ABC0001",
    email: `${role}@example.com`,
  }

  const roleValue = ROLES[role]

  if (roleValue !== undefined) {
    claims.role = roleValue
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(TEST_JWT_SECRET))
}

function request(
  path: string,
  options: { host?: string; token?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { host: options.host ?? PUBLIC_HOST }

  if (options.token !== undefined) {
    headers.cookie = `auth-token=${options.token}`
  }

  return new NextRequest(`https://${options.host ?? PUBLIC_HOST}${path}`, { headers })
}

type Outcome =
  | { kind: "next"; app: string | null }
  | { kind: "redirect"; location: string }

async function outcomeOf(options: Parameters<typeof request>[1] & { path: string }): Promise<Outcome> {
  const { path, ...rest } = options
  const response = await middleware(request(path, rest))

  const location = response.headers.get("location")

  if (location !== null) {
    return { kind: "redirect", location }
  }

  expect(response.headers.get("x-middleware-next")).toBe("1")

  // Next.js carries forwarded request headers on the response: the names in
  // x-middleware-override-headers, each value under x-middleware-request-*.
  const forwarded = response.headers.get(`x-middleware-request-${APP_HEADER}`)

  return { kind: "next", app: forwarded }
}

function redirectTo(path: string): string {
  return `https://${PUBLIC_HOST}${path}`
}

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  process.env.NEXT_PUBLIC_APP_ENV = "production"

  for (const [key, value] of Object.entries(HOST_ENV)) {
    process.env[key] = value
  }
})

describe("legacy middleware: signed out", () => {
  it("passes the auth pages through", async () => {
    await expect(outcomeOf({ path: "/auth/login" })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
    await expect(outcomeOf({ path: "/auth/register" })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
  })

  it("sends a signed-out visitor from the dashboard to the login page", async () => {
    await expect(outcomeOf({ path: "/dashboard" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/dashboard/vendor" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/dashboard/vendor/products" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/dashboard/admin/analytics" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })

  it("sends a signed-out visitor from role selection to the login page", async () => {
    await expect(outcomeOf({ path: "/dashboard/select-role" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })

  it("sends a signed-out visitor from the admin routes to the login page", async () => {
    await expect(outcomeOf({ path: "/admin" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/admin/users" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })

  it("treats a garbage token as no session", async () => {
    await expect(outcomeOf({ path: "/dashboard/vendor", token: "not-a-jwt" })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/auth/login", token: "not-a-jwt" })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
  })

  it("treats a token signed with another secret as no session", async () => {
    const { SignJWT } = await import("jose")
    const foreign = await new SignJWT({
      userId: "usr_x",
      alphanumericId: "ABC0001",
      email: "x@example.com",
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode("fedcba9876543210fedcba9876543210"))

    await expect(outcomeOf({ path: "/admin", token: foreign })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })

  it("treats a token with no role claim at all as no session", async () => {
    const { SignJWT } = await import("jose")
    const roleless = await new SignJWT({
      userId: "usr_x",
      alphanumericId: "ABC0001",
      email: "x@example.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(TEST_JWT_SECRET))

    await expect(outcomeOf({ path: "/dashboard/vendor", token: roleless })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })
})

describe("legacy middleware: a session with a real role", () => {
  it("leaves an admin on the admin routes", async () => {
    const token = await tokenFor("admin")

    await expect(outcomeOf({ path: "/admin", token })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
    await expect(outcomeOf({ path: "/admin/users", token })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
  })

  it("leaves each role on its own dashboard", async () => {
    await expect(outcomeOf({ path: "/dashboard/admin", token: await tokenFor("admin") })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
    await expect(
      outcomeOf({ path: "/dashboard/vendor", token: await tokenFor("vendor") }),
    ).resolves.toEqual({ kind: "next", app: "public" })
    await expect(
      outcomeOf({ path: "/dashboard/vendor/products", token: await tokenFor("vendor") }),
    ).resolves.toEqual({ kind: "next", app: "public" })
    await expect(
      outcomeOf({ path: "/dashboard/affiliate", token: await tokenFor("affiliate") }),
    ).resolves.toEqual({ kind: "next", app: "public" })
  })

  it("sends a signed-in user away from the auth pages", async () => {
    await expect(outcomeOf({ path: "/auth/login", token: await tokenFor("admin") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/dashboard/admin"),
    })
    await expect(
      outcomeOf({ path: "/auth/register", token: await tokenFor("vendor") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/vendor") })
    await expect(
      outcomeOf({ path: "/auth/login", token: await tokenFor("affiliate") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/affiliate") })
  })

  it("sends a signed-in user without a chosen role to role selection", async () => {
    await expect(outcomeOf({ path: "/auth/login", token: await tokenFor("user") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/dashboard/select-role"),
    })
    await expect(outcomeOf({ path: "/auth/login", token: await tokenFor("no-role") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/dashboard/select-role"),
    })
  })

  it("sends a signed-in user from someone else's dashboard to their own", async () => {
    await expect(
      outcomeOf({ path: "/dashboard/admin", token: await tokenFor("vendor") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/vendor") })
    await expect(
      outcomeOf({ path: "/dashboard/affiliate", token: await tokenFor("admin") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/admin") })
  })

  it("sends a signed-in user without a role from someone else's dashboard to role selection", async () => {
    await expect(outcomeOf({ path: "/dashboard/vendor", token: await tokenFor("user") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/dashboard/select-role"),
    })
    await expect(
      outcomeOf({ path: "/dashboard/vendor", token: await tokenFor("no-role") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/select-role") })
  })

  it("sends every non-admin from the admin routes to the login page", async () => {
    await expect(outcomeOf({ path: "/admin", token: await tokenFor("vendor") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/admin/users", token: await tokenFor("affiliate") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
    await expect(outcomeOf({ path: "/admin", token: await tokenFor("user") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/auth/login"),
    })
  })

  it("trusts any role string it does not recognise", async () => {
    // The legacy rules compare the role to "user" and otherwise use it as-is in
    // a redirect, so an unknown role is treated as a real one. This is recorded
    // here as the behaviour that must not change.
    await expect(outcomeOf({ path: "/auth/login", token: await tokenFor("absurd") })).resolves.toEqual({
      kind: "redirect",
      location: redirectTo("/dashboard/wizard"),
    })
  })

  it("lets a session pick its role, and moves it on once it has one", async () => {
    await expect(
      outcomeOf({ path: "/dashboard/select-role", token: await tokenFor("user") }),
    ).resolves.toEqual({ kind: "next", app: "public" })
    await expect(
      outcomeOf({ path: "/dashboard/select-role", token: await tokenFor("vendor") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/vendor") })
  })
})

describe("legacy middleware: the app header it forwards", () => {
  it("sets the public app for the public host", async () => {
    await expect(outcomeOf({ path: "/dashboard/vendor", token: await tokenFor("vendor") })).resolves.toEqual({
      kind: "next",
      app: "public",
    })
  })

  it("sets the app the host maps to", async () => {
    // A shared path, so this asserts the header alone: the request is passed
    // through on the host's app, before and after host routing exists.
    await expect(outcomeOf({ path: "/auth/login", host: ADMIN_HOST })).resolves.toEqual({
      kind: "next",
      app: "admin",
    })
  })

  it("replaces a spoofed header sent by the client", async () => {
    const spoofed = new NextRequest(`https://${PUBLIC_HOST}/auth/login`, {
      headers: { host: PUBLIC_HOST, [APP_HEADER]: "admin" },
    })

    const response = await middleware(spoofed)

    expect(response.headers.get(`x-middleware-request-${APP_HEADER}`)).toBe("public")
  })

  it("ignores the override in production", async () => {
    await expect(
      outcomeOf({ path: "/auth/login?app=admin", token: await tokenFor("user") }),
    ).resolves.toEqual({ kind: "redirect", location: redirectTo("/dashboard/select-role") })

    const response = await middleware(request("/auth/login?app=admin"))

    expect(response.headers.get(`x-middleware-request-${APP_HEADER}`)).toBe("public")
  })
})
