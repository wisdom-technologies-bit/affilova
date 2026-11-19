import { describe, expect, it, vi } from "vitest"

import type { SendEmailInput } from "@/lib/email/brevo"
import type { OrderSummary } from "@/lib/commerce/order-summary"

import {
  ORDER_PAID_JOB,
  REFUND_NOTICE_JOB,
  heldUntil,
  recipientHash,
  runOrderPaidJob,
  runRefundNoticeJob,
  type EmailLog,
  type OrderEmailDeps,
} from "./order-email"

const ORDER_ID = "3f1b9c62-8d1e-4f27-9a53-1c0f5b2e7d41"

const WITH_AFFILIATE: OrderSummary = {
  id: ORDER_ID,
  number: "AFV-2026-000142",
  buyerEmail: "buyer@example.com",
  buyerName: "Ada",
  status: "paid",
  paidAt: "2026-11-18T10:00:00.000Z",
  totalKobo: 2_500_000,
  currency: "NGN",
  commissionHoldDays: 7,
  item: {
    productId: "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30",
    productSlug: "instagram-growth-playbook",
    title: "Instagram Growth Playbook",
    unitPriceKobo: 2_500_000,
    vendorId: "vendor-1",
    vendorBusinessName: "Okafor Digital",
    vendorEmail: "vendor@example.com",
    affiliateId: "affiliate-1",
    affiliateEmail: "affiliate@example.com",
    affiliateCommissionKobo: 500_000,
    vendorNetKobo: 1_750_000,
    refundWindowHours: 72,
    maxDownloads: 5,
  },
}

const WITHOUT_AFFILIATE: OrderSummary = {
  ...WITH_AFFILIATE,
  item: WITH_AFFILIATE.item === null
    ? null
    : { ...WITH_AFFILIATE.item, affiliateId: null, affiliateEmail: null, affiliateCommissionKobo: 0 },
}

/** The email_log table, in memory: the same unique key, the same three moves. */
function memoryLog(): EmailLog & { rows: Map<string, string> } {
  const rows = new Map<string, string>()
  const key = (kind: string, orderId: string, hash: string) => `${kind}|${orderId}|${hash}`

  return {
    rows,
    claim: async (kind, orderId, hash) => {
      const id = key(kind, orderId, hash)

      if (rows.has(id)) {
        return false
      }

      rows.set(id, "pending")

      return true
    },
    markSent: async (kind, orderId, hash) => {
      rows.set(key(kind, orderId, hash), "sent")
    },
    release: async (kind, orderId, hash) => {
      rows.delete(key(kind, orderId, hash))
    },
  }
}

function deps(overrides: Partial<OrderEmailDeps> = {}): OrderEmailDeps {
  return {
    readOrder: async () => WITH_AFFILIATE,
    createToken: () => "payload.signature",
    send: async () => ({ ok: true, messageId: "msg-1" }),
    log: memoryLog(),
    branding: {
      siteUrl: "https://affilova.example",
      contactUrl: "https://affilova.example/contact",
    },
    ...overrides,
  }
}

describe("the order_paid job", () => {
  it("sends three emails when an affiliate is on the order", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))
    const log = memoryLog()

    await runOrderPaidJob({ order_id: ORDER_ID }, deps({ send, log }))

    expect(send).toHaveBeenCalledTimes(3)

    const templates = send.mock.calls.map((call) => (call[0] as SendEmailInput).template)

    expect(templates).toEqual(["purchase_receipt", "vendor_sale", "affiliate_commission"])

    const recipients = send.mock.calls.map((call) => (call[0] as SendEmailInput).to)

    expect(recipients).toEqual(["buyer@example.com", "vendor@example.com", "affiliate@example.com"])
    expect([...log.rows.values()]).toEqual(["sent", "sent", "sent"])
  })

  it("sends two when there is no affiliate", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))

    await runOrderPaidJob({ order_id: ORDER_ID }, deps({ readOrder: async () => WITHOUT_AFFILIATE, send }))

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map((call) => (call[0] as SendEmailInput).template)).toEqual([
      "purchase_receipt",
      "vendor_sale",
    ])
  })

  it("gives the buyer a link built from the signed token", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))
    const createToken = vi.fn(() => "payload.signature")

    await runOrderPaidJob({ order_id: ORDER_ID }, deps({ send, createToken }))

    expect(createToken).toHaveBeenCalledWith({ orderId: ORDER_ID, email: "buyer@example.com" })

    const buyer = send.mock.calls[0]?.[0] as SendEmailInput

    expect(buyer.text).toContain("https://affilova.example/access/payload.signature")
    expect(buyer.text).toContain("AFV-2026-000142")
    expect(buyer.text).toContain("₦25,000")
  })

  it("sends nothing twice when the same job runs again", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))
    const log = memoryLog()
    const shared = deps({ send, log })

    await runOrderPaidJob({ order_id: ORDER_ID }, shared)
    await runOrderPaidJob({ order_id: ORDER_ID }, shared)

    expect(send).toHaveBeenCalledTimes(3)
  })

  it("throws on a failed send, releases the claim, and resends only that email", async () => {
    const log = memoryLog()
    const attempts: string[] = []
    let failVendor = true

    const send = vi.fn(async (input: SendEmailInput) => {
      attempts.push(input.template)

      if (input.template === "vendor_sale" && failVendor) {
        return { ok: false as const, reason: "unavailable" as const }
      }

      return { ok: true as const, messageId: "msg-1" }
    })

    const shared = deps({ send, log })

    await expect(runOrderPaidJob({ order_id: ORDER_ID }, shared)).rejects.toThrow(
      "email_send_failed:vendor_sale",
    )

    expect(attempts).toEqual(["purchase_receipt", "vendor_sale"])

    failVendor = false
    attempts.length = 0

    await runOrderPaidJob({ order_id: ORDER_ID }, shared)

    // The receipt was already sent and is claimed; the vendor and the affiliate
    // are still owed their email.
    expect(attempts).toEqual(["vendor_sale", "affiliate_commission"])
  })

  it("does nothing for an order that is missing or not paid", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))

    await runOrderPaidJob({ order_id: ORDER_ID }, deps({ readOrder: async () => null, send }))
    await runOrderPaidJob(
      { order_id: ORDER_ID },
      deps({ readOrder: async () => ({ ...WITH_AFFILIATE, status: "pending" }), send }),
    )
    await runOrderPaidJob({}, deps({ send }))

    expect(send).not.toHaveBeenCalled()
  })

  it("is registered under the type the commerce core enqueues", () => {
    expect(ORDER_PAID_JOB).toBe("order_paid")
    expect(REFUND_NOTICE_JOB).toBe("refund_notice")
  })

  it("holds a commission for the configured number of days", () => {
    expect(heldUntil("2026-11-18T10:00:00.000Z", 7)).toBe("2026-11-25T10:00:00.000Z")
  })

  it("dedupes on a hash, never on the address", () => {
    expect(recipientHash("Buyer@Example.com")).toBe(recipientHash("buyer@example.com"))
    expect(recipientHash("buyer@example.com")).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("the refund_notice job", () => {
  it("tells the buyer once", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))
    const log = memoryLog()
    const refunded = { ...WITH_AFFILIATE, status: "refunded" }
    const shared = deps({ readOrder: async () => refunded, send, log })

    await runRefundNoticeJob({ order_id: ORDER_ID }, shared)
    await runRefundNoticeJob({ order_id: ORDER_ID }, shared)

    expect(send).toHaveBeenCalledTimes(1)

    const notice = send.mock.calls[0]?.[0] as SendEmailInput

    expect(notice.template).toBe("refund_notice")
    expect(notice.to).toBe("buyer@example.com")
    expect(notice.text).toContain("₦25,000")
  })

  it("throws when the send fails, so the queue retries", async () => {
    await expect(
      runRefundNoticeJob(
        { order_id: ORDER_ID },
        deps({
          readOrder: async () => ({ ...WITH_AFFILIATE, status: "refunded" }),
          send: async () => ({ ok: false, reason: "unavailable" }),
        }),
      ),
    ).rejects.toThrow("email_send_failed:refund_notice")
  })

  it("does nothing for an order that is not refunded", async () => {
    const send = vi.fn(async (_input: SendEmailInput) => ({ ok: true as const, messageId: "msg-1" }))

    await runRefundNoticeJob({ order_id: ORDER_ID }, deps({ send }))

    expect(send).not.toHaveBeenCalled()
  })
})
