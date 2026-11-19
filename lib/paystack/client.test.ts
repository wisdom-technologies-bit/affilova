import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The Paystack client, driven by a fake fetch.
//
// Paystack cannot be called from the sandbox, so every answer here is a
// hand-written one. What is checked is the contract: the request that leaves,
// the answer that is accepted, the answer that is refused, and the rule that a
// retry only ever happens on verify.

import {
  createPaystackClient,
  PaystackError,
  type PaystackClient,
  type VerifiedTransaction,
} from "./client"

const SECRET = "sk_test_0123456789abcdef0123456789abcdef"

type Call = { url: string; init: RequestInit }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function verifiedBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: true,
    message: "Verification successful",
    data: {
      id: 4099260516,
      domain: "test",
      status: "success",
      reference: "afv_abc123",
      amount: 40333,
      gateway_response: "Successful",
      paid_at: "2024-08-22T09:15:02.000Z",
      created_at: "2024-08-22T09:14:24.000Z",
      channel: "card",
      currency: "NGN",
      fees: 10283,
      ...overrides,
    },
  }
}

function client(
  handler: (call: Call) => Promise<Response>,
  options: { retryDelaysMs?: readonly number[]; timeoutMs?: number } = {},
): { client: PaystackClient; calls: Call[]; sleeps: number[] } {
  const calls: Call[] = []
  const sleeps: number[] = []

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)

    return handler(call)
  }) as typeof fetch

  return {
    client: createPaystackClient({
      secretKey: SECRET,
      fetch: fakeFetch,
      retryDelaysMs: options.retryDelaysMs ?? [10, 20],
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    }),
    calls,
    sleeps,
  }
}

let logged: string[] = []

beforeEach(() => {
  logged = []

  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(" "))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("initializeTransaction", () => {
  it("sends the documented body and returns the checkout URL", async () => {
    const { client: paystack, calls } = client(async () =>
      jsonResponse({
        status: true,
        message: "Authorization URL created",
        data: {
          authorization_url: "https://checkout.paystack.com/3ni8kdavz62431k",
          access_code: "3ni8kdavz62431k",
          reference: "afv_abc123",
        },
      }),
    )

    const result = await paystack.initializeTransaction({
      email: "buyer@example.com",
      amountKobo: 40333,
      reference: "afv_abc123",
      currency: "NGN",
      callbackUrl: "https://affilova.vercel.app/checkout/return",
      channels: ["card", "bank", "ussd", "bank_transfer"],
      metadata: { order_id: "11111111-1111-1111-1111-111111111111", order_number: "AFV-2026-000001" },
    })

    expect(result.authorizationUrl).toBe("https://checkout.paystack.com/3ni8kdavz62431k")
    expect(result.accessCode).toBe("3ni8kdavz62431k")

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe("https://api.paystack.co/transaction/initialize")
    expect(call?.init.method).toBe("POST")

    const headers = call?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)

    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>
    expect(body.amount).toBe("40333")
    expect(body.currency).toBe("NGN")
    expect(body.email).toBe("buyer@example.com")
    expect(body.channels).toEqual(["card", "bank", "ussd", "bank_transfer"])
    // Metadata is documented as a stringified JSON object, and holds the order
    // identity only.
    expect(JSON.parse(String(body.metadata))).toEqual({
      order_id: "11111111-1111-1111-1111-111111111111",
      order_number: "AFV-2026-000001",
    })
  })

  it("refuses a response without an authorization_url", async () => {
    const { client: paystack } = client(async () => jsonResponse({ status: true, data: {} }))

    await expect(
      paystack.initializeTransaction({
        email: "buyer@example.com",
        amountKobo: 100,
        reference: "afv_abc123",
        currency: "NGN",
        callbackUrl: "https://affilova.vercel.app/checkout/return",
        channels: ["card"],
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: "invalid_response", retryable: false })
  })

  it("does not retry a 500: a second initialize could create a second transaction", async () => {
    const { client: paystack, calls } = client(async () => jsonResponse({ status: false }, 503))

    await expect(
      paystack.initializeTransaction({
        email: "buyer@example.com",
        amountKobo: 100,
        reference: "afv_abc123",
        currency: "NGN",
        callbackUrl: "https://affilova.vercel.app/checkout/return",
        channels: ["card"],
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: "server_error", retryable: true, status: 503 })

    expect(calls).toHaveLength(1)
  })
})

describe("verifyTransaction", () => {
  it("returns the transaction, with every amount an integer of kobo", async () => {
    const { client: paystack } = client(async () => jsonResponse(verifiedBody()))

    const result = await paystack.verifyTransaction("afv_abc123")

    expect(result).toEqual<VerifiedTransaction>({
      id: 4099260516,
      status: "success",
      reference: "afv_abc123",
      amountKobo: 40333,
      currency: "NGN",
      feesKobo: 10283,
      channel: "card",
      paidAt: "2024-08-22T09:15:02.000Z",
      gatewayResponse: "Successful",
    })
  })

  it("accepts a missing fee and a null channel", async () => {
    const { client: paystack } = client(async () =>
      jsonResponse(verifiedBody({ fees: null, channel: null, paid_at: null })),
    )

    const result = await paystack.verifyTransaction("afv_abc123")

    expect(result.feesKobo).toBeNull()
    expect(result.channel).toBeNull()
    expect(result.paidAt).toBeNull()
  })

  it("refuses a body whose amount is not an integer", async () => {
    const { client: paystack } = client(async () => jsonResponse(verifiedBody({ amount: 403.33 })))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  it("refuses a body with no data at all", async () => {
    const { client: paystack } = client(async () => jsonResponse({ status: true, message: "ok" }))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toBeInstanceOf(PaystackError)
  })

  it("refuses a body that is not JSON", async () => {
    const { client: paystack } = client(async () => new Response("<html>nope</html>", { status: 200 }))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  it("does not retry a 404", async () => {
    const { client: paystack, calls } = client(async () => jsonResponse({ status: false }, 404))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "not_found",
      retryable: false,
    })
    expect(calls).toHaveLength(1)
  })

  it("does not retry a 401", async () => {
    const { client: paystack, calls } = client(async () => jsonResponse({ status: false }, 401))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    })
    expect(calls).toHaveLength(1)
  })

  it("retries a 500 and succeeds on the second attempt", async () => {
    let attempt = 0

    const { client: paystack, calls, sleeps } = client(async () => {
      attempt += 1

      return attempt === 1 ? jsonResponse({ status: false }, 500) : jsonResponse(verifiedBody())
    })

    const result = await paystack.verifyTransaction("afv_abc123")

    expect(result.status).toBe("success")
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([10])
  })

  it("gives up after the retries are spent", async () => {
    const { client: paystack, calls } = client(async () => jsonResponse({ status: false }, 500))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "server_error",
    })
    expect(calls).toHaveLength(3)
  })

  it("retries a network failure", async () => {
    let attempt = 0

    const { client: paystack, calls } = client(async () => {
      attempt += 1

      if (attempt === 1) {
        throw new TypeError("fetch failed")
      }

      return jsonResponse(verifiedBody())
    })

    const result = await paystack.verifyTransaction("afv_abc123")

    expect(result.status).toBe("success")
    expect(calls).toHaveLength(2)
  })

  it("reports a timeout as retryable and retries it", async () => {
    let attempt = 0

    const { client: paystack, calls } = client(async () => {
      attempt += 1

      if (attempt === 1) {
        const abort = new Error("aborted")
        abort.name = "AbortError"
        throw abort
      }

      return jsonResponse(verifiedBody())
    })

    const result = await paystack.verifyTransaction("afv_abc123")

    expect(result.status).toBe("success")
    expect(calls).toHaveLength(2)
  })

  it("reports a timeout that never recovers", async () => {
    const { client: paystack } = client(async () => {
      const abort = new Error("aborted")
      abort.name = "AbortError"
      throw abort
    })

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    })
  })
})

describe("createRefund", () => {
  it("sends our own reference so a retry cannot refund twice", async () => {
    const { client: paystack, calls } = client(async () =>
      jsonResponse({
        status: true,
        message: "Refund has been queued for processing",
        data: {
          id: 3018284,
          status: "pending",
          amount: 40333,
          currency: "NGN",
          reference: "afv_refund_abc",
          transaction: { reference: "afv_abc123" },
        },
      }),
    )

    const result = await paystack.createRefund({
      transaction: "afv_abc123",
      amountKobo: 40333,
      reference: "afv_refund_abc",
    })

    expect(result).toEqual({
      id: 3018284,
      status: "pending",
      amountKobo: 40333,
      currency: "NGN",
      reference: "afv_refund_abc",
    })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      transaction: "afv_abc123",
      amount: "40333",
      reference: "afv_refund_abc",
    })
  })

  it("reports a 409 as a conflict a retry cannot fix", async () => {
    const { client: paystack, calls } = client(async () => jsonResponse({ status: false }, 409))

    await expect(
      paystack.createRefund({ transaction: "afv_abc123", reference: "afv_refund_abc" }),
    ).rejects.toMatchObject({ code: "bad_request", retryable: false, status: 409 })

    expect(calls).toHaveLength(1)
  })

  it("refuses a refund whose amount is not an integer", async () => {
    const { client: paystack } = client(async () =>
      jsonResponse({
        status: true,
        data: { id: 1, status: "pending", amount: "40333", currency: "NGN" },
      }),
    )

    await expect(
      paystack.createRefund({ transaction: "afv_abc123", reference: "afv_refund_abc" }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })
})

describe("what is never logged", () => {
  it("keeps the secret key, the response body and the email out of every log line", async () => {
    const { client: paystack } = client(async () => jsonResponse(verifiedBody({ email: "buyer@example.com" })))

    await paystack.verifyTransaction("afv_abc123")

    const text = logged.join("\n")

    expect(text).not.toContain(SECRET)
    expect(text).not.toContain("sk_test_")
    expect(text).not.toContain("buyer@example.com")
    expect(text).not.toContain("Verification successful")
  })

  it("logs a failed call without the body or the key", async () => {
    const { client: paystack } = client(async () => jsonResponse({ status: false, message: "Invalid key" }, 401))

    await expect(paystack.verifyTransaction("afv_abc123")).rejects.toBeInstanceOf(PaystackError)

    const text = logged.join("\n")

    expect(text).not.toContain(SECRET)
    expect(text).not.toContain("Invalid key")
  })
})

describe("mode", () => {
  it("derives test from the key prefix", () => {
    const { client: paystack } = client(async () => jsonResponse({}))

    expect(paystack.mode).toBe("test")
  })

  it("derives live from a live key", () => {
    const fakeFetch = (async () => jsonResponse({})) as typeof fetch
    const paystack = createPaystackClient({ secretKey: "sk_live_abcdef", fetch: fakeFetch })

    expect(paystack.mode).toBe("live")
  })

  it("reports anything else as invalid", () => {
    const fakeFetch = (async () => jsonResponse({})) as typeof fetch
    const paystack = createPaystackClient({ secretKey: "not-a-key", fetch: fakeFetch })

    expect(paystack.mode).toBe("invalid")
  })
})
