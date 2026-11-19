import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BREVO_MAX_ATTEMPTS, BREVO_TIMEOUT_MS, sendEmail, type BrevoDeps } from "./brevo"

const INPUT = {
  to: "buyer@example.com",
  subject: "Your download link",
  html: "<p>hello</p>",
  text: "hello",
  template: "purchase_receipt",
}

function deps(fetchImpl: typeof fetch, sleep = async () => {}): BrevoDeps {
  return {
    apiKey: "xkeysib-test",
    from: { name: "Affilova", email: "no-reply@affilova.example" },
    replyTo: { name: "Affilova", email: "support@affilova.example" },
    fetch: fetchImpl,
    sleep,
  }
}

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("the Brevo sender", () => {
  const logged: string[] = []

  beforeEach(() => {
    logged.length = 0

    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("posts the message and reports the provider's id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ messageId: "<abc@brevo>" }))
    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch))

    expect(result).toEqual({ ok: true, messageId: "<abc@brevo>" })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const call = fetchMock.mock.calls[0]
    const url = call?.[0] ?? ""
    const init = call?.[1] ?? {}
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(url).toBe("https://api.brevo.com/v3/smtp/email")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test")
    expect(body.to).toEqual([{ email: "buyer@example.com" }])
    expect(body.sender).toEqual({ name: "Affilova", email: "no-reply@affilova.example" })
    expect(body.replyTo).toEqual({ name: "Affilova", email: "support@affilova.example" })
    expect(body.textContent).toBe("hello")
  })

  it("never logs the address, the subject or the body", async () => {
    await sendEmail(INPUT, deps((async () => jsonResponse({ messageId: "<abc@brevo>" })) as typeof fetch))

    const all = logged.join("\n")

    expect(all).toContain("purchase_receipt")
    expect(all).toContain("<abc@brevo>")
    expect(all).not.toContain("buyer@example.com")
    expect(all).not.toContain("Your download link")
    expect(all).not.toContain("hello")
  })

  it("retries a 5xx and gives up after three attempts", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: "down" }, 503))
    const sleep = vi.fn(async () => {})

    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch, sleep))

    expect(result).toEqual({ ok: false, reason: "unavailable" })
    expect(fetchMock).toHaveBeenCalledTimes(BREVO_MAX_ATTEMPTS)
    expect(sleep).toHaveBeenCalledTimes(BREVO_MAX_ATTEMPTS - 1)
  })

  it("retries a network error and succeeds on the second try", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ messageId: "<second@brevo>" }))

    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch))

    expect(result).toEqual({ ok: true, messageId: "<second@brevo>" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry a 4xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: "bad key" }, 401))

    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch))

    expect(result).toEqual({ ok: false, reason: "rejected" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("passes an abort signal, and treats an aborted attempt as retryable", async () => {
    // The real abort is a ten second timer; here the attempt rejects with the
    // same AbortError immediately, which is the path the sender sees either way.
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      if (init.signal !== null && init.signal !== undefined) {
        signals.push(init.signal)
      }

      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"))
    })

    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch, async () => {}))

    expect(result).toEqual({ ok: false, reason: "unavailable" })
    expect(fetchMock).toHaveBeenCalledTimes(BREVO_MAX_ATTEMPTS)
    expect(signals).toHaveLength(BREVO_MAX_ATTEMPTS)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })
})
