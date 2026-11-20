import { afterEach, describe, expect, it, vi } from "vitest"

// Contract: the Turnstile challenge the buyer solves and the one the server
// accepts.
//
// The widget renders with an action name; the verifier requires one. They are
// separate modules (the verifier is server-only, the widget is a browser
// component), so this test is what keeps them equal: it uses the real action
// name, the real options builder, the real host list and the real verifier, and
// fakes only Cloudflare's siteverify response.

import { CHECKOUT_TURNSTILE_ACTION } from "@/lib/commerce/turnstile-action"
import { buildTurnstileOptions } from "@/lib/identity/turnstile"
import {
  TURNSTILE_ACTION,
  checkoutAllowedHostnames,
  verifyTurnstileToken,
} from "@/lib/security/turnstile-verify"

const FIVE_HOSTS = {
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
}

const ENV_KEYS = [...Object.keys(FIVE_HOSTS), "NEXT_PUBLIC_APP_ENV"] as const

function setHosts(): void {
  for (const [key, value] of Object.entries(FIVE_HOSTS)) {
    process.env[key] = value
  }

  delete process.env.NEXT_PUBLIC_APP_ENV
}

function siteverify(answer: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

describe("the widget's action is the verifier's action", () => {
  it("is the same word in both places", () => {
    expect(CHECKOUT_TURNSTILE_ACTION).toBe(TURNSTILE_ACTION)
  })

  it("is what the real options builder renders with", () => {
    // The widget builds its options through this function, so this is the value
    // Cloudflare is asked to put on the token.
    const options = buildTurnstileOptions(CHECKOUT_TURNSTILE_ACTION, "0x4AAAAAAA_site_key")

    expect(options.action).toBe(TURNSTILE_ACTION)
  })
})

describe("the hostname check accepts the five configured hosts", () => {
  it("lists exactly the five hosts from the environment", () => {
    setHosts()

    expect(checkoutAllowedHostnames().sort()).toEqual(Object.values(FIVE_HOSTS).sort())
  })

  it("accepts a token solved on any of the five", async () => {
    setHosts()

    const allowed = checkoutAllowedHostnames()

    expect(allowed).toHaveLength(5)

    for (const hostname of allowed) {
      const check = await verifyTurnstileToken("token-1", {
        secretKey: "turnstile-secret",
        fetch: siteverify({ success: true, action: TURNSTILE_ACTION, hostname }),
        allowedHostnames: allowed,
      })

      expect(check, hostname).toEqual({ ok: true })
    }
  })

  it("accepts a host whatever case and port the answer carries", async () => {
    setHosts()

    const check = await verifyTurnstileToken("token-1", {
      secretKey: "turnstile-secret",
      fetch: siteverify({
        success: true,
        action: TURNSTILE_ACTION,
        hostname: "Affiliates.Affilova.Vercel.App.:3000",
      }),
      allowedHostnames: checkoutAllowedHostnames(),
    })

    expect(check).toEqual({ ok: true })
  })

  it("refuses a host that is not one of them", async () => {
    setHosts()

    const check = await verifyTurnstileToken("token-1", {
      secretKey: "turnstile-secret",
      fetch: siteverify({ success: true, action: TURNSTILE_ACTION, hostname: "evil.example.com" }),
      allowedHostnames: checkoutAllowedHostnames(),
    })

    expect(check).toEqual({ ok: false, reason: "wrong_hostname" })
  })

  it("refuses a token solved for another action on a good host", async () => {
    setHosts()

    const check = await verifyTurnstileToken("token-1", {
      secretKey: "turnstile-secret",
      fetch: siteverify({ success: true, action: "sign_in", hostname: "affilova.vercel.app" }),
      allowedHostnames: checkoutAllowedHostnames(),
    })

    expect(check).toEqual({ ok: false, reason: "wrong_action" })
  })

  it("refuses everything when no host is configured", async () => {
    const check = await verifyTurnstileToken("token-1", {
      secretKey: "turnstile-secret",
      fetch: vi.fn() as unknown as typeof fetch,
      allowedHostnames: [],
    })

    expect(check).toEqual({ ok: false, reason: "not_configured" })
  })
})
