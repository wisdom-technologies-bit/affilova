import { afterEach, describe, expect, it, vi } from "vitest"

import type { SuppressionReason } from "@/lib/email/suppression"

import { handleBrevoWebhook, MAX_WEBHOOK_BODY_BYTES, tokenMatches, type BrevoWebhookDeps } from "./route"

// The Brevo webhook, from the route's side.
//
// Brevo documents no signature on a transactional webhook, so what is proved
// here is the rest of the contract: the path token is the credential and a wrong
// one learns nothing; the body is bounded and parsed against the shape Brevo
// documents; the five events that mean "do not write to this address again" are
// suppressed and the rest are ignored; and a valid body always answers 200,
// because a 5xx makes Brevo retry an event that will never become truer.

const TOKEN = "t".repeat(40)

const OK_EVENTS = ["hard_bounce", "blocked", "spam", "invalid_email", "unsubscribed"] as const

function deps(overrides: Partial<BrevoWebhookDeps> = {}): BrevoWebhookDeps {
  return {
    token: TOKEN,
    addSuppression: vi.fn(async () => ({ ok: true, events: 1 })),
    rateLimit: vi.fn(async () => ({ allowed: true, remaining: 100, resetAt: new Date() })),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  }
}

function post(body: unknown, token = TOKEN): Request {
  return new Request(`https://admin.example.com/api/brevo/webhook/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

/** One event, in the shape Brevo's documentation shows. */
function event(name: string, email = "buyer@example.com"): Record<string, unknown> {
  return {
    event: name,
    email,
    id: 12345,
    date: "2026-11-27 10:00:00",
    ts: 1764237600,
    "message-id": "201798300811.5787683@relay.domain.com",
    ts_event: 1764237604,
    subject: "Your download link",
    "X-Mailin-custom": "some_custom_header",
    sending_ip: "203.0.113.10",
    template_id: 22,
    tags: ["transac_messages"],
    source: "API",
  }
}

function called(deps: BrevoWebhookDeps): Array<[string, SuppressionReason, string]> {
  return (deps.addSuppression as unknown as { mock: { calls: Array<[string, SuppressionReason, string]> } }).mock
    .calls
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the path token", () => {
  it("answers 404 with an empty body for a wrong token", async () => {
    const d = deps()
    const response = await handleBrevoWebhook(post(event("hard_bounce")), "wrong", d)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("")
    expect(d.addSuppression).not.toHaveBeenCalled()
  })

  it("answers 404 when the deployment has no token", async () => {
    const response = await handleBrevoWebhook(post(event("hard_bounce")), TOKEN, deps({ token: undefined }))

    expect(response.status).toBe(404)
  })

  it("answers 404 for a token that is a prefix of the real one", async () => {
    const response = await handleBrevoWebhook(post(event("hard_bounce")), TOKEN.slice(0, 39), deps())

    expect(response.status).toBe(404)
  })

  it("compares in constant time and refuses a different length without comparing bytes", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
    expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false)
    expect(tokenMatches("", TOKEN)).toBe(false)
  })
})

describe("the method", () => {
  it("refuses anything but POST", async () => {
    const request = new Request(`https://admin.example.com/api/brevo/webhook/${TOKEN}`, { method: "GET" })
    const response = await handleBrevoWebhook(request, TOKEN, deps())

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
  })
})

describe("the body", () => {
  it("refuses a body over 64 KB before reading it", async () => {
    const request = new Request(`https://admin.example.com/api/brevo/webhook/${TOKEN}`, {
      method: "POST",
      headers: { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1) },
      body: "{}",
    })

    const response = await handleBrevoWebhook(request, TOKEN, deps())

    expect(response.status).toBe(413)
  })

  it("refuses a body that is not JSON", async () => {
    const response = await handleBrevoWebhook(post("not json at all"), TOKEN, deps())

    expect(response.status).toBe(400)
  })

  it("refuses a body with no event or no address", async () => {
    const withoutEvent = await handleBrevoWebhook(post({ email: "buyer@example.com" }), TOKEN, deps())
    const withoutEmail = await handleBrevoWebhook(post({ event: "hard_bounce" }), TOKEN, deps())

    expect(withoutEvent.status).toBe(400)
    expect(withoutEmail.status).toBe(400)
  })

  it("answers 429 when the limiter says no, without writing anything", async () => {
    const d = deps({
      rateLimit: vi.fn(async () => ({ allowed: false, remaining: 0, resetAt: new Date() })),
    })

    const response = await handleBrevoWebhook(post(event("hard_bounce")), TOKEN, d)

    expect(response.status).toBe(429)
    expect(d.addSuppression).not.toHaveBeenCalled()
  })
})

describe("the events that suppress", () => {
  for (const name of OK_EVENTS) {
    it(`suppresses on ${name}`, async () => {
      const d = deps()
      const response = await handleBrevoWebhook(post(event(name)), TOKEN, d)

      expect(response.status).toBe(200)
      expect(called(d)).toHaveLength(1)
      expect(called(d)[0]?.[0]).toBe("buyer@example.com")
      expect(called(d)[0]?.[2]).toBe("brevo_webhook")
    })
  }

  it("maps each event to its reason", async () => {
    const expected: Record<string, SuppressionReason> = {
      hard_bounce: "hard_bounce",
      blocked: "blocked",
      spam: "complaint",
      invalid_email: "invalid",
      unsubscribed: "unsubscribed",
    }

    for (const [name, reason] of Object.entries(expected)) {
      const d = deps()

      await handleBrevoWebhook(post(event(name)), TOKEN, d)

      expect(called(d)[0]?.[1]).toBe(reason)
    }
  })

  it("still answers 200 when the write failed, so Brevo does not retry it", async () => {
    const d = deps({ addSuppression: vi.fn(async () => ({ ok: false, events: null })) })

    const response = await handleBrevoWebhook(post(event("hard_bounce")), TOKEN, d)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, handled: "suppressed", stored: false })
  })
})

describe("the events that do not", () => {
  it("ignores a soft bounce: a full mailbox is not a reason to stop writing", async () => {
    const d = deps()
    const response = await handleBrevoWebhook(post(event("soft_bounce")), TOKEN, d)

    expect(response.status).toBe(200)
    expect(d.addSuppression).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ handled: "ignored" })
  })

  it("ignores delivered, opened, clicked and deferred", async () => {
    for (const name of ["delivered", "opened", "click", "deferred", "request"]) {
      const d = deps()

      const response = await handleBrevoWebhook(post(event(name)), TOKEN, d)

      expect(response.status).toBe(200)
      expect(d.addSuppression).not.toHaveBeenCalled()
    }
  })

  it("answers 200 for an event nobody has heard of", async () => {
    const d = deps()
    const response = await handleBrevoWebhook(post(event("something_new")), TOKEN, d)

    expect(response.status).toBe(200)
    expect(d.addSuppression).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ handled: "unknown" })
  })
})

describe("what is never logged", () => {
  it("does not log the address, the subject or the message id", async () => {
    const lines: string[] = []
    const d = deps({
      log: {
        info: (name, fields) => lines.push(`${name} ${JSON.stringify(fields ?? {})}`),
        warn: (name, fields) => lines.push(`${name} ${JSON.stringify(fields ?? {})}`),
        error: (name, fields) => lines.push(`${name} ${JSON.stringify(fields ?? {})}`),
      },
    })

    await handleBrevoWebhook(post(event("hard_bounce")), TOKEN, d)

    const written = lines.join("\n")

    expect(written).toContain("brevo_webhook_handled")
    expect(written).not.toContain("buyer@example.com")
    expect(written).not.toContain("Your download link")
    expect(written).not.toContain("relay.domain.com")
  })
})
