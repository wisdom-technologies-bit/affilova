import { describe, expect, it, vi } from "vitest"

import {
  EMAIL_INVALID,
  EMAIL_REQUIRED,
  VERIFICATION_REQUIRED,
  submitPurchase,
  validatePurchase,
} from "./purchase"

const PRODUCT = "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30"

describe("the purchase card's rules", () => {
  it("requires an email address", () => {
    const result = validatePurchase({ productId: PRODUCT, email: "  ", turnstileToken: "t" })

    expect(result).toEqual({ ok: false, error: EMAIL_REQUIRED, fieldErrors: { email: EMAIL_REQUIRED } })
  })

  it("rejects an address that is not one", () => {
    for (const email of ["buyer", "buyer@", "buyer@example", "@example.com"]) {
      const result = validatePurchase({ productId: PRODUCT, email, turnstileToken: "t" })

      expect(result).toEqual({ ok: false, error: EMAIL_INVALID, fieldErrors: { email: EMAIL_INVALID } })
    }
  })

  it("refuses to submit without a verification token", () => {
    expect(
      validatePurchase({ productId: PRODUCT, email: "buyer@example.com", turnstileToken: "" }),
    ).toEqual({ ok: false, error: VERIFICATION_REQUIRED })
  })

  it("trims the values it sends and drops an empty name", () => {
    const result = validatePurchase({
      productId: PRODUCT,
      email: "  buyer@example.com ",
      name: "  ",
      turnstileToken: " token ",
    })

    expect(result).toEqual({
      ok: true,
      input: { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "token" },
    })
  })

  it("starts the checkout and sends the browser to the provider on success", async () => {
    const startCheckout = vi.fn(async () => ({
      ok: true as const,
      authorizationUrl: "https://checkout.paystack.com/abc123",
    }))
    const assign = vi.fn()

    const outcome = await submitPurchase(
      { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "token" },
      { startCheckout, assign },
    )

    expect(outcome).toEqual({ ok: true })
    expect(startCheckout).toHaveBeenCalledWith({
      productId: PRODUCT,
      email: "buyer@example.com",
      turnstileToken: "token",
    })
    expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc123")
  })

  it("shows the action's own field errors and never navigates", async () => {
    const startCheckout = vi.fn(async () => ({
      ok: false as const,
      error: "Check the email address.",
      fieldErrors: { email: "Check the email address." },
    }))
    const assign = vi.fn()

    const outcome = await submitPurchase(
      { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "token" },
      { startCheckout, assign },
    )

    expect(outcome).toEqual({
      ok: false,
      error: "Check the email address.",
      fieldErrors: { email: "Check the email address." },
    })
    expect(assign).not.toHaveBeenCalled()
  })

  it("never calls the action when the challenge is missing", async () => {
    const startCheckout = vi.fn()
    const assign = vi.fn()

    const outcome = await submitPurchase(
      { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "" },
      { startCheckout, assign },
    )

    expect(outcome).toEqual({ ok: false, error: VERIFICATION_REQUIRED })
    expect(startCheckout).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it("answers a sentence, not a crash, when the action throws", async () => {
    const outcome = await submitPurchase(
      { productId: PRODUCT, email: "buyer@example.com", turnstileToken: "token" },
      {
        startCheckout: async () => {
          throw new Error("network")
        },
        assign: vi.fn(),
      },
    )

    expect(outcome).toEqual({ ok: false, error: "We could not start the payment. Please try again." })
  })
})
