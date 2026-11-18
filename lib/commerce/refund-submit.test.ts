import { describe, expect, it } from "vitest"

// Submitting an approved refund.
//
// The ledger is never touched here: this module only asks Paystack, records what
// it said, and decides whether a failure is worth another try. The two things it
// must never do are refund twice and mark a refund failed for a reason that
// would have passed.

import {
  refundProviderReference,
  refundSubmitDedupeKey,
  runRefundSubmitJob,
  type RefundSubmitDeps,
} from "./refund-submit"
import { PaystackError } from "@/lib/paystack/client"

const REQUEST_ID = "22222222-2222-2222-2222-222222222222"
const ORDER_ID = "11111111-1111-1111-1111-111111111111"

interface Fakes {
  deps: RefundSubmitDeps
  refunds: Record<string, unknown>[]
  submitted: { requestId: string; providerReference: string }[]
  failed: { requestId: string; reason: string }[]
  warnings: { event: string; fields: Record<string, unknown> }[]
}

function makeFakes(overrides: Partial<RefundSubmitDeps> = {}): Fakes {
  const refunds: Record<string, unknown>[] = []
  const submitted: { requestId: string; providerReference: string }[] = []
  const failed: { requestId: string; reason: string }[] = []
  const warnings: { event: string; fields: Record<string, unknown> }[] = []

  const deps: RefundSubmitDeps = {
    readRequest: async () => ({
      id: REQUEST_ID,
      status: "approved",
      orderId: ORDER_ID,
      providerReference: null,
    }),
    readOrder: async () => ({ reference: "afv_abc123", totalKobo: 40333, status: "paid" }),
    createRefund: async (input) => {
      refunds.push({ ...input })

      return { id: 3018284, status: "pending", amountKobo: 40333, currency: "NGN", reference: input.reference }
    },
    markSubmitted: async (requestId, providerReference) => {
      submitted.push({ requestId, providerReference })
    },
    markFailed: async (requestId, reason) => {
      failed.push({ requestId, reason })
    },
    logWarn: (event, fields) => {
      warnings.push({ event, fields })
    },
    ...overrides,
  }

  return { deps, refunds, submitted, failed, warnings }
}

const PAYLOAD = { request_id: REQUEST_ID }

describe("the happy path", () => {
  it("asks Paystack for the order total and records the reference", async () => {
    const fakes = makeFakes()

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.refunds).toHaveLength(1)
    expect(fakes.refunds[0]).toMatchObject({
      transaction: "afv_abc123",
      amountKobo: 40333,
      reference: refundProviderReference(REQUEST_ID),
    })
    expect(fakes.submitted).toEqual([
      { requestId: REQUEST_ID, providerReference: refundProviderReference(REQUEST_ID) },
    ])
    expect(fakes.failed).toHaveLength(0)
  })

  it("uses a reference Paystack will accept: 8 to 64 of letters, digits and underscores", () => {
    const reference = refundProviderReference(REQUEST_ID)

    expect(reference).toBe("afv_refund_22222222222222222222222222222222")
    expect(reference).toMatch(/^[A-Za-z0-9_]{8,64}$/)
  })

  it("keys the job by request, so one request has one live job", () => {
    expect(refundSubmitDedupeKey(REQUEST_ID)).toBe(`refund_submit:${REQUEST_ID}`)
  })
})

describe("nothing to do", () => {
  it("does nothing for a request that is still waiting for a decision", async () => {
    const fakes = makeFakes({
      readRequest: async () => ({ id: REQUEST_ID, status: "requested", orderId: ORDER_ID, providerReference: null }),
    })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.refunds).toHaveLength(0)
  })

  it("does nothing for a request that was already submitted", async () => {
    const fakes = makeFakes({
      readRequest: async () => ({
        id: REQUEST_ID,
        status: "approved",
        orderId: ORDER_ID,
        providerReference: "afv_refund_existing",
      }),
    })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.refunds).toHaveLength(0)
  })

  it("does nothing for a request that no longer exists", async () => {
    const fakes = makeFakes({ readRequest: async () => null })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.refunds).toHaveLength(0)
  })

  it("refuses a payload without a request id", async () => {
    const fakes = makeFakes()

    await expect(runRefundSubmitJob({ request_id: "nope" }, fakes.deps)).rejects.toThrow("refund_submit_bad_payload")
  })
})

describe("failures", () => {
  it("records a terminal refusal and does not retry", async () => {
    const fakes = makeFakes({
      createRefund: async () => {
        throw new PaystackError("bad_request", "Paystack refused the request.", { retryable: false, status: 400 })
      },
    })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.failed).toEqual([{ requestId: REQUEST_ID, reason: "paystack_bad_request" }])
    expect(fakes.submitted).toHaveLength(0)
  })

  it("rethrows a retryable failure so the queue tries again", async () => {
    const fakes = makeFakes({
      createRefund: async () => {
        throw new PaystackError("server_error", "Paystack is unavailable right now.", {
          retryable: true,
          status: 500,
        })
      },
    })

    await expect(runRefundSubmitJob(PAYLOAD, fakes.deps)).rejects.toBeInstanceOf(PaystackError)
    expect(fakes.failed).toHaveLength(0)
  })

  it("treats a 409 as already submitted: our reference is already with Paystack", async () => {
    const fakes = makeFakes({
      createRefund: async () => {
        throw new PaystackError("bad_request", "Paystack refused the request.", { retryable: false, status: 409 })
      },
    })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.submitted).toHaveLength(1)
    expect(fakes.failed).toHaveLength(0)
    expect(fakes.warnings[0]?.event).toBe("refund_submit_already_exists")
  })

  it("marks the request failed when the order has vanished", async () => {
    const fakes = makeFakes({ readOrder: async () => null })

    await runRefundSubmitJob(PAYLOAD, fakes.deps)

    expect(fakes.failed).toEqual([{ requestId: REQUEST_ID, reason: "order_missing" }])
  })

  it("rethrows an unclassified failure rather than blaming the refund", async () => {
    const fakes = makeFakes({
      createRefund: async () => {
        throw new Error("commerce_rpc_failed:read_order_for_refund")
      },
    })

    await expect(runRefundSubmitJob(PAYLOAD, fakes.deps)).rejects.toThrow("read_order_for_refund")
    expect(fakes.failed).toHaveLength(0)
  })
})
