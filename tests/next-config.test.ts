import { describe, expect, it } from "vitest"

import nextConfig from "../next.config.mjs"

// The headers() function is the only thing standing between the app and a
// browser that has no transport or framing protection, so it is asserted
// exactly: each header once, with the value it is supposed to have.

type HeaderRule = { key: string; value: string }

async function headersForAllRoutes(): Promise<HeaderRule[]> {
  const rules = await nextConfig.headers?.()

  expect(rules).toBeDefined()
  expect(rules).toHaveLength(1)

  const [rule] = rules ?? []

  // Every route, not one path.
  expect(rule?.source).toBe("/:path*")

  return rule?.headers ?? []
}

function occurrences(headers: HeaderRule[], key: string): HeaderRule[] {
  return headers.filter((header) => header.key === key)
}

describe("next.config.mjs security headers", () => {
  it("applies the hardened headers to every route, each exactly once", async () => {
    const headers = await headersForAllRoutes()

    const expected: HeaderRule[] = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ]

    for (const header of expected) {
      const found = occurrences(headers, header.key)

      expect(found, `${header.key} should appear exactly once`).toHaveLength(1)
      expect(found[0]?.value).toBe(header.value)
    }
  })

  it("sends the CSP only as Report-Only and never as an enforcing header", async () => {
    const headers = await headersForAllRoutes()

    const enforcing = occurrences(headers, "Content-Security-Policy")

    expect(enforcing).toHaveLength(0)

    const reportOnly = occurrences(headers, "Content-Security-Policy-Report-Only")

    expect(reportOnly).toHaveLength(1)
  })

  it("reports violations to the CSP report endpoint", async () => {
    const headers = await headersForAllRoutes()
    const [csp] = occurrences(headers, "Content-Security-Policy-Report-Only")

    expect(csp?.value).toContain("report-uri /api/csp-report")
  })

  it("keeps the directives the app relies on", async () => {
    const headers = await headersForAllRoutes()
    const [csp] = occurrences(headers, "Content-Security-Policy-Report-Only")
    const policy = csp?.value ?? ""

    const required = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src",
    ]

    for (const directive of required) {
      expect(policy, `policy should contain "${directive}"`).toContain(directive)
    }
  })

  it("lets the browser reach the two upload destinations from connect-src", async () => {
    const headers = await headersForAllRoutes()
    const [csp] = occurrences(headers, "Content-Security-Policy-Report-Only")
    const directive = (csp?.value ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("connect-src"))

    expect(directive).toBeDefined()
    expect(directive).toContain("https://api.cloudinary.com")
    expect(directive).toContain("https://*.r2.cloudflarestorage.com")
  })

  it("allows only the external origins the code really uses", async () => {
    const headers = await headersForAllRoutes()
    const [csp] = occurrences(headers, "Content-Security-Policy-Report-Only")
    const policy = csp?.value ?? ""

    const needed = [
      "https://challenges.cloudflare.com",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://res.cloudinary.com",
      "https://lh3.googleusercontent.com",
      // Browser uploads: product images go to Cloudinary's upload endpoint, and
      // vendor files to a signed R2 URL. Both are connect-src, not img-src.
      "https://api.cloudinary.com",
      "https://*.r2.cloudflarestorage.com",
    ]

    for (const origin of needed) {
      expect(policy, `policy should allow ${origin}`).toContain(origin)
    }

    const unused = [
      "https://va.vercel-scripts.com",
      "https://vitals.vercel-insights.com",
      "https://js.paystack.co",
      "https://checkout.paystack.com",
      "https://api.paystack.co",
      "https://api.pwnedpasswords.com",
      "https://checkout.squadco.com",
      "https://popup.squadco.com",
    ]

    for (const origin of unused) {
      expect(policy, `policy should not allow ${origin}`).not.toContain(origin)
    }
  })
})

type RedirectRule = {
  source: string
  destination: string
  permanent: boolean
  missing?: { type: string; key?: string; value?: string }[]
}

async function redirectRules(): Promise<RedirectRule[]> {
  const rules = await nextConfig.redirects?.()

  expect(rules).toBeDefined()

  return (rules ?? []) as RedirectRule[]
}

describe("next.config.mjs redirects for the removed legacy addresses", () => {
  const cases: { source: string; destination: string; permanent: boolean }[] = [
    { source: "/auth/login", destination: "/sign-in", permanent: true },
    { source: "/auth/register", destination: "/sign-up", permanent: true },
    { source: "/auth/forgot-password", destination: "/forgot-password", permanent: true },
    { source: "/auth/reset-password", destination: "/reset-password", permanent: true },
    { source: "/dashboard", destination: "/start", permanent: false },
    { source: "/dashboard/:path*", destination: "/start", permanent: false },
    { source: "/onboarding/:path*", destination: "/start", permanent: true },
    { source: "/products/:path*", destination: "/marketplace", permanent: true },
    { source: "/purchase/:path*", destination: "/marketplace", permanent: true },
  ]

  it.each(cases)("sends $source to $destination", async ({ source, destination, permanent }) => {
    const rule = (await redirectRules()).find((candidate) => candidate.source === source)

    expect(rule).toBeDefined()
    expect(rule?.destination).toBe(destination)
    expect(rule?.permanent).toBe(permanent)
  })

  it("has no other redirect", async () => {
    expect(await redirectRules()).toHaveLength(cases.length)
  })

  it("leaves /blog and /admin alone, so they answer 404", async () => {
    const sources = (await redirectRules()).map((rule) => rule.source)

    expect(sources.some((source) => source.startsWith("/blog"))).toBe(false)
    expect(sources.some((source) => source.startsWith("/admin"))).toBe(false)
  })

  it("does not redirect /products on an app host or in a preview override", async () => {
    const rule = (await redirectRules()).find((candidate) => candidate.source === "/products/:path*")
    const missing = rule?.missing ?? []

    expect(missing).toContainEqual({ type: "query", key: "app" })
    expect(missing).toContainEqual({ type: "cookie", key: "affilova_app" })
  })
})
