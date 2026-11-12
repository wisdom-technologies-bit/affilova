import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock("@supabase/ssr", () => ({ createServerClient: state.createServerClient }))

type CookieToSet = { name: string; value: string; options: Record<string, unknown> }

type ServerClientOptions = {
  cookieOptions: Record<string, unknown>
  cookies: {
    getAll: () => { name: string; value: string }[]
    setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void
  }
}

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
}

function setEnv(overrides: Record<string, string> = {}): void {
  const values = { ...BASE_ENV, ...overrides }

  for (const key of Object.keys(BASE_ENV)) {
    process.env[key] = values[key]
  }
}

function installClient(): void {
  state.createServerClient.mockImplementation(
    (_url: string, _key: string, options: ServerClientOptions) => ({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
      options,
    }),
  )
}

function optionsOf(callIndex = 0): ServerClientOptions {
  const call = state.createServerClient.mock.calls[callIndex] as unknown as [
    string,
    string,
    ServerClientOptions,
  ]

  return call[2]
}

async function loadUpdateSession() {
  vi.resetModules()

  return (await import("./middleware")).updateSession
}

function makeRequest(cookieHeader?: string): NextRequest {
  const request = new NextRequest(new URL("https://affilova.vercel.app/dashboard"), {
    headers: cookieHeader === undefined ? undefined : { cookie: cookieHeader },
  })

  return request
}

beforeEach(() => {
  vi.clearAllMocks()
  setEnv()
  installClient()
  state.createServerClient.mockClear()
})

describe("updateSession", () => {
  it("returns the response it was given", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest()
    const response = NextResponse.next({ request })

    await expect(updateSession(request, response)).resolves.toBe(response)
  })

  it("calls the verifying getUser(), never getSession()", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest("sb-refresh=old")

    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } }
    state.createServerClient.mockImplementation(
      (_url: string, _key: string, _options: ServerClientOptions) => client,
    )

    await updateSession(request, NextResponse.next({ request }))

    expect(client.auth.getUser).toHaveBeenCalledTimes(1)
    expect(client.auth).not.toHaveProperty("getSession")
  })

  it("uses the configured project URL and anon key", async () => {
    const updateSession = await loadUpdateSession()

    await updateSession(makeRequest(), NextResponse.next())

    const call = state.createServerClient.mock.calls[0] as unknown as [string, string]

    expect(call[0]).toBe("https://project.supabase.co")
    expect(call[1]).toBe("anon-key")
  })

  it("reads the auth cookies from the request", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest("sb-refresh-token=old; other=1")

    await updateSession(request, NextResponse.next({ request }))

    expect(optionsOf().cookies.getAll()).toEqual([
      { name: "sb-refresh-token", value: "old" },
      { name: "other", value: "1" },
    ])
  })

  it("writes refreshed cookies to the request and to the response", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest("sb-refresh-token=old")
    const response = NextResponse.next({ request })

    await updateSession(request, response)

    const options = optionsOf()
    options.cookies.setAll(
      [
        { name: "sb-refresh-token", value: "new", options: { path: "/" } },
        { name: "sb-access-token", value: "access", options: { path: "/" } },
      ],
      {},
    )

    expect(request.cookies.get("sb-refresh-token")?.value).toBe("new")
    expect(request.cookies.get("sb-access-token")?.value).toBe("access")

    expect(response.cookies.get("sb-refresh-token")?.value).toBe("new")
    expect(response.cookies.get("sb-access-token")?.value).toBe("access")
  })

  it("passes the cache headers the client asks for onto the response", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest("sb-refresh-token=old")
    const response = NextResponse.next({ request })

    await updateSession(request, response)

    optionsOf().cookies.setAll([{ name: "sb-refresh-token", value: "new", options: {} }], {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Pragma: "no-cache",
    })

    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    )
    expect(response.headers.get("pragma")).toBe("no-cache")
  })

  it("applies the shared cookie options, secure in production", async () => {
    const updateSession = await loadUpdateSession()
    const request = makeRequest("sb-refresh-token=old")
    const response = NextResponse.next({ request })

    await updateSession(request, response)

    const options = optionsOf()

    expect(options.cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: true })

    options.cookies.setAll([{ name: "sb-refresh-token", value: "new", options: { path: "/" } }], {})

    const setCookie = response.headers.get("set-cookie") ?? ""

    expect(setCookie).toContain("sb-refresh-token=new")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("SameSite=lax")
    expect(setCookie).toContain("Secure")
  })

  it("does not mark cookies secure outside production", async () => {
    setEnv({ NEXT_PUBLIC_APP_ENV: "preview" })
    const updateSession = await loadUpdateSession()
    const request = makeRequest()
    const response = NextResponse.next({ request })

    await updateSession(request, response)

    optionsOf().cookies.setAll([{ name: "sb-refresh-token", value: "new", options: {} }], {})

    expect(optionsOf().cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: false })
    expect(response.headers.get("set-cookie") ?? "").not.toContain("Secure")
  })

  it("sets the cookie domain only when one is configured", async () => {
    setEnv({ NEXT_PUBLIC_COOKIE_DOMAIN: ".affilova.com" })
    const updateSession = await loadUpdateSession()
    const request = makeRequest()
    const response = NextResponse.next({ request })

    await updateSession(request, response)

    optionsOf().cookies.setAll([{ name: "sb-refresh-token", value: "new", options: {} }], {})

    expect(optionsOf().cookieOptions).toMatchObject({ domain: ".affilova.com" })
    expect(response.headers.get("set-cookie") ?? "").toContain("Domain=.affilova.com")
  })
})
