import { beforeEach, describe, expect, it, vi } from "vitest"

// Contract: getOrderStatusAction's answer and the return page's use of it.
//
// The action is real, the state mapping and the words are real; only the
// database (get_order_by_reference) and the rate limiter are faked. The panel
// calls the action, then hands `status` and `number` to stateFromStatus, so this
// test drives exactly that path for every status the database can hold.

const edges = vi.hoisted(() => ({
  getOrderByReference: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}))

vi.mock("@/lib/commerce/db", () => ({
  getOrderByReference: edges.getOrderByReference,
}))

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")

  return {
    rateLimitKey: actual.rateLimitKey,
    clientIpFromHeaders: () => "203.0.113.9",
    rateLimit: edges.rateLimit,
  }
})

import {
  returnMessage,
  stateFromStatus,
  type CheckoutReturnState,
} from "@/lib/commerce/checkout-return"
import { getOrderStatusAction, type OrderStatusResult } from "@/lib/commerce/order-status"

const NUMBER = "AFV-2026-000001"

function order(status: string): {
  id: string
  number: string
  status: string
  totalKobo: number
  buyerEmail: string
} {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: NUMBER,
    status,
    totalKobo: 4_033_300,
    buyerEmail: "buyer@example.com",
  }
}

beforeEach(() => {
  edges.rateLimit.mockReset()
  edges.rateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: new Date() })
  edges.getOrderByReference.mockReset()
})

describe("the action's answer is what the page consumes", () => {
  it("turns a pending order into another poll", async () => {
    edges.getOrderByReference.mockResolvedValue(order("pending"))

    const answer = await getOrderStatusAction({ reference: "afv_abc123" })
    const state = stateFromStatus(answer.status, answer.number)

    expect(answer).toEqual({ status: "pending", number: NUMBER })
    expect(state).toEqual({ kind: "still_confirming" })
  })

  it("turns a paid order into the paid page with its number", async () => {
    edges.getOrderByReference.mockResolvedValue(order("paid"))

    const answer = await getOrderStatusAction({ reference: "afv_abc123" })

    expect(stateFromStatus(answer.status, answer.number)).toEqual({ kind: "paid", number: NUMBER })
  })

  it("reports a disputed order as paid, because the payment did happen", async () => {
    edges.getOrderByReference.mockResolvedValue(order("disputed"))

    const answer = await getOrderStatusAction({ reference: "afv_abc123" })

    expect(answer.status).toBe("paid")
    expect(stateFromStatus(answer.status, answer.number)).toEqual({ kind: "paid", number: NUMBER })
  })

  it("maps every database status to a state the page can render", async () => {
    const cases: { db: string; kind: CheckoutReturnState["kind"] }[] = [
      { db: "pending", kind: "still_confirming" },
      { db: "paid", kind: "paid" },
      { db: "failed", kind: "failed" },
      { db: "expired", kind: "expired" },
      { db: "refunded", kind: "refunded" },
      { db: "disputed", kind: "paid" },
      { db: "something_new", kind: "unknown" },
    ]

    for (const { db, kind } of cases) {
      edges.getOrderByReference.mockResolvedValue(order(db))

      const answer: OrderStatusResult = await getOrderStatusAction({ reference: "afv_abc123" })
      const state = stateFromStatus(answer.status, answer.number)
      const message = returnMessage(state)

      expect(state.kind, db).toBe(kind)
      expect(message.heading.length, db).toBeGreaterThan(0)
      expect(message.body.length, db).toBeGreaterThan(0)
      // "Still confirming" is the settled answer after the polling window, so it
      // is not shown as busy; only the initial polling state is.
      expect(message.busy, db).toBe(false)
    }
  })

  it("answers unknown for a reference it does not have, and the page says so", async () => {
    edges.getOrderByReference.mockResolvedValue(null)

    const answer = await getOrderStatusAction({ reference: "afv_not_a_real_reference" })

    expect(answer).toEqual({ status: "unknown" })
    expect(returnMessage(stateFromStatus(answer.status, answer.number)).heading.length).toBeGreaterThan(0)
  })

  it("carries nothing but the status and the number", async () => {
    edges.getOrderByReference.mockResolvedValue(order("paid"))

    const answer = await getOrderStatusAction({ reference: "afv_abc123" })

    // The buyer's email, the amount and the items are in the row and must not
    // reach the page.
    expect(Object.keys(answer).sort()).toEqual(["number", "status"])
  })

  it("answers unknown, without asking the database, when the limit is hit", async () => {
    edges.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() })

    const answer = await getOrderStatusAction({ reference: "afv_abc123" })

    expect(answer).toEqual({ status: "unknown" })
    expect(edges.getOrderByReference).not.toHaveBeenCalled()
  })
})
