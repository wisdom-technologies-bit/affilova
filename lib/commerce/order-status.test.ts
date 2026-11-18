import { beforeEach, describe, expect, it, vi } from "vitest"

// The order status the return page shows.
//
// The only interesting properties: it answers with one word and the order
// number, it never leaks buyer data, and it is limited.

const state = vi.hoisted(() => ({
  order: null as { id: string; number: string; status: string; totalKobo: number; buyerEmail: string } | null,
  throw: false,
  allowed: true,
}))

const limitCalls: { key: string; limit: number; windowSeconds: number; onError?: string }[] = []

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "197.210.54.33" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  clientIpFromHeaders: () => "197.210.54.33",
  rateLimitKey: (parts: readonly string[]) => parts.join("|"),
  rateLimit: async (options: { key: string; limit: number; windowSeconds: number; onError?: string }) => {
    limitCalls.push(options)

    return { allowed: state.allowed, remaining: 0, resetAt: new Date("2026-11-18T20:01:00.000Z") }
  },
}))

vi.mock("@/lib/commerce/db", () => ({
  getOrderByReference: async () => {
    if (state.throw) {
      throw new Error("commerce_rpc_failed:get_order_by_reference")
    }

    return state.order
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getOrderStatusAction } from "./order-status"

const ORDER = {
  id: "11111111-1111-1111-1111-111111111111",
  number: "AFV-2026-000001",
  status: "paid",
  totalKobo: 40333,
  buyerEmail: "buyer@example.com",
}

beforeEach(() => {
  state.order = ORDER
  state.throw = false
  state.allowed = true
  limitCalls.length = 0
})

describe("getOrderStatusAction", () => {
  it("returns the status and the number for a known order", async () => {
    await expect(getOrderStatusAction({ reference: "afv_abc123" })).resolves.toEqual({
      status: "paid",
      number: "AFV-2026-000001",
    })
  })

  it("returns no buyer data", async () => {
    const result = await getOrderStatusAction({ reference: "afv_abc123" })

    expect(Object.keys(result).sort()).toEqual(["number", "status"])
    expect(JSON.stringify(result)).not.toContain("buyer@example.com")
    expect(JSON.stringify(result)).not.toContain("40333")
  })

  it("says unknown for a reference nobody knows", async () => {
    state.order = null

    await expect(getOrderStatusAction({ reference: "afv_nope" })).resolves.toEqual({ status: "unknown" })
  })

  it("says unknown when the database fails", async () => {
    state.throw = true

    await expect(getOrderStatusAction({ reference: "afv_abc123" })).resolves.toEqual({ status: "unknown" })
  })

  it("says unknown when the limit is spent", async () => {
    state.allowed = false

    await expect(getOrderStatusAction({ reference: "afv_abc123" })).resolves.toEqual({ status: "unknown" })
  })

  it("refuses an empty reference without counting it", async () => {
    await expect(getOrderStatusAction({ reference: "   " })).resolves.toEqual({ status: "unknown" })
    expect(limitCalls).toHaveLength(0)
  })

  it("counts sixty asks a minute per address, denying on failure", async () => {
    await getOrderStatusAction({ reference: "afv_abc123" })

    expect(limitCalls).toHaveLength(1)
    expect(limitCalls[0]).toMatchObject({ limit: 60, windowSeconds: 60, onError: "deny" })
    expect(limitCalls[0]?.key).toContain("order-status")
  })

  it("reports a disputed order as paid, because the payment did happen", async () => {
    state.order = { ...ORDER, status: "disputed" }

    await expect(getOrderStatusAction({ reference: "afv_abc123" })).resolves.toEqual({
      status: "paid",
      number: "AFV-2026-000001",
    })
  })

  it("maps the other statuses", async () => {
    for (const [stored, expected] of [
      ["pending", "pending"],
      ["failed", "failed"],
      ["expired", "expired"],
      ["refunded", "refunded"],
      ["something-new", "unknown"],
    ] as const) {
      state.order = { ...ORDER, status: stored }

      await expect(getOrderStatusAction({ reference: "afv_abc123" })).resolves.toMatchObject({ status: expected })
    }
  })
})
