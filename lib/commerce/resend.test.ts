import { describe, expect, it, vi } from "vitest"

import type { SendEmailInput } from "@/lib/email/brevo"

import {
  RESEND_EMAIL_LIMIT,
  RESEND_IP_LIMIT,
  RESEND_NEUTRAL,
  RESEND_WINDOW_SECONDS,
  resendAccessLinks,
  type PaidOrderRef,
  type ResendDeps,
} from "./resend"

const EMAIL = "buyer@example.com"

const ORDERS: PaidOrderRef[] = [
  {
    id: "3f1b9c62-8d1e-4f27-9a53-1c0f5b2e7d41",
    number: "AFV-2026-000142",
    buyerEmail: EMAIL,
    paidAt: "2026-11-18T10:00:00.000Z",
    productTitle: "Instagram Growth Playbook",
    totalKobo: 2_500_000,
    refundWindowHours: 72,
  },
  {
    id: "7c2d1e43-5a6b-4c8d-9e0f-1a2b3c4d5e6f",
    number: "AFV-2026-000143",
    buyerEmail: EMAIL,
    paidAt: "2026-11-17T10:00:00.000Z",
    productTitle: "Second product",
    totalKobo: 1_000_000,
    refundWindowHours: 24,
  },
]

function deps(overrides: Partial<ResendDeps> = {}): ResendDeps {
  return {
    verifyTurnstile: async () => ({ ok: true }),
    rateLimit: async () => ({ allowed: true }),
    findPaidOrders: async () => ORDERS,
    createToken: () => "payload.signature",
    send: async () => ({ ok: true, messageId: "abc" }),
    siteUrl: "https://affilova.example",
    contactUrl: "https://affilova.example/contact",
    logInfo: vi.fn(),
    ...overrides,
  }
}

const input = { email: EMAIL, turnstileToken: "token", ip: "102.89.44.10" }

describe("resending access links", () => {
  it("answers the same neutral sentence after sending", async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "abc" }))
    const result = await resendAccessLinks(input, deps({ send }))

    expect(result).toEqual({ ok: true, message: RESEND_NEUTRAL })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("sends one email with one link per order", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "abc" }))

    await resendAccessLinks(input, deps({ send }))

    for (const [index, call] of send.mock.calls.entries()) {
      const payload = call[0]

      expect(payload.to).toBe(EMAIL)
      expect(payload.template).toBe("access_link_resend")
      expect(payload.text).toContain(`/access/payload.signature`)
      expect(payload.text).toContain(ORDERS[index]?.number ?? "")
    }
  })

  it("answers the same sentence for an address with no orders", async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "abc" }))

    const result = await resendAccessLinks(input, deps({ findPaidOrders: async () => [], send }))

    expect(result.message).toBe(RESEND_NEUTRAL)
    expect(send).not.toHaveBeenCalled()
  })

  it("answers the same sentence when the challenge is refused", async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "abc" }))

    const result = await resendAccessLinks(
      input,
      deps({ verifyTurnstile: async () => ({ ok: false }), send }),
    )

    expect(result.message).toBe(RESEND_NEUTRAL)
    expect(send).not.toHaveBeenCalled()
  })

  it("applies five an hour per address and three an hour per email", async () => {
    const calls: Array<{ key: string; limit: number; windowSeconds: number }> = []

    await resendAccessLinks(
      input,
      deps({
        rateLimit: async (options) => {
          calls.push({ key: options.key, limit: options.limit, windowSeconds: options.windowSeconds })

          return { allowed: true }
        },
      }),
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.limit).toBe(RESEND_IP_LIMIT)
    expect(calls[1]?.limit).toBe(RESEND_EMAIL_LIMIT)
    expect(calls[0]?.windowSeconds).toBe(RESEND_WINDOW_SECONDS)
    expect(calls[0]?.key).not.toContain("102.89.44.10")
    expect(calls[1]?.key).not.toContain(EMAIL)
  })

  it("answers the same sentence when a limit is hit, and sends nothing", async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "abc" }))

    const result = await resendAccessLinks(
      input,
      deps({ rateLimit: async () => ({ allowed: false }), send }),
    )

    expect(result.message).toBe(RESEND_NEUTRAL)
    expect(send).not.toHaveBeenCalled()
  })

  it("answers the same sentence for a malformed address", async () => {
    const findPaidOrders = vi.fn()
    const result = await resendAccessLinks(
      { ...input, email: "not-an-address" },
      deps({ findPaidOrders }),
    )

    expect(result.message).toBe(RESEND_NEUTRAL)
    expect(findPaidOrders).not.toHaveBeenCalled()
  })

  it("answers the same sentence when the lookup or the send fails", async () => {
    const lookupFailed = await resendAccessLinks(
      input,
      deps({
        findPaidOrders: async () => {
          throw new Error("database down")
        },
      }),
    )

    expect(lookupFailed.message).toBe(RESEND_NEUTRAL)

    const sendFailed = await resendAccessLinks(
      input,
      deps({ send: async () => ({ ok: false, reason: "rejected" }) }),
    )

    expect(sendFailed.message).toBe(RESEND_NEUTRAL)
  })

  it("includes at most the five most recent orders", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...ORDERS[0]!,
      id: `order-${index}`,
      number: `AFV-2026-00000${index}`,
    }))
    const send = vi.fn(async () => ({ ok: true as const, messageId: "abc" }))

    await resendAccessLinks(input, deps({ findPaidOrders: async () => many, send }))

    expect(send).toHaveBeenCalledTimes(5)
  })
})
