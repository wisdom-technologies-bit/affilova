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

  it("allows only the external origins the code really uses", async () => {
    const headers = await headersForAllRoutes()
    const [csp] = occurrences(headers, "Content-Security-Policy-Report-Only")
    const policy = csp?.value ?? ""

    const needed = [
      "https://challenges.cloudflare.com",
      "https://checkout.squadco.com",
      "https://popup.squadco.com",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://res.cloudinary.com",
      "https://lh3.googleusercontent.com",
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
    ]

    for (const origin of unused) {
      expect(policy, `policy should not allow ${origin}`).not.toContain(origin)
    }
  })
})
