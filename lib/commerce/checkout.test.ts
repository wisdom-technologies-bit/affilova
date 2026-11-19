import { describe, expect, it, vi } from "vitest"

// Starting a checkout.
//
// The rules worth proving here are the ones a mistake would cost money or trust
// on: the amount comes from the database, the token is redeemed before an order
// exists, both limits deny rather than allow, and a Paystack failure leaves a
// failed order rather than a pending one.

import { generateReference, runStartCheckout, type CheckoutDeps, type CreateOrderCall, type InitializeCall } from "./checkout"
import { PaystackError } from "@/lib/paystack/client"

const PRODUCT_ID = "11111111-1111-1111-1111-111111111111"
const ORDER_ID = "22222222-2222-2222-2222-222222222222"
const BUYER_ID = "33333333-3333-3333-3333-333333333333"

interface Fakes {
  deps: CheckoutDeps
  orders: CreateOrderCall[]
  initializes: InitializeCall[]
  attaches: { orderId: string; accessCode: string }[]
  failed: { reference: string; reason: string }[]
  limits: { key: string; limit: number; windowSeconds: number; onError?: string }[]
  captchaTokens: string[]
}

function makeFakes(overrides: Partial<CheckoutDeps> = {}): Fakes {
  const orders: CreateOrderCall[] = []
  const initializes: InitializeCall[] = []
  const attaches: { orderId: string; accessCode: string }[] = []
  const failed: { reference: string; reason: string }[] = []
  const limits: { key: string; limit: number; windowSeconds: number; onError?: string }[] = []
  const captchaTokens: string[] = []

  const deps: CheckoutDeps = {
    rateLimit: async (options) => {
      limits.push({
        key: options.key,
        limit: options.limit,
        windowSeconds: options.windowSeconds,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      })

      return { allowed: true, remaining: 1, resetAt: new Date("2026-11-18T20:00:00.000Z") }
    },
    verifyTurnstile: async (token) => {
      captchaTokens.push(token)

      return { ok: true }
    },
    getBuyerUserId: async () => null,
    readAttribution: async () => null,
    createOrder: async (call) => {
      orders.push(call)

      return {
        orderId: ORDER_ID,
        number: "AFV-2026-000001",
        // Deliberately not a round number and not what a browser would send.
        totalKobo: 40333,
        currency: "NGN",
        reference: call.reference,
      }
    },
    initializeTransaction: async (call) => {
      initializes.push(call)

      return {
        authorizationUrl: "https://checkout.paystack.com/3ni8kdavz62431k",
        accessCode: "3ni8kdavz62431k",
        reference: call.reference,
      }
    },
    attachPaystackInit: async (orderId, accessCode) => {
      attaches.push({ orderId, accessCode })
    },
    failOrder: async (reference, reason) => {
      failed.push({ reference, reason })
    },
    callbackUrl: () => "https://affilova.vercel.app/checkout/return",
    randomChar: () => 0,
    ...overrides,
  }

  return { deps, orders, initializes, attaches, failed, limits, captchaTokens }
}

const VALID = {
  productId: PRODUCT_ID,
  email: "  Buyer@Example.COM ",
  name: "Ada",
  turnstileToken: "token-123",
  ip: "197.210.54.33",
}

describe("the happy path", () => {
  it("creates the order, asks Paystack for the database amount, and returns the URL", async () => {
    const fakes = makeFakes()

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result).toEqual({ ok: true, authorizationUrl: "https://checkout.paystack.com/3ni8kdavz62431k" })

    expect(fakes.orders).toHaveLength(1)
    const order = fakes.orders[0]
    expect(order?.email).toBe("buyer@example.com")
    expect(order?.name).toBe("Ada")
    expect(order?.productId).toBe(PRODUCT_ID)
    expect(order?.buyerUserId).toBeNull()
    expect(order?.affiliateId).toBeNull()
    // The address is hashed, never stored.
    expect(order?.ipHash).toMatch(/^[0-9a-f]{64}$/)
    expect(order?.ipHash).not.toContain("197.210")

    expect(fakes.initializes).toHaveLength(1)
    const initialize = fakes.initializes[0]
    expect(initialize?.amountKobo).toBe(40333)
    expect(initialize?.currency).toBe("NGN")
    expect(initialize?.email).toBe("buyer@example.com")
    expect(initialize?.callbackUrl).toBe("https://affilova.vercel.app/checkout/return")
    expect(initialize?.channels).toEqual(["card", "bank", "ussd", "bank_transfer"])
    expect(initialize?.metadata).toEqual({ order_id: ORDER_ID, order_number: "AFV-2026-000001" })
    expect(initialize?.reference).toBe(order?.reference)

    expect(fakes.attaches).toEqual([{ orderId: ORDER_ID, accessCode: "3ni8kdavz62431k" }])
    expect(fakes.failed).toHaveLength(0)
  })

  it("uses the amount the database returned, whatever the product price was", async () => {
    const fakes = makeFakes({
      createOrder: async (call) => ({
        orderId: ORDER_ID,
        number: "AFV-2026-000001",
        totalKobo: 123456,
        currency: "NGN",
        reference: call.reference,
      }),
    })

    await runStartCheckout(VALID, fakes.deps)

    expect(fakes.initializes[0]?.amountKobo).toBe(123456)
  })

  it("keeps a working checkout URL when the access code cannot be stored", async () => {
    const fakes = makeFakes({
      attachPaystackInit: async () => {
        throw new Error("commerce_rpc_failed:attach_paystack_init")
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(true)
  })

  it("carries the buyer's id when someone is signed in", async () => {
    const fakes = makeFakes({ getBuyerUserId: async () => BUYER_ID })

    await runStartCheckout(VALID, fakes.deps)

    expect(fakes.orders[0]?.buyerUserId).toBe(BUYER_ID)
  })

  it("passes the affiliate through when attribution exists", async () => {
    const fakes = makeFakes({
      readAttribution: async () => ({ affiliateId: BUYER_ID, clickId: null }),
    })

    await runStartCheckout(VALID, fakes.deps)

    expect(fakes.orders[0]?.affiliateId).toBe(BUYER_ID)
  })
})

describe("validation", () => {
  it("refuses a bad email before anything else happens", async () => {
    const fakes = makeFakes()

    const result = await runStartCheckout({ ...VALID, email: "not-an-email" }, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.email).toBe("Enter a valid email address.")
    }

    expect(fakes.orders).toHaveLength(0)
    expect(fakes.limits).toHaveLength(0)
  })

  it("refuses an email longer than 254 characters", async () => {
    const fakes = makeFakes()
    const long = `${"a".repeat(250)}@example.com`

    const result = await runStartCheckout({ ...VALID, email: long }, fakes.deps)

    expect(result.ok).toBe(false)
  })

  it("refuses a name longer than 100 characters", async () => {
    const fakes = makeFakes()

    const result = await runStartCheckout({ ...VALID, name: "a".repeat(101) }, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.name).toContain("100")
    }
  })

  it("refuses a product id that is not a uuid", async () => {
    const fakes = makeFakes()

    const result = await runStartCheckout({ ...VALID, productId: "abc" }, fakes.deps)

    expect(result.ok).toBe(false)
  })

  it("refuses an empty token", async () => {
    const fakes = makeFakes()

    const result = await runStartCheckout({ ...VALID, turnstileToken: "  " }, fakes.deps)

    expect(result.ok).toBe(false)
  })
})

describe("rate limits", () => {
  it("counts the address and the email with the agreed limits, denying on failure", async () => {
    const fakes = makeFakes()

    await runStartCheckout(VALID, fakes.deps)

    expect(fakes.limits).toHaveLength(2)
    expect(fakes.limits[0]).toMatchObject({ limit: 10, windowSeconds: 600, onError: "deny" })
    expect(fakes.limits[1]).toMatchObject({ limit: 5, windowSeconds: 600, onError: "deny" })
    expect(fakes.limits[0]?.key).not.toContain("197.210.54.33")
    expect(fakes.limits[1]?.key).not.toContain("buyer@example.com")
  })

  it("stops when the address has had its ten", async () => {
    const fakes = makeFakes({
      rateLimit: async () => ({ allowed: false, remaining: 0, resetAt: new Date() }),
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("Too many attempts")
    }
    expect(fakes.orders).toHaveLength(0)
  })

  it("stops when the email has had its five, before the captcha is redeemed", async () => {
    let call = 0

    const fakes = makeFakes({
      rateLimit: async () => {
        call += 1

        return { allowed: call === 1, remaining: 0, resetAt: new Date() }
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    expect(fakes.captchaTokens).toHaveLength(0)
  })
})

describe("Turnstile", () => {
  it("fails closed and creates no order", async () => {
    const fakes = makeFakes({ verifyTurnstile: async () => ({ ok: false }) })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("verification")
    }
    expect(fakes.orders).toHaveLength(0)
  })

  it("redeems the token before the order exists", async () => {
    const order: string[] = []

    const fakes = makeFakes({
      verifyTurnstile: async () => {
        order.push("captcha")

        return { ok: true }
      },
      createOrder: async (call) => {
        order.push("order")

        return {
          orderId: ORDER_ID,
          number: "AFV-2026-000001",
          totalKobo: 40333,
          currency: "NGN",
          reference: call.reference,
        }
      },
    })

    await runStartCheckout(VALID, fakes.deps)

    expect(order).toEqual(["captcha", "order"])
  })
})

describe("failures from the database", () => {
  it("maps product_unavailable to a safe sentence", async () => {
    const fakes = makeFakes({
      createOrder: async () => {
        throw new Error("product_unavailable")
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("That product is not available right now.")
    }
    expect(fakes.initializes).toHaveLength(0)
  })

  it("maps guest_checkout_disabled to a sign-in prompt", async () => {
    const fakes = makeFakes({
      createOrder: async () => {
        throw new Error("guest_checkout_disabled")
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("Sign in to buy this product.")
    }
  })

  it("says something generic for an error it does not know", async () => {
    const fakes = makeFakes({
      createOrder: async () => {
        throw new Error('duplicate key value violates unique constraint "orders_pkey"')
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("Something went wrong. Please try again.")
      expect(result.error).not.toContain("constraint")
    }
  })

  it("puts a bad email on the email field", async () => {
    const fakes = makeFakes({
      createOrder: async () => {
        throw new Error("invalid_email")
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.fieldErrors?.email).toBe("Enter a valid email address.")
    }
  })

  it("fails the order when the database returns a nonsense amount", async () => {
    const fakes = makeFakes({
      createOrder: async (call) => ({
        orderId: ORDER_ID,
        number: "AFV-2026-000001",
        totalKobo: 0,
        currency: "NGN",
        reference: call.reference,
      }),
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    expect(fakes.initializes).toHaveLength(0)
    expect(fakes.failed).toHaveLength(1)
  })
})

describe("failures from Paystack", () => {
  it("fails the order and returns a safe sentence", async () => {
    const fakes = makeFakes({
      initializeTransaction: async () => {
        throw new PaystackError("unauthorized", "Paystack rejected the secret key.", { retryable: false })
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("Payments are unavailable right now. Please try again in a moment.")
    }

    expect(fakes.failed).toHaveLength(1)
    expect(fakes.failed[0]?.reason).toBe("paystack_unauthorized")
    expect(fakes.failed[0]?.reference).toMatch(/^afv_[0-9a-z]{24}$/)
  })

  it("still answers the buyer when failing the order also fails", async () => {
    const fakes = makeFakes({
      initializeTransaction: async () => {
        throw new PaystackError("server_error", "down", { retryable: true })
      },
      failOrder: async () => {
        throw new Error("commerce_rpc_failed:fail_order")
      },
    })

    const result = await runStartCheckout(VALID, fakes.deps)

    expect(result.ok).toBe(false)
  })
})

describe("references", () => {
  it("builds afv_ and 24 lowercase alphanumerics", () => {
    const reference = generateReference()

    expect(reference).toMatch(/^afv_[0-9a-z]{24}$/)
  })

  it("never repeats itself in a small sample", () => {
    const seen = new Set<string>()

    for (let index = 0; index < 50; index += 1) {
      seen.add(generateReference())
    }

    expect(seen.size).toBe(50)
  })

  it("stays inside the documented reference alphabet", () => {
    const reference = generateReference(() => 35)

    expect(reference).toBe(`afv_${"z".repeat(24)}`)
  })
})

describe("logging", () => {
  it("does not log the email or the token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const fakes = makeFakes({
      initializeTransaction: async () => {
        throw new PaystackError("server_error", "down", { retryable: true })
      },
    })

    await runStartCheckout(VALID, fakes.deps)

    const text = [...error.mock.calls, ...warn.mock.calls, ...info.mock.calls]
      .map((call) => call.map((part) => String(part)).join(" "))
      .join("\n")

    expect(text).not.toContain("buyer@example.com")
    expect(text).not.toContain("token-123")

    vi.restoreAllMocks()
  })
})
