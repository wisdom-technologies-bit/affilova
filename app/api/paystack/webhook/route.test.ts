import { createHash, createHmac } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

// The webhook endpoint, driven end to end with fakes.
//
// Every event Paystack can send is here, plus the four ways a delivery is
// refused or retried. The fakes record what the handler asked for, which is how
// "the amount came from the verified response, not the body" is proven.

import {
  handlePaystackWebhook,
  MAX_WEBHOOK_BODY_BYTES,
  type WebhookDeps,
} from "./route"
import type { VerifiedTransaction } from "@/lib/paystack/client"
import { PaystackError } from "@/lib/paystack/client"

const SECRET_KEY = "sk_test_0123456789abcdef0123456789abcdef"
const ORDER_ID = "11111111-1111-1111-1111-111111111111"
const REQUEST_ID = "22222222-2222-2222-2222-222222222222"
const URL = "https://affilova.vercel.app/api/paystack/webhook"

interface Fakes {
  deps: WebhookDeps
  calls: {
    insert: { provider: string; sha256: string; eventType: string | null; reference: string | null }[]
    finish: { id: string; status: string; error: string | null }[]
    processPaidOrder: Record<string, unknown>[]
    processRefund: Record<string, unknown>[]
    enqueue: { type: string; payload: Record<string, unknown>; dedupeKey: string | undefined }[]
    markRefundFailed: { requestId: string; reason: string }[]
    openDispute: { reference: string; note: string }[]
    recordDisputeProviderOutcome: { reference: string; resolution: string; note: string }[]
    verify: string[]
  }
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
}

function verified(overrides: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    id: 4099260516,
    status: "success",
    reference: "afv_abc123",
    amountKobo: 40333,
    currency: "NGN",
    feesKobo: 10283,
    channel: "card",
    paidAt: "2024-08-22T09:15:02.000Z",
    gatewayResponse: "Successful",
    ...overrides,
  }
}

function makeFakes(overrides: Partial<WebhookDeps> = {}): Fakes {
  const calls: Fakes["calls"] = {
    insert: [],
    finish: [],
    processPaidOrder: [],
    processRefund: [],
    enqueue: [],
    markRefundFailed: [],
    openDispute: [],
    recordDisputeProviderOutcome: [],
    verify: [],
  }

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  const deps: WebhookDeps = {
    secretKey: SECRET_KEY,
    webhookSecret: undefined,
    enforceIps: false,
    verifyTransaction: async (reference) => {
      calls.verify.push(reference)

      return verified({ reference })
    },
    insertEvent: async (input) => {
      calls.insert.push(input)

      return { id: "event-1", duplicate: false }
    },
    finishEvent: async (id, status, error) => {
      calls.finish.push({ id, status, error: error ?? null })
    },
    processPaidOrder: async (input) => {
      calls.processPaidOrder.push({ ...input })

      return { status: "processed", orderId: ORDER_ID, number: "AFV-2026-000001" }
    },
    findOpenRefund: async () => ({ requestId: REQUEST_ID, status: "approved", amountKobo: 40333 }),
    processRefund: async (input) => {
      calls.processRefund.push({ ...input })

      return { status: "processed", orderId: ORDER_ID }
    },
    enqueueJob: async (input) => {
      calls.enqueue.push({
        type: input.type,
        payload: input.payload ?? {},
        dedupeKey: input.dedupeKey,
      })

      return "job-1"
    },
    markRefundFailed: async (requestId, reason) => {
      calls.markRefundFailed.push({ requestId, reason })
    },
    getOrderByReference: async () => ({
      id: ORDER_ID,
      number: "AFV-2026-000001",
      status: "paid",
      totalKobo: 40333,
      buyerEmail: "buyer@example.com",
    }),
    openDispute: async (reference, note) => {
      calls.openDispute.push({ reference, note })

      return { status: "disputed" }
    },
    recordDisputeProviderOutcome: async (reference, resolution, note) => {
      calls.recordDisputeProviderOutcome.push({ reference, resolution, note })

      return { status: "recorded", needsDecision: true }
    },
    log,
    ...overrides,
  }

  return { deps, calls, log }
}

function sign(body: string): string {
  return createHmac("sha512", SECRET_KEY).update(Buffer.from(body, "utf8")).digest("hex")
}

function request(
  body: string,
  options: { signature?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": "52.31.139.75",
    ...options.headers,
  })

  const signature = options.signature === undefined ? sign(body) : options.signature

  if (signature !== null) {
    headers.set("x-paystack-signature", signature)
  }

  return new Request(URL, { method: "POST", headers, body })
}

function body(event: string, data: unknown): string {
  return JSON.stringify({ event, data })
}

let fakes: Fakes

beforeEach(() => {
  fakes = makeFakes()
})

describe("refusals", () => {
  it("answers 401 with an empty body for a bad signature", async () => {
    const response = await handlePaystackWebhook(request(body("charge.success", {}), { signature: "0".repeat(128) }), fakes.deps)

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
    expect(fakes.calls.insert).toHaveLength(0)
  })

  it("answers 401 when the signature header is missing", async () => {
    const response = await handlePaystackWebhook(request(body("charge.success", {}), { signature: null }), fakes.deps)

    expect(response.status).toBe(401)
  })

  it("answers 413 for a declared body over 64 KB", async () => {
    const response = await handlePaystackWebhook(
      request(body("charge.success", {}), { headers: { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1) } }),
      fakes.deps,
    )

    expect(response.status).toBe(413)
  })

  it("answers 413 for an actual body over 64 KB", async () => {
    const padding = "x".repeat(MAX_WEBHOOK_BODY_BYTES)
    const response = await handlePaystackWebhook(request(body("charge.success", { padding })), fakes.deps)

    expect(response.status).toBe(413)
  })

  it("refuses an unexpected source address when the allowlist is enforced", async () => {
    const response = await handlePaystackWebhook(
      request(body("charge.success", { reference: "afv_abc123" }), { headers: { "x-forwarded-for": "203.0.113.9" } }),
      { ...fakes.deps, enforceIps: true },
    )

    expect(response.status).toBe(401)
    expect(fakes.log.warn).toHaveBeenCalledWith("paystack_webhook_ip_rejected", { source: "203.0.113.9" })
  })

  it("only warns for an unexpected address when the allowlist is off", async () => {
    const response = await handlePaystackWebhook(
      request(body("charge.success", { reference: "afv_abc123" }), { headers: { "x-forwarded-for": "203.0.113.9" } }),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.log.warn).toHaveBeenCalledWith("paystack_webhook_ip_unexpected", { source: "203.0.113.9" })
  })
})

describe("duplicates", () => {
  it("answers 200 immediately and handles nothing", async () => {
    fakes = makeFakes({ insertEvent: async () => ({ id: "event-1", duplicate: true }) })

    const raw = body("charge.success", { reference: "afv_abc123" })
    const response = await handlePaystackWebhook(request(raw), fakes.deps)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, duplicate: true })
    expect(fakes.calls.verify).toHaveLength(0)
    expect(fakes.calls.processPaidOrder).toHaveLength(0)
  })

  it("records the body's SHA-256, never the body", async () => {
    const raw = body("charge.success", { reference: "afv_abc123" })

    await handlePaystackWebhook(request(raw), fakes.deps)

    expect(fakes.calls.insert).toHaveLength(1)
    expect(fakes.calls.insert[0]?.sha256).toBe(createHash("sha256").update(Buffer.from(raw)).digest("hex"))
    expect(fakes.calls.insert[0]?.provider).toBe("paystack")
    expect(fakes.calls.insert[0]?.eventType).toBe("charge.success")
    expect(fakes.calls.insert[0]?.reference).toBe("afv_abc123")
  })
})

describe("charge.success", () => {
  it("posts the order using the verified response, not the body", async () => {
    const raw = body("charge.success", {
      reference: "afv_abc123",
      // A hostile or stale body: none of this may reach process_paid_order.
      amount: 1,
      currency: "USD",
      fees: 0,
      id: 1,
      channel: "cash",
      paid_at: "1999-01-01T00:00:00.000Z",
    })

    const response = await handlePaystackWebhook(request(raw), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.verify).toEqual(["afv_abc123"])
    expect(fakes.calls.processPaidOrder[0]).toEqual({
      reference: "afv_abc123",
      paystackTransactionId: 4099260516,
      amountKobo: 40333,
      currency: "NGN",
      feesKobo: 10283,
      channel: "card",
      paidAt: "2024-08-22T09:15:02.000Z",
    })
    expect(fakes.calls.finish).toEqual([{ id: "event-1", status: "processed", error: null }])
  })

  it("treats already_paid as handled", async () => {
    fakes = makeFakes({
      processPaidOrder: async () => ({ status: "already_paid", orderId: ORDER_ID, number: "AFV-2026-000001" }),
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]?.status).toBe("processed")
  })

  it("logs a mismatch at error level and answers 200", async () => {
    fakes = makeFakes({
      processPaidOrder: async () => ({ status: "mismatch", orderId: ORDER_ID, number: "AFV-2026-000001" }),
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.log.error).toHaveBeenCalledWith("paystack_amount_mismatch", {
      reference: "afv_abc123",
      order: ORDER_ID,
    })
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "failed", error: "amount_mismatch" })
  })

  it("logs an unknown order at warn level and ignores it", async () => {
    fakes = makeFakes({
      processPaidOrder: async () => ({ status: "not_found", orderId: null, number: null }),
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_unknown" })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.log.warn).toHaveBeenCalledWith("paystack_order_not_found", { reference: "afv_unknown" })
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "ignored", error: "order_not_found" })
  })

  it("ignores a charge that is not successful", async () => {
    fakes = makeFakes({ verifyTransaction: async () => verified({ status: "abandoned" }) })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.processPaidOrder).toHaveLength(0)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })

  it("answers 500 when Paystack cannot be asked, so the event is retried", async () => {
    fakes = makeFakes({
      verifyTransaction: async () => {
        throw new PaystackError("server_error", "down", { retryable: true, status: 503 })
      },
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(500)
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "failed", error: "verify_unavailable" })
  })

  it("answers 200 when Paystack refuses the reference outright", async () => {
    fakes = makeFakes({
      verifyTransaction: async () => {
        throw new PaystackError("not_found", "unknown reference", { retryable: false, status: 404 })
      },
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]?.status).toBe("failed")
  })

  it("answers 500 when the database is unreachable", async () => {
    fakes = makeFakes({
      processPaidOrder: async () => {
        throw new Error("commerce_rpc_failed:process_paid_order")
      },
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(500)
    expect(fakes.calls.finish[0]?.status).toBe("failed")
  })

  it("fails a charge with no reference", async () => {
    const response = await handlePaystackWebhook(request(body("charge.success", { amount: 100 })), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "failed", error: "missing_reference" })
  })
})

describe("refund events", () => {
  it("does nothing for refund.pending", async () => {
    const response = await handlePaystackWebhook(
      request(body("refund.pending", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.processRefund).toHaveLength(0)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })

  it("does nothing for refund.processing", async () => {
    const response = await handlePaystackWebhook(
      request(body("refund.processing", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.processRefund).toHaveLength(0)
  })

  it("does nothing for refund.needs-attention, which needs a person", async () => {
    const response = await handlePaystackWebhook(
      request(body("refund.needs-attention", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.processRefund).toHaveLength(0)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })

  it("reverses the ledger on refund.processed, with the order total", async () => {
    const response = await handlePaystackWebhook(
      request(
        body("refund.processed", {
          id: 3018284,
          amount: 1,
          reference: "afv_refund_abc",
          transaction: { reference: "afv_abc123" },
        }),
      ),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.processRefund[0]).toEqual({
      requestId: REQUEST_ID,
      providerReference: "afv_refund_abc",
      amountKobo: 40333,
    })
    expect(fakes.calls.finish[0]?.status).toBe("processed")
  })

  it("queues the buyer's refund notice once the reversal is posted", async () => {
    const response = await handlePaystackWebhook(
      request(body("refund.processed", { id: 3018284, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.enqueue).toEqual([
      { type: "refund_notice", payload: { order_id: ORDER_ID }, dedupeKey: `refund_notice:${ORDER_ID}` },
    ])
  })

  it("does not queue a second notice when the reversal was already posted", async () => {
    fakes = makeFakes({
      processRefund: async () => ({ status: "already_processed", orderId: ORDER_ID }),
    })

    const response = await handlePaystackWebhook(
      request(body("refund.processed", { id: 3018284, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.enqueue).toHaveLength(0)
  })

  it("does not queue a second notice for a redelivered refund.processed", async () => {
    const raw = body("refund.processed", { id: 3018284, transaction: { reference: "afv_abc123" } })

    await handlePaystackWebhook(request(raw), fakes.deps)

    // Paystack retries the same body: insertEvent now reports it as a duplicate.
    const retry = makeFakes({
      insertEvent: async () => ({ id: "event-1", duplicate: true }),
      enqueueJob: async (input) => {
        retry.calls.enqueue.push({
          type: input.type,
          payload: input.payload ?? {},
          dedupeKey: input.dedupeKey,
        })

        return "job-2"
      },
    })

    const response = await handlePaystackWebhook(request(raw), retry.deps)

    expect(response.status).toBe(200)
    expect(retry.calls.enqueue).toHaveLength(0)
  })

  it("keeps the reversal when the notice cannot be queued", async () => {
    fakes = makeFakes({
      enqueueJob: async () => {
        throw new Error("queue_unavailable")
      },
    })

    const response = await handlePaystackWebhook(
      request(body("refund.processed", { id: 3018284, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]?.status).toBe("processed")
    expect(fakes.log.error).toHaveBeenCalledWith("paystack_refund_notice_enqueue_failed", {})
  })

  it("ignores refund.processed with no open request", async () => {
    fakes = makeFakes({ findOpenRefund: async () => null })

    const response = await handlePaystackWebhook(
      request(body("refund.processed", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.processRefund).toHaveLength(0)
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "ignored", error: "no_open_request" })
  })

  it("marks the request failed on refund.failed", async () => {
    const response = await handlePaystackWebhook(
      request(body("refund.failed", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.markRefundFailed).toEqual([{ requestId: REQUEST_ID, reason: "paystack_refund_failed" }])
  })

  it("answers 500 when a refund cannot be recorded", async () => {
    fakes = makeFakes({
      processRefund: async () => {
        throw new Error("commerce_rpc_failed:process_refund")
      },
    })

    const response = await handlePaystackWebhook(
      request(body("refund.processed", { id: 1, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(500)
  })
})

describe("dispute events", () => {
  it("opens a dispute on charge.dispute.create", async () => {
    const response = await handlePaystackWebhook(
      request(body("charge.dispute.create", { id: 624, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.openDispute).toEqual([{ reference: "afv_abc123", note: "Paystack dispute 624" }])
  })

  it("ignores a dispute on an order we do not have", async () => {
    fakes = makeFakes({
      openDispute: async () => {
        throw new Error("not_found")
      },
    })

    const response = await handlePaystackWebhook(
      request(body("charge.dispute.create", { id: 624, transaction: { reference: "afv_unknown" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })

  it("records merchant-accepted and leaves the decision to a person", async () => {
    const response = await handlePaystackWebhook(
      request(
        body("charge.dispute.resolve", {
          id: 624,
          resolution: "merchant-accepted",
          transaction: { reference: "afv_abc123" },
        }),
      ),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.recordDisputeProviderOutcome).toEqual([
      { reference: "afv_abc123", resolution: "merchant-accepted", note: "Paystack dispute 624" },
    ])
  })

  it("records declined and leaves the decision to a person", async () => {
    const response = await handlePaystackWebhook(
      request(
        body("charge.dispute.resolve", {
          id: 624,
          resolution: "declined",
          transaction: { reference: "afv_abc123" },
        }),
      ),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.recordDisputeProviderOutcome).toEqual([
      { reference: "afv_abc123", resolution: "declined", note: "Paystack dispute 624" },
    ])
  })

  it("ignores a resolution it does not recognise rather than guessing", async () => {
    const response = await handlePaystackWebhook(
      request(
        body("charge.dispute.resolve", {
          id: 624,
          resolution: "auto-accepted",
          transaction: { reference: "afv_abc123" },
        }),
      ),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.recordDisputeProviderOutcome).toHaveLength(0)
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "ignored", error: "resolution_unknown" })
  })

  it("ignores a resolve for an order we do not have", async () => {
    fakes = makeFakes({
      recordDisputeProviderOutcome: async () => {
        throw new Error("not_found")
      },
    })

    const response = await handlePaystackWebhook(
      request(
        body("charge.dispute.resolve", {
          id: 624,
          resolution: "declined",
          transaction: { reference: "afv_unknown" },
        }),
      ),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })
})

describe("everything else", () => {
  it("records an unknown event as ignored and answers 200", async () => {
    const response = await handlePaystackWebhook(
      request(body("transfer.success", { reference: "whatever" })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.finish).toEqual([{ id: "event-1", status: "ignored", error: "unhandled_event" }])
  })

  it("records charge.dispute.remind as ignored", async () => {
    const response = await handlePaystackWebhook(
      request(body("charge.dispute.remind", { id: 624, transaction: { reference: "afv_abc123" } })),
      fakes.deps,
    )

    expect(response.status).toBe(200)
    expect(fakes.calls.openDispute).toHaveLength(0)
    expect(fakes.calls.finish[0]?.status).toBe("ignored")
  })

  it("records an unreadable envelope as failed and answers 200", async () => {
    const raw = JSON.stringify({ nothing: true })
    const response = await handlePaystackWebhook(request(raw), fakes.deps)

    expect(response.status).toBe(200)
    expect(fakes.calls.finish[0]).toEqual({ id: "event-1", status: "failed", error: "unreadable_envelope" })
  })

  it("answers 500 when the delivery cannot be recorded at all", async () => {
    fakes = makeFakes({
      insertEvent: async () => {
        throw new Error("commerce_rpc_failed:insert_webhook_event")
      },
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(500)
    expect(fakes.calls.verify).toHaveLength(0)
  })

  it("still answers when finishing the record fails", async () => {
    fakes = makeFakes({
      finishEvent: async () => {
        throw new Error("commerce_rpc_failed:finish_webhook_event")
      },
    })

    const response = await handlePaystackWebhook(request(body("charge.success", { reference: "afv_abc123" })), fakes.deps)

    expect(response.status).toBe(200)
  })
})
