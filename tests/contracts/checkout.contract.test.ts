import { beforeEach, describe, expect, it, vi } from "vitest"

// Contract: the purchase card and startCheckoutAction.
//
// The card (validatePurchase → submitPurchase) and the server action
// (startCheckoutAction → runStartCheckout) are both real. Only the two edges are
// faked: the network (Turnstile's siteverify and Paystack) and the database
// (create_order, attach_paystack_init, fail_order and the rate limiter).
//
// What is proven: the object the card builds is exactly what the action takes,
// the action's answer is exactly what the card consumes, and the amount that
// reaches Paystack is the database's, never the browser's.

const ORDER_ID = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30"
const PRICE_KOBO = 4_033_300

const edges = vi.hoisted(() => ({
  createOrder: vi.fn(),
  attachPaystackInit: vi.fn(),
  failOrder: vi.fn(),
  initializeTransaction: vi.fn(),
  verifyCheckoutTurnstile: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}))

vi.mock("@/lib/commerce/db", () => ({
  createOrder: edges.createOrder,
  attachPaystackInit: edges.attachPaystackInit,
  failOrder: edges.failOrder,
}))

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client")

  return {
    // The channel list is configuration, not an edge: the real one is used so the
    // test fails if the code stops offering the channels the docs allow.
    CHECKOUT_CHANNELS: actual.CHECKOUT_CHANNELS,
    PaystackError: actual.PaystackError,
    initializeTransaction: edges.initializeTransaction,
  }
})

vi.mock("@/lib/security/turnstile-verify", () => ({
  verifyCheckoutTurnstile: edges.verifyCheckoutTurnstile,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => null,
}))

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")

  return {
    rateLimitKey: actual.rateLimitKey,
    clientIpFromHeaders: () => "203.0.113.9",
    rateLimit: edges.rateLimit,
  }
})

import { startCheckoutAction } from "@/lib/commerce/actions"
import { submitPurchase, validatePurchase, type PurchaseOutcome } from "@/lib/commerce/purchase"

beforeEach(() => {
  process.env.NEXT_PUBLIC_HOST_PUBLIC = "affilova.vercel.app"

  edges.rateLimit.mockReset()
  edges.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() })
  edges.verifyCheckoutTurnstile.mockReset()
  edges.verifyCheckoutTurnstile.mockResolvedValue({ ok: true })
  edges.createOrder.mockReset()
  edges.createOrder.mockResolvedValue({
    orderId: ORDER_ID,
    number: "AFV-2026-000001",
    totalKobo: PRICE_KOBO,
    currency: "NGN",
    reference: "afv_0123456789abcdefghijklmn",
  })
  edges.attachPaystackInit.mockReset()
  edges.attachPaystackInit.mockResolvedValue(undefined)
  edges.failOrder.mockReset()
  edges.failOrder.mockResolvedValue(undefined)
  edges.initializeTransaction.mockReset()
  edges.initializeTransaction.mockResolvedValue({
    authorizationUrl: "https://checkout.paystack.com/abc123",
    accessCode: "abc123",
    reference: "afv_0123456789abcdefghijklmn",
  })
})

describe("the purchase card and the checkout action agree", () => {
  it("sends the card's own request, unchanged, and follows the action's answer", async () => {
    const assigned: string[] = []

    const outcome: PurchaseOutcome = await submitPurchase(
      {
        productId: PRODUCT,
        email: "  Buyer@Example.com ",
        name: "  Ada  ",
        turnstileToken: " token-1 ",
      },
      { startCheckout: startCheckoutAction, assign: (url) => assigned.push(url) },
    )

    expect(outcome).toEqual({ ok: true })
    expect(assigned).toEqual(["https://checkout.paystack.com/abc123"])

    // The card's validation produced exactly the action's input: the same keys,
    // trimmed, with the name kept because it was given.
    expect(edges.createOrder).toHaveBeenCalledTimes(1)
    expect(edges.createOrder.mock.calls[0]?.[0]).toMatchObject({
      productId: PRODUCT,
      email: "buyer@example.com",
      name: "Ada",
      buyerUserId: null,
      affiliateId: null,
      clickId: null,
    })

    // The amount is the database's, and the callback is the configured host.
    expect(edges.initializeTransaction.mock.calls[0]?.[0]).toMatchObject({
      email: "buyer@example.com",
      amountKobo: PRICE_KOBO,
      currency: "NGN",
      callbackUrl: "https://affilova.vercel.app/checkout/return",
      metadata: { order_id: ORDER_ID, order_number: "AFV-2026-000001" },
    })

    // The Turnstile token the card collected is the one the server verified.
    expect(edges.verifyCheckoutTurnstile).toHaveBeenCalledWith("token-1")
  })

  it("ignores a price a browser tries to send", async () => {
    const request = {
      productId: PRODUCT,
      email: "buyer@example.com",
      turnstileToken: "token-1",
      // Not part of the contract, and must not reach the order or Paystack.
      amountKobo: 1,
      totalKobo: 1,
      priceKobo: 1,
    }

    const answer = await startCheckoutAction(request)

    expect(answer).toEqual({ ok: true, authorizationUrl: "https://checkout.paystack.com/abc123" })
    expect(edges.createOrder.mock.calls[0]?.[0]).not.toHaveProperty("amountKobo")
    expect(edges.initializeTransaction.mock.calls[0]?.[0]).toMatchObject({ amountKobo: PRICE_KOBO })
  })

  it("shows the action's own sentence when the checkout is refused", async () => {
    edges.verifyCheckoutTurnstile.mockResolvedValue({ ok: false })

    const shown: string[] = []

    const outcome = await submitPurchase(
      { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "token-1" },
      {
        startCheckout: startCheckoutAction,
        assign: (url) => shown.push(url),
      },
    )

    expect(outcome).toEqual({
      ok: false,
      error: "Complete the verification and try again.",
    })
    // Nothing was created, and the browser was not sent anywhere.
    expect(edges.createOrder).not.toHaveBeenCalled()
    expect(shown).toEqual([])
  })

  it("the card's validation and the action's schema accept the same product id", () => {
    // The card accepts any non-empty string; the action's schema requires a uuid.
    // A product id that the card would send but the action refuses would be a
    // silent failure for the buyer, so the id the card is given is checked here.
    const validated = validatePurchase({
      productId: PRODUCT,
      email: "buyer@example.com",
      turnstileToken: "token-1",
    })

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.input.productId).toBe(PRODUCT)
  })
})
