import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { OrderEmailDeps } from "@/lib/jobs/order-email"
import type { OrderSummary } from "@/lib/commerce/order-summary"
import type { SendEmailInput, SendEmailResult } from "@/lib/email/brevo"

// Contract: the payloads the SQL and the webhook enqueue, and the payloads the
// job handlers read.
//
// A queue payload is a handshake between two files that never import each other:
// a migration writes jsonb keys, and a handler in TypeScript reads them. A rename
// on one side is silent at compile time and the email simply never goes out, so
// each handshake is driven here end to end:
//
//   * order_paid     the keys are read out of the migration that enqueues it, a
//                    payload is built from those exact keys, and the real handler
//                    is asked to run it;
//   * refund_notice  the real webhook handler is run against a refund.processed
//                    event, the payload it enqueues is captured, and that exact
//                    payload is handed to the real handler.
//
// Only the network (Paystack, the email provider) and the database are faked.

const ROOT = join(__dirname, "..", "..")

const ORDER_ID = "11111111-1111-4111-8111-111111111111"
const REQUEST_ID = "22222222-2222-4222-8222-222222222222"
const SECRET_KEY = "sk_test_0123456789abcdef0123456789abcdef"
const WEBHOOK_URL = "https://affilova.vercel.app/api/paystack/webhook"

/**
 * The keys of the jsonb object the migration passes to enqueue_job for one job
 * type, read from the SQL itself rather than from a copy of it here.
 */
function enqueuedKeys(jobType: string): string[] {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261116000200_commerce_core.sql"), "utf8")
  const start = sql.indexOf(`public.enqueue_job(\n    '${jobType}'`)

  expect(start, `enqueue_job('${jobType}') is in the migration`).toBeGreaterThan(-1)

  const block = sql.slice(start, sql.indexOf("),", start) + 2)
  const keys: string[] = []

  for (const match of block.matchAll(/'([a-z_]+)'\s*,/g)) {
    const key = match[1]

    if (key !== undefined && key !== jobType) {
      keys.push(key)
    }
  }

  return keys
}

const SUMMARY: OrderSummary = {
  id: ORDER_ID,
  number: "AFV-2026-000001",
  buyerEmail: "buyer@example.com",
  buyerName: null,
  status: "paid",
  paidAt: "2026-11-19T09:00:00.000Z",
  totalKobo: 4_033_300,
  currency: "NGN",
  commissionHoldDays: 7,
  item: {
    productId: "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30",
    productSlug: "a-product",
    title: "A product",
    unitPriceKobo: 4_033_300,
    vendorId: "33333333-3333-4333-8333-333333333333",
    vendorBusinessName: "A shop",
    vendorEmail: "vendor@example.com",
    affiliateId: null,
    affiliateEmail: null,
    affiliateCommissionKobo: 0,
    vendorNetKobo: 3_000_000,
    refundWindowHours: 48,
    maxDownloads: 3,
  },
}

function emailDeps(status = "paid") {
  const readOrder = vi.fn(async (_orderId: string): Promise<OrderSummary | null> => ({
    ...SUMMARY,
    status,
  }))
  const claim = vi.fn(async (_kind: string, _orderId: string, _hash: string) => true)
  const send = vi.fn(async (_input: SendEmailInput): Promise<SendEmailResult> => ({
    ok: true,
    messageId: "msg-1",
  }))

  const deps: OrderEmailDeps = {
    readOrder,
    createToken: () => "token",
    send,
    log: {
      claim,
      markSent: async () => undefined,
      release: async () => undefined,
    },
    branding: {
      siteUrl: "https://affilova.vercel.app",
      contactUrl: "https://affilova.vercel.app/contact",
    },
  }

  return { readOrder, claim, send, deps }
}

describe("order_paid: what process_paid_order enqueues and what the handler reads", () => {
  it("enqueues the key the handler looks for", () => {
    const keys = enqueuedKeys("order_paid")

    expect(keys).toContain("order_id")
    // The other two are for a person reading the queue, not for the handler.
    expect(keys).toEqual(["order_id", "number", "buyer_email"])
  })

  it("runs the handler with a payload built from those exact keys", async () => {
    const { deps, readOrder, claim, send } = emailDeps()

    const values: Record<string, string> = {
      order_id: ORDER_ID,
      number: "AFV-2026-000001",
      buyer_email: "buyer@example.com",
    }

    const payload = Object.fromEntries(
      enqueuedKeys("order_paid").map((key) => [key, values[key] ?? "unexpected"]),
    )

    const { runOrderPaidJob } = await import("@/lib/jobs/order-email")
    await runOrderPaidJob(payload, deps)

    // The handler found the order, and sent the receipt and the vendor notice.
    expect(readOrder).toHaveBeenCalledWith(ORDER_ID)
    expect(claim).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("does nothing when the key it reads is missing", async () => {
    const { deps, readOrder } = emailDeps()
    const { runOrderPaidJob } = await import("@/lib/jobs/order-email")

    await runOrderPaidJob({ number: "AFV-2026-000001", buyer_email: "buyer@example.com" }, deps)

    expect(readOrder).not.toHaveBeenCalled()
  })
})

describe("refund_notice: what the webhook enqueues and what the handler reads", () => {
  async function enqueueFromWebhook(): Promise<{ payload: Record<string, unknown>; dedupeKey: string | undefined }> {
    const { handlePaystackWebhook } = await import("@/app/api/paystack/webhook/route")

    const enqueued: { payload: Record<string, unknown>; dedupeKey: string | undefined }[] = []

    const body = JSON.stringify({
      event: "refund.processed",
      data: { id: 3018284, transaction: { reference: "afv_abc123" } },
    })

    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-forwarded-for": "52.31.139.75",
        "x-paystack-signature": createHmac("sha512", SECRET_KEY).update(Buffer.from(body, "utf8")).digest("hex"),
      }),
      body,
    })

    const response = await handlePaystackWebhook(request, {
      secretKey: SECRET_KEY,
      webhookSecret: undefined,
      enforceIps: false,
      verifyTransaction: async () => {
        throw new Error("not used")
      },
      insertEvent: async () => ({ id: "event-1", duplicate: false }),
      finishEvent: async () => undefined,
      processPaidOrder: async () => ({ status: "not_found", orderId: null, number: null }),
      findOpenRefund: async () => ({ requestId: REQUEST_ID, status: "approved", amountKobo: 4_033_300 }),
      processRefund: async () => ({ status: "processed", orderId: ORDER_ID }),
      enqueueJob: async (input) => {
        enqueued.push({ payload: input.payload ?? {}, dedupeKey: input.dedupeKey })

        return "job-1"
      },
      markRefundFailed: async () => undefined,
      getOrderByReference: async () => null,
      openDispute: async () => ({ status: "disputed" }),
      resolveDispute: async () => ({ status: "won" }),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })

    expect(response.status).toBe(200)
    expect(enqueued).toHaveLength(1)

    return enqueued[0] as { payload: Record<string, unknown>; dedupeKey: string | undefined }
  }

  it("enqueues one notice, keyed by the order", async () => {
    const { payload, dedupeKey } = await enqueueFromWebhook()

    expect(dedupeKey).toBe(`refund_notice:${ORDER_ID}`)
    expect(Object.keys(payload)).toEqual(["order_id"])
  })

  it("hands the handler the payload the webhook built, and the notice goes out", async () => {
    const { payload } = await enqueueFromWebhook()
    const { deps, readOrder, claim, send } = emailDeps("refunded")

    const { runRefundNoticeJob } = await import("@/lib/jobs/order-email")
    await runRefundNoticeJob(payload, deps)

    expect(readOrder).toHaveBeenCalledWith(ORDER_ID)
    expect(claim).toHaveBeenCalledWith("refund_notice", ORDER_ID, expect.stringMatching(/^[0-9a-f]{32}$/))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("does nothing when the notice payload has no order", async () => {
    const { deps, readOrder } = emailDeps()
    const { runRefundNoticeJob } = await import("@/lib/jobs/order-email")

    await runRefundNoticeJob({}, deps)

    expect(readOrder).not.toHaveBeenCalled()
  })
})
