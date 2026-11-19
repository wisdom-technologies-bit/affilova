import { describe, expect, it, vi } from "vitest"

// Turnstile, redeemed on the server for checkout.
//
// Every branch fails closed: a missing secret, an unreachable service, a token
// solved for another action or another host all refuse the checkout. A checkout
// is the one place where "assume it was fine" costs money.

import { TURNSTILE_VERIFY_URL, verifyTurnstileToken, type TurnstileVerifyDeps } from "./turnstile-verify"

const SECRET = "0x4AAAAAAA_secret"
const HOSTS = ["affilova.vercel.app", "affilova-merchant.vercel.app"]

function deps(overrides: Partial<TurnstileVerifyDeps> = {}): TurnstileVerifyDeps {
  return {
    secretKey: SECRET,
    fetch: (async () =>
      new Response(JSON.stringify({ success: true, action: "checkout", hostname: "affilova.vercel.app" }), {
        status: 200,
      })) as typeof fetch,
    allowedHostnames: HOSTS,
    ...overrides,
  }
}

function answer(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

describe("verifyTurnstileToken", () => {
  it("accepts a token solved for checkout on a configured host", async () => {
    await expect(verifyTurnstileToken("token", deps())).resolves.toEqual({ ok: true })
  })

  it("posts the secret and the token to the documented endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = []

    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })

      return new Response(JSON.stringify({ success: true, action: "checkout", hostname: "affilova.vercel.app" }))
    }) as typeof fetch

    await verifyTurnstileToken("token-abc", deps({ fetch: fakeFetch }))

    expect(calls[0]?.url).toBe(TURNSTILE_VERIFY_URL)
    expect(calls[0]?.init.method).toBe("POST")

    const body = new URLSearchParams(String(calls[0]?.init.body))
    expect(body.get("secret")).toBe(SECRET)
    expect(body.get("response")).toBe("token-abc")
  })

  it("refuses an empty token without calling Cloudflare", async () => {
    const fakeFetch = vi.fn() as unknown as typeof fetch

    await expect(verifyTurnstileToken("  ", deps({ fetch: fakeFetch }))).resolves.toEqual({
      ok: false,
      reason: "missing_token",
    })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("refuses when no secret is configured", async () => {
    await expect(verifyTurnstileToken("token", deps({ secretKey: "" }))).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    })
  })

  it("refuses when no host is configured, rather than accepting any host", async () => {
    await expect(verifyTurnstileToken("token", deps({ allowedHostnames: [] }))).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    })
  })

  it("refuses an unsuccessful answer", async () => {
    await expect(
      verifyTurnstileToken("token", deps({ fetch: answer({ success: false, "error-codes": ["invalid-input-response"] }) })),
    ).resolves.toEqual({ ok: false, reason: "rejected" })
  })

  it("refuses a token solved for another action", async () => {
    await expect(
      verifyTurnstileToken(
        "token",
        deps({ fetch: answer({ success: true, action: "sign-up", hostname: "affilova.vercel.app" }) }),
      ),
    ).resolves.toEqual({ ok: false, reason: "wrong_action" })
  })

  it("refuses an answer with no action at all", async () => {
    await expect(
      verifyTurnstileToken("token", deps({ fetch: answer({ success: true, hostname: "affilova.vercel.app" }) })),
    ).resolves.toEqual({ ok: false, reason: "wrong_action" })
  })

  it("refuses a token solved on another host", async () => {
    await expect(
      verifyTurnstileToken(
        "token",
        deps({ fetch: answer({ success: true, action: "checkout", hostname: "evil.example.com" }) }),
      ),
    ).resolves.toEqual({ ok: false, reason: "wrong_hostname" })
  })

  it("refuses an answer with no hostname", async () => {
    await expect(
      verifyTurnstileToken("token", deps({ fetch: answer({ success: true, action: "checkout" }) })),
    ).resolves.toEqual({ ok: false, reason: "wrong_hostname" })
  })

  it("compares host names case-insensitively and ignores a port", async () => {
    await expect(
      verifyTurnstileToken(
        "token",
        deps({ fetch: answer({ success: true, action: "checkout", hostname: "Affilova.Vercel.App.:443" }) }),
      ),
    ).resolves.toEqual({ ok: true })
  })

  it("refuses when Cloudflare answers with an error status", async () => {
    await expect(
      verifyTurnstileToken("token", deps({ fetch: answer({ success: true }, 500) })),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
  })

  it("refuses when the network fails", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch

    await expect(verifyTurnstileToken("token", deps({ fetch: failing }))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    })
  })

  it("refuses when the answer is not JSON", async () => {
    const notJson = (async () => new Response("<html>", { status: 200 })) as typeof fetch

    await expect(verifyTurnstileToken("token", deps({ fetch: notJson }))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    })
  })
})
