import { describe, expect, it, vi } from "vitest"

import type { AccessTokenResult } from "./access-token"
import {
  GUEST_REFUND_IP_LIMIT,
  GUEST_REFUND_ORDER_LIMIT,
  GUEST_REFUND_WINDOW_SECONDS,
  REFUND_LINK_INVALID,
  REFUND_LINK_WRONG_ORDER,
  REFUND_ORDER_UNAVAILABLE,
  requestGuestRefund,
  type GuestRefundDeps,
} from "./guest-refund"
import { rateLimitKey } from "@/lib/rate-limit"

const ORDER_ID = "11111111-1111-4111-8111-111111111111"
const REASON = "The files do not open on my machine at all."

function verified(orderId: string = ORDER_ID): AccessTokenResult {
  return { ok: true, claims: { orderId, emailHash: "a".repeat(32), expiresAt: 4_000_000_000 } }
}

interface Fakes {
  deps: GuestRefundDeps
  calls: {
    limits: { key: string; limit: number; windowSeconds: number; onError: string }[]
    refunds: { orderId: string; email: string; reason: string }[]
    enqueued: string[]
  }
}

function makeDeps(overrides: Partial<GuestRefundDeps> = {}): Fakes {
  const calls: Fakes["calls"] = { limits: [], refunds: [], enqueued: [] }

  const deps: GuestRefundDeps = {
    verifyToken: () => verified(),
    rateLimit: async (options) => {
      calls.limits.push({ ...options })

      return { allowed: true }
    },
    rateLimitKey,
    readBuyerEmail: async () => "buyer@example.com",
    requestRefund: async (input) => {
      calls.refunds.push({ ...input })

      return { requestId: "request-1", autoApproved: true }
    },
    enqueueSubmit: async (requestId) => {
      calls.enqueued.push(requestId)
    },
    logError: vi.fn(),
    ...overrides,
  }

  return { deps, calls }
}

function input(overrides: Partial<{ token: string; orderId: string; reason: string; ip: string }> = {}) {
  return { token: "token-1", orderId: ORDER_ID, reason: REASON, ip: "203.0.113.9", ...overrides }
}

describe("the link is the credential", () => {
  it("refuses a link that does not verify, before any lookup", async () => {
    const { deps, calls } = makeDeps({
      verifyToken: () => ({ ok: false, reason: "invalid_signature" }),
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({ ok: false, error: REFUND_LINK_INVALID })
    expect(calls.limits).toHaveLength(0)
    expect(calls.refunds).toHaveLength(0)
  })

  it("refuses an order id the link does not name", async () => {
    const { deps, calls } = makeDeps()

    const result = await requestGuestRefund(
      input({ orderId: "22222222-2222-4222-8222-222222222222" }),
      deps,
    )

    expect(result).toEqual({ ok: false, error: REFUND_LINK_WRONG_ORDER })
    expect(calls.limits).toHaveLength(0)
    expect(calls.refunds).toHaveLength(0)
  })

  it("refuses an empty order id", async () => {
    const { deps } = makeDeps()

    expect(await requestGuestRefund(input({ orderId: "  " }), deps)).toEqual({
      ok: false,
      error: REFUND_LINK_WRONG_ORDER,
    })
  })

  it("accepts the order id in another case, because ids are compared not shown", async () => {
    const { deps, calls } = makeDeps()

    const result = await requestGuestRefund(input({ orderId: ORDER_ID.toUpperCase() }), deps)

    expect(result).toEqual({ ok: true, autoApproved: true })
    expect(calls.refunds).toHaveLength(1)
  })
})

describe("the reason", () => {
  it("refuses one that is too short", async () => {
    const { deps, calls } = makeDeps()

    expect(await requestGuestRefund(input({ reason: "broken" }), deps)).toEqual({
      ok: false,
      error: "Give a reason of at least 10 characters.",
    })
    expect(calls.refunds).toHaveLength(0)
  })

  it("refuses one that is too long", async () => {
    const { deps } = makeDeps()

    expect(await requestGuestRefund(input({ reason: "x".repeat(1001) }), deps)).toEqual({
      ok: false,
      error: "Give a reason of at least 10 characters.",
    })
  })

  it("sends the trimmed reason", async () => {
    const { deps, calls } = makeDeps()

    await requestGuestRefund(input({ reason: `   ${REASON}   ` }), deps)

    expect(calls.refunds[0]?.reason).toBe(REASON)
  })
})

describe("the limits", () => {
  it("counts five an hour per address and three an hour per order", async () => {
    const { deps, calls } = makeDeps()

    await requestGuestRefund(input(), deps)

    expect(calls.limits).toHaveLength(2)
    expect(calls.limits[0]?.limit).toBe(GUEST_REFUND_IP_LIMIT)
    expect(calls.limits[1]?.limit).toBe(GUEST_REFUND_ORDER_LIMIT)
    expect(calls.limits[0]?.windowSeconds).toBe(GUEST_REFUND_WINDOW_SECONDS)
    // A counter that cannot be read refuses: the limit is the guard.
    expect(calls.limits[0]?.onError).toBe("deny")
    expect(calls.limits[1]?.onError).toBe("deny")
    // The keys are hashes, and the address and the order hash differently.
    expect(calls.limits[0]?.key).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.limits[1]?.key).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.limits[0]?.key).not.toBe(calls.limits[1]?.key)
  })

  it("refuses when the address is over its limit, without counting the order", async () => {
    const { deps, calls } = makeDeps({
      rateLimit: async (options) => {
        calls.limits.push({ ...options })

        return { allowed: calls.limits.length !== 1 }
      },
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    })
    expect(calls.limits).toHaveLength(1)
    expect(calls.refunds).toHaveLength(0)
  })

  it("refuses when the order is over its limit", async () => {
    const { deps, calls } = makeDeps({
      rateLimit: async (options) => {
        calls.limits.push({ ...options })

        return { allowed: calls.limits.length !== 2 }
      },
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    })
    expect(calls.refunds).toHaveLength(0)
  })
})

describe("the database decides the rest", () => {
  it("asks with the address the order was bought with, read from the database", async () => {
    const { deps, calls } = makeDeps()

    await requestGuestRefund(input(), deps)

    expect(calls.refunds).toEqual([{ orderId: ORDER_ID, email: "buyer@example.com", reason: REASON }])
  })

  it("refuses an order it cannot read an address for", async () => {
    const { deps, calls } = makeDeps({ readBuyerEmail: async () => null })

    expect(await requestGuestRefund(input(), deps)).toEqual({
      ok: false,
      error: REFUND_ORDER_UNAVAILABLE,
    })
    expect(calls.refunds).toHaveLength(0)
  })

  it("answers a safe sentence when the order read fails", async () => {
    const { deps } = makeDeps({
      readBuyerEmail: async () => {
        throw new Error("commerce_rpc_failed:read_order_buyer_email")
      },
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    })
  })

  it("looks the database's code up and never shows it", async () => {
    const { deps } = makeDeps({
      requestRefund: async () => {
        throw new Error("forbidden")
      },
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })

  it("queues the submission only when the request was approved", async () => {
    const approved = makeDeps()
    await requestGuestRefund(input(), approved.deps)
    expect(approved.calls.enqueued).toEqual(["request-1"])

    const pending = makeDeps({
      requestRefund: async () => ({ requestId: "request-2", autoApproved: false }),
    })
    expect(await requestGuestRefund(input(), pending.deps)).toEqual({ ok: true, autoApproved: false })
    expect(pending.calls.enqueued).toEqual([])
  })

  it("keeps the approval when the queue is unavailable", async () => {
    const { deps } = makeDeps({
      enqueueSubmit: async () => {
        throw new Error("queue_unavailable")
      },
    })

    expect(await requestGuestRefund(input(), deps)).toEqual({ ok: true, autoApproved: true })
  })
})
