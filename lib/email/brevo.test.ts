import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BREVO_MAX_ATTEMPTS,
  BREVO_TIMEOUT_MS,
  FAILURE_RECORD_TIMEOUT_MS,
  sendEmail,
  type BrevoDeps,
} from "./brevo"

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

    expect(result).toEqual({ ok: false, reason: "provider_error" })
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

    expect(result).toEqual({ ok: false, reason: "unauthorized" })
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

    expect(result).toEqual({ ok: false, reason: "network" })
    expect(fetchMock).toHaveBeenCalledTimes(BREVO_MAX_ATTEMPTS)
    expect(signals).toHaveLength(BREVO_MAX_ATTEMPTS)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })
})

describe("the failure reason", () => {
  const cases: ReadonlyArray<{
    name: string
    status: number
    body: unknown
    reason: string
  }> = [
    { name: "a bad key", status: 401, body: { code: "unauthorized", message: "Key not found" }, reason: "unauthorized" },
    {
      name: "a blocked address",
      status: 401,
      body: { code: "unauthorized", message: "Your IP address is not authorized" },
      reason: "ip_not_authorized",
    },
    {
      name: "a blocked address on a 403",
      status: 403,
      body: { code: "ip_not_authorized", message: "Unrecognised IP address" },
      reason: "ip_not_authorized",
    },
    {
      name: "a free mail sender",
      status: 400,
      body: { code: "invalid_parameter", message: "the sender is not valid: gmail.com is not allowed" },
      reason: "invalid_sender",
    },
    {
      name: "an unverified sender",
      status: 400,
      body: { code: "invalid_parameter", message: "Sender email is not valid" },
      reason: "invalid_sender",
    },
    {
      name: "a malformed request",
      status: 400,
      body: { code: "missing_parameter", message: "htmlContent is missing" },
      reason: "invalid_request",
    },
    { name: "a refused payment", status: 402, body: { code: "not_enough_credits", message: "no credits" }, reason: "quota" },
    { name: "a rate limit", status: 429, body: { code: "too_many_requests", message: "slow down" }, reason: "quota" },
    { name: "an outage", status: 503, body: { code: "unavailable", message: "down" }, reason: "provider_error" },
    { name: "an unreadable body", status: 500, body: "not json", reason: "provider_error" },
    { name: "an undocumented 4xx", status: 422, body: null, reason: "invalid_request" },
  ]

  it.each(cases)("maps $name ($status) to $reason", async ({ status, body, reason }) => {
    const fetchMock = vi.fn(async () => {
      if (typeof body === "string") {
        return new Response(body, { status, headers: { "content-type": "text/plain" } })
      }

      return jsonResponse(body, status)
    })

    const result = await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch))

    expect(result).toEqual({ ok: false, reason })
  })

  it("logs the reason and never the provider's words", async () => {
    const logged: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
    })

    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          code: "invalid_parameter",
          message: "Sender no-reply@affilova.example is not valid, buyer@example.com cannot receive",
        },
        400,
      ),
    )

    await sendEmail(INPUT, deps(fetchMock as unknown as typeof fetch))

    const all = logged.join("\n")

    expect(all).toContain("email_send_failed")
    expect(all).toContain("invalid_sender")
    expect(all).not.toContain("no-reply@affilova.example")
    expect(all).not.toContain("buyer@example.com")
    expect(all).not.toContain("is not valid")

    spy.mockRestore()
  })
})

describe("recording the final failure", () => {
  it("records once, with the final reason, after every retry", async () => {
    const record = vi.fn(async () => {})
    const fetchMock = vi.fn(async () => jsonResponse({ code: "unavailable" }, 503))

    const result = await sendEmail(INPUT, {
      ...deps(fetchMock as unknown as typeof fetch, async () => {}),
      record,
    })

    expect(result).toEqual({ ok: false, reason: "provider_error" })
    expect(fetchMock).toHaveBeenCalledTimes(BREVO_MAX_ATTEMPTS)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith({
      template: "purchase_receipt",
      status: 503,
      reason: "provider_error",
    })
  })

  it("records a zero status for a request that never got an answer", async () => {
    const record = vi.fn(async () => {})
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })

    await sendEmail(INPUT, { ...deps(fetchMock as unknown as typeof fetch, async () => {}), record })

    expect(record).toHaveBeenCalledWith({ template: "purchase_receipt", status: null, reason: "network" })
  })

  it("records nothing when the message goes out", async () => {
    const record = vi.fn(async () => {})

    await sendEmail(INPUT, {
      ...deps((async () => jsonResponse({ messageId: "<ok@brevo>" })) as typeof fetch),
      record,
    })

    expect(record).not.toHaveBeenCalled()
  })

  it("survives a recorder that throws", async () => {
    const record = vi.fn(async () => {
      throw new Error("the database is down")
    })

    const result = await sendEmail(INPUT, {
      ...deps((async () => jsonResponse({}, 400)) as typeof fetch),
      record,
    })

    expect(result).toEqual({ ok: false, reason: "invalid_request" })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it("does not wait more than a second for a recorder that hangs", async () => {
    vi.useFakeTimers()

    try {
      const record = vi.fn(() => new Promise<void>(() => {}))

      const pending = sendEmail(INPUT, {
        ...deps((async () => jsonResponse({}, 400)) as typeof fetch),
        record,
      })

      await vi.advanceTimersByTimeAsync(FAILURE_RECORD_TIMEOUT_MS + 1)

      await expect(pending).resolves.toEqual({ ok: false, reason: "invalid_request" })
      expect(record).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
