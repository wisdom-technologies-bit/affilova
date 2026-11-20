import { beforeEach, describe, expect, it, vi } from "vitest"

// Contract: the refund form and the two refund actions behind it.
//
// The form on the access page calls requestRefundWithTokenAction for everyone,
// and the signed-in dashboard calls requestRefundAction. Both are real here; only
// the database (request_refund, request_refund_by_email, the order read and the
// rate limiter) and the job queue are faked, so the shapes that cross the
// boundary are the ones the code really produces.
//
// What is proven: the form's own limits are the server's limits, the answer it
// reads (`ok`, `message`, `autoApproved`) is exactly what comes back, a refusal
// never looks like a success, and the two paths report auto-approval the same way.

const ORDER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ORDER = "22222222-2222-4222-8222-222222222222"
const REQUEST_ID = "33333333-3333-4333-8333-333333333333"
const SECRET = "test-order-access-secret-at-least-32-chars"

const edges = vi.hoisted(() => ({
  requestRefund: vi.fn(),
  requestRefundByEmail: vi.fn(),
  readOrderBuyerEmail: vi.fn(),
  rateLimit: vi.fn(),
  enqueueJob: vi.fn(),
  getAuthUser: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}))

vi.mock("@/lib/commerce/db", () => ({
  requestRefund: edges.requestRefund,
  requestRefundByEmail: edges.requestRefundByEmail,
  readOrderBuyerEmail: edges.readOrderBuyerEmail,
}))

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: edges.enqueueJob,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: edges.getAuthUser,
}))

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")

  return {
    rateLimitKey: actual.rateLimitKey,
    clientIpFromHeaders: () => "203.0.113.9",
    rateLimit: edges.rateLimit,
  }
})

import { requestRefundWithTokenAction } from "@/app/access/[token]/actions"
import { requestRefundAction } from "@/lib/commerce/actions"
import { createAccessToken } from "@/lib/commerce/access-token"
import { GUEST_REFUND_MAX, GUEST_REFUND_MIN } from "@/lib/commerce/guest-refund"
import { REFUND_MAX, REFUND_MIN } from "@/components/commerce/refund-form"

const REASON = "The files do not open on my machine at all."

function token(orderId: string = ORDER_ID): string {
  return createAccessToken({ orderId, email: "buyer@example.com" }, { secret: SECRET })
}

beforeEach(() => {
  process.env.ORDER_ACCESS_SECRET = SECRET

  edges.rateLimit.mockReset()
  edges.rateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetAt: new Date() })
  edges.readOrderBuyerEmail.mockReset()
  edges.readOrderBuyerEmail.mockResolvedValue("buyer@example.com")
  edges.requestRefundByEmail.mockReset()
  edges.requestRefundByEmail.mockResolvedValue({ requestId: REQUEST_ID, autoApproved: true })
  edges.requestRefund.mockReset()
  edges.requestRefund.mockResolvedValue({ requestId: REQUEST_ID, autoApproved: true })
  edges.enqueueJob.mockReset()
  edges.enqueueJob.mockResolvedValue("job-1")
  edges.getAuthUser.mockReset()
  edges.getAuthUser.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" })
})

describe("the form's limits are the server's limits", () => {
  it("uses the same reason bounds on both sides", () => {
    expect(REFUND_MIN).toBe(GUEST_REFUND_MIN)
    expect(REFUND_MAX).toBe(GUEST_REFUND_MAX)
  })
})

describe("the access page's refund action", () => {
  it("answers the shape the form reads when the refund is approved", async () => {
    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({
      ok: true,
      autoApproved: true,
      message: "Your refund was approved and is being processed.",
    })
    // The database was asked with the order's own buyer address, read from the
    // database, and the reason the buyer typed.
    expect(edges.requestRefundByEmail).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      email: "buyer@example.com",
      reason: REASON,
    })
    // The submission is queued exactly as the signed-in path queues it.
    expect(edges.enqueueJob).toHaveBeenCalledWith({
      type: "refund_submit",
      payload: { request_id: REQUEST_ID },
      dedupeKey: `refund_submit:${REQUEST_ID}`,
    })
  })

  it("does not queue anything when the request is left for a decision", async () => {
    edges.requestRefundByEmail.mockResolvedValue({ requestId: REQUEST_ID, autoApproved: false })

    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({
      ok: true,
      autoApproved: false,
      message: "Your refund request was sent to the vendor for a decision.",
    })
    expect(edges.enqueueJob).not.toHaveBeenCalled()
  })

  it("refuses an order id the link does not name, before touching the database", async () => {
    const result = await requestRefundWithTokenAction({
      token: token(),
      orderId: OTHER_ORDER,
      reason: REASON,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(
      "This link belongs to a different order, so a refund cannot be requested from it.",
    )
    expect(edges.requestRefundByEmail).not.toHaveBeenCalled()
    expect(edges.enqueueJob).not.toHaveBeenCalled()
  })

  it("refuses a link that does not verify", async () => {
    const result = await requestRefundWithTokenAction({
      token: "not-a-token",
      orderId: ORDER_ID,
      reason: REASON,
    })

    expect(result.ok).toBe(false)
    expect(edges.readOrderBuyerEmail).not.toHaveBeenCalled()
  })

  it("shows the database's own sentence when a refund already exists", async () => {
    edges.requestRefundByEmail.mockRejectedValue(new Error("refund_exists"))

    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({
      ok: false,
      message: "A refund has already been requested for this order.",
    })
    expect(edges.enqueueJob).not.toHaveBeenCalled()
  })

  it("shows a safe sentence, never the database text, for an unknown failure", async () => {
    edges.requestRefundByEmail.mockRejectedValue(new Error("duplicate key value violates constraint"))

    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({ ok: false, message: "Something went wrong. Please try again." })
  })

  it("keeps the approval when the submission cannot be queued", async () => {
    edges.enqueueJob.mockRejectedValue(new Error("queue_unavailable"))

    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({
      ok: true,
      autoApproved: true,
      message: "Your refund was approved and is being processed.",
    })
  })

  it("counts the attempt against both the address and the order", async () => {
    await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    const keys = edges.rateLimit.mock.calls.map((call) => (call[0] as { key: string; limit: number }))

    expect(keys).toHaveLength(2)
    expect(keys.map((entry) => entry.limit)).toEqual([5, 3])
    // The keys are hashes, and the two are different: one is the address, one the
    // order. Neither is the raw value.
    expect(keys[0]?.key).not.toBe(keys[1]?.key)
    expect(keys[0]?.key).toMatch(/^[0-9a-f]{64}$/)
    expect(keys[1]?.key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("refuses when the address has used its five asks", async () => {
    edges.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() })

    const result = await requestRefundWithTokenAction({ token: token(), orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({
      ok: false,
      message: "Too many attempts. Please wait a few minutes and try again.",
    })
    expect(edges.requestRefundByEmail).not.toHaveBeenCalled()
  })
})

describe("the signed-in refund action still answers the same way", () => {
  it("reports auto-approval with the same flag and queues the same job", async () => {
    const result = await requestRefundAction({ orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({ ok: true, requestId: REQUEST_ID, autoApproved: true })
    expect(edges.enqueueJob).toHaveBeenCalledWith({
      type: "refund_submit",
      payload: { request_id: REQUEST_ID },
      dedupeKey: `refund_submit:${REQUEST_ID}`,
    })
  })

  it("refuses when nobody is signed in", async () => {
    edges.getAuthUser.mockResolvedValue(null)

    const result = await requestRefundAction({ orderId: ORDER_ID, reason: REASON })

    expect(result).toEqual({ ok: false, error: "Sign in to continue." })
  })
})
