import { beforeEach, describe, expect, it, vi } from "vitest"

// The merchant read actions.
//
// A vendor id is never an input: every call uses the authenticated user's id, so
// there is no parameter in which to name somebody else's store. These tests hold
// that line, along with the usual four questions and the safe-error rule.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  allowed: true,
  budget: [] as { key: string; limit: number; windowSeconds: number }[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  replies: new Map<string, { data: unknown; error: { message: string } | null }>(),
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (options: { key: string; limit: number; windowSeconds: number }) => {
    state.budget.push(options)

    return { allowed: state.allowed, remaining: 1, resetAt: new Date("2026-11-22T12:00:00.000Z") }
  },
  rateLimitKey: (parts: readonly string[]) => `key:${parts.join("|")}`,
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args })
      const reply = state.replies.get(name)

      return { data: reply?.data ?? null, error: reply?.error ?? null }
    },
  }),
}))

import { MERCHANT_GENERIC_ERROR } from "./errors"
import {
  getVendorDailySeriesAction,
  getVendorOverviewAction,
  getVendorRefundRequestsAction,
  getVendorSalesAction,
  getVendorTopProductsAction,
} from "./actions"

const VENDOR_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

const OVERVIEW = {
  orders: 3,
  gross_kobo: 1300000,
  vendor_net_kobo: 1130250,
  platform_fee_kobo: 130000,
  affiliate_commission_kobo: 30000,
  affiliate_orders: 1,
  refunds_count: 1,
  refunds_kobo: 500000,
  refund_rate_bps: 3846,
  pending_kobo: 1000,
  available_kobo: 44000,
}

const FROM = "2026-11-17T00:00:00+01:00"
const TO = "2026-11-20T23:59:59+01:00"

function reply(name: string, data: unknown, error: { message: string } | null = null): void {
  state.replies.set(name, { data, error })
}

beforeEach(() => {
  vi.clearAllMocks()

  state.user = { id: VENDOR_ID, email: "vendor@example.com" }
  state.roles = ["vendor"]
  state.allowed = true
  state.budget = []
  state.calls = []
  state.replies = new Map()

  reply("vendor_overview", OVERVIEW)
  reply("vendor_daily_series", [
    { day: "2026-11-17", orders: 1, gross_kobo: 500000, vendor_net_kobo: 446250 },
    { day: "2026-11-18", orders: 0, gross_kobo: 0, vendor_net_kobo: 0 },
  ])
  reply("vendor_top_products", [
    { product_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Account Product A", orders: 5, gross_kobo: 2500000, refunds: 1 },
  ])
  reply("vendor_sales_list", {
    items: [
      {
        order_number: "AFV-2026-000008",
        product_title: "Account Product A",
        status: "paid",
        paid_at: "2026-11-21T10:00:00Z",
        gross_kobo: 500000,
        vendor_net_kobo: 446250,
        via_affiliate: false,
      },
    ],
    next_cursor: null,
  })
  reply("vendor_refund_requests", {
    items: [
      {
        request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        order_number: "AFV-2026-000002",
        product_title: "Account Product A",
        reason: "I bought this by mistake, please refund it.",
        status: "requested",
        auto_approved: false,
        requested_at: "2026-11-21T12:00:00Z",
        decided_at: null,
        amount_kobo: 500000,
      },
    ],
    next_cursor: null,
  })
})

describe("who is calling", () => {
  it("refuses a signed-out visitor", async () => {
    state.user = null

    expect(await getVendorOverviewAction({ from: FROM, to: TO })).toEqual({
      ok: false,
      error: "Sign in to continue.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a customer with no vendor role", async () => {
    state.roles = ["customer"]

    expect(await getVendorSalesAction({})).toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    expect(state.calls).toHaveLength(0)
  })
})

describe("getVendorOverviewAction", () => {
  it("reads the vendor's own numbers for the range", async () => {
    const result = await getVendorOverviewAction({ from: FROM, to: TO })

    expect(state.calls[0]).toEqual({
      name: "vendor_overview",
      args: { p_vendor: VENDOR_ID, p_from: FROM, p_to: TO },
    })
    expect(result.ok && result.data).toEqual({
      orders: 3,
      grossKobo: 1300000,
      vendorNetKobo: 1130250,
      platformFeeKobo: 130000,
      affiliateCommissionKobo: 30000,
      affiliateOrders: 1,
      refundsCount: 1,
      refundsKobo: 500000,
      refundRateBps: 3846,
      pendingKobo: 1000,
      availableKobo: 44000,
    })
  })

  it("ignores a vendor id in the input", async () => {
    expect(await getVendorOverviewAction({ from: FROM, to: TO, p_vendor: OTHER_ID })).toEqual({
      ok: false,
      error: "Check the form and try again.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a date that is not a date", async () => {
    expect(await getVendorOverviewAction({ from: "not-a-date-at-all-really", to: TO })).toEqual({
      ok: false,
      error: "Choose a date range of 366 days or fewer, starting before it ends.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("stops at the allowance", async () => {
    state.allowed = false

    expect((await getVendorOverviewAction({ from: FROM, to: TO })).ok).toBe(false)
    expect(state.budget[0]).toMatchObject({ limit: 120, windowSeconds: 60 })
  })

  it("never passes database text to the screen", async () => {
    reply("vendor_overview", null, { message: 'relation "public.orders" does not exist' })

    expect(await getVendorOverviewAction({ from: FROM, to: TO })).toEqual({
      ok: false,
      error: MERCHANT_GENERIC_ERROR,
    })
  })
})

describe("series and top products", () => {
  it("maps every day, including a zero day", async () => {
    const result = await getVendorDailySeriesAction({ from: "2026-11-17", to: "2026-11-18" })

    expect(result).toEqual({
      ok: true,
      data: [
        { day: "2026-11-17", orders: 1, grossKobo: 500000, vendorNetKobo: 446250 },
        { day: "2026-11-18", orders: 0, grossKobo: 0, vendorNetKobo: 0 },
      ],
    })
  })

  it("maps the top products", async () => {
    const result = await getVendorTopProductsAction({ from: "2026-11-17", to: "2026-11-21" })

    expect(result.ok && result.data[0]).toEqual({
      productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Account Product A",
      orders: 5,
      grossKobo: 2500000,
      refunds: 1,
    })
  })

  it("refuses a day that is not a day", async () => {
    expect((await getVendorDailySeriesAction({ from: "17-11-2026", to: "2026-11-18" })).ok).toBe(
      false,
    )
  })

  it("answers an empty range with no products", async () => {
    reply("vendor_top_products", [])

    expect(await getVendorTopProductsAction({ from: "2026-09-01", to: "2026-09-02" })).toEqual({
      ok: true,
      data: [],
    })
  })
})

describe("getVendorSalesAction", () => {
  it("lists the vendor's sales with no status filter", async () => {
    const result = await getVendorSalesAction({ limit: 20 })

    expect(state.calls[0].args).toEqual({
      p_vendor: VENDOR_ID,
      p_status: null,
      p_limit: 20,
      p_cursor: null,
    })
    expect(result.ok && result.data.items[0]).toEqual({
      orderNumber: "AFV-2026-000008",
      productTitle: "Account Product A",
      status: "paid",
      paidAt: "2026-11-21T10:00:00Z",
      grossKobo: 500000,
      vendorNetKobo: 446250,
      viaAffiliate: false,
    })
  })

  it("passes a known status through", async () => {
    await getVendorSalesAction({ status: "refunded" })

    expect(state.calls[0].args).toMatchObject({ p_status: "refunded" })
  })

  it("refuses a status that is not one of the tabs", async () => {
    expect(await getVendorSalesAction({ status: "cancelled" })).toEqual({
      ok: false,
      error: "Choose one of the available statuses.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a bad cursor without reading", async () => {
    expect((await getVendorSalesAction({ cursor: "%%%" })).ok).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it("carries no buyer identity in the answer", async () => {
    const result = await getVendorSalesAction({})

    expect(JSON.stringify(result)).not.toContain("@example.com")
    expect(JSON.stringify(result)).not.toContain("buyer")
  })
})

describe("getVendorRefundRequestsAction", () => {
  it("lists the requests on the vendor's orders", async () => {
    const result = await getVendorRefundRequestsAction({ status: "requested" })

    expect(state.calls[0].args).toEqual({
      p_vendor: VENDOR_ID,
      p_status: "requested",
      p_limit: 20,
      p_cursor: null,
    })
    expect(result.ok && result.data.items[0]).toEqual({
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      orderNumber: "AFV-2026-000002",
      productTitle: "Account Product A",
      reason: "I bought this by mistake, please refund it.",
      status: "requested",
      autoApproved: false,
      requestedAt: "2026-11-21T12:00:00Z",
      decidedAt: null,
      amountKobo: 500000,
    })
  })

  it("refuses a status the database does not know", async () => {
    expect((await getVendorRefundRequestsAction({ status: "pending" })).ok).toBe(false)
  })

  it("answers an empty list honestly", async () => {
    reply("vendor_refund_requests", { items: [], next_cursor: null })

    expect(await getVendorRefundRequestsAction({})).toEqual({
      ok: true,
      data: { items: [], nextCursor: null },
    })
  })
})
