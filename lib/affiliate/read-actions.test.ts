import { beforeEach, describe, expect, it, vi } from "vitest"

// The affiliate read actions.
//
// Same four questions as the write actions: who is calling, whether they may,
// whether the input is well formed, and whether the allowance is left. Two more
// are specific to reads: the actor id always comes from the session and never
// from the input, and a database error never reaches the screen as database
// text.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  allowed: true,
  limitKeys: [] as string[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcData: null as unknown,
  rpcError: null as { message: string } | null,
  row: null as unknown,
  rowError: null as { message: string } | null,
  rows: [] as unknown[],
  eqCalls: [] as { column: string; value: unknown }[],
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (options: { key: string }) => {
    state.limitKeys.push(options.key)

    return { allowed: state.allowed, remaining: 1, resetAt: new Date("2026-11-20T12:00:00.000Z") }
  },
  rateLimitKey: (parts: readonly string[]) => `key:${parts.join("|")}`,
}))

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

class FakeQuery {
  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    state.eqCalls.push({ column, value })

    return this
  }

  order(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve({ data: state.rows, error: state.rowError })
  }

  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve({ data: state.row, error: state.rowError })
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => new FakeQuery(),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })

      return { data: state.rpcData, error: state.rpcError }
    },
  }),
}))

import {
  getAffiliateRequestsAction,
  getBreakdownAction,
  getCategoriesAction,
  getCommissionsAction,
  getCommissionHoldDays,
  getDailySeriesAction,
  getInvitesAction,
  getLinkQrAction,
  getLinkStatsAction,
  getLiveProductTitle,
  getMarketplaceAction,
  getOverviewAction,
  getVendorAffiliateStatsAction,
  revokeInviteAction,
} from "./read-actions"
import { affiliateErrorMessage } from "./errors"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

const OVERVIEW = {
  clicks: 12,
  unique_clicks: 9,
  orders: 3,
  revenue_kobo: 450000,
  commission_kobo: 45000,
  conversion_bps: 3333,
  epc_kobo_per_100_clicks: 375000,
  balance: { pending_kobo: 1000, available_kobo: 44000, total_kobo: 45000, negative: false },
}

beforeEach(() => {
  vi.clearAllMocks()

  state.user = { id: USER_ID, email: "ada@example.com" }
  state.roles = ["affiliate"]
  state.allowed = true
  state.limitKeys = []
  state.rpcCalls = []
  state.rpcData = null
  state.rpcError = null
  state.row = null
  state.rowError = null
  state.rows = []
  state.eqCalls = []

  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
    NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
    NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
    NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_COOKIE_DOMAIN: "",
  })) {
    process.env[key] = value
  }
})

describe("who is calling", () => {
  it("refuses a signed-out caller before reading anything", async () => {
    state.user = null

    const result = await getMarketplaceAction({})

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("not_authenticated") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses an affiliate action for a caller without the role", async () => {
    state.roles = ["customer"]

    const result = await getOverviewAction({
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-02T00:00:00.000Z",
    })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("forbidden") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a merchant action for an affiliate", async () => {
    const result = await getAffiliateRequestsAction({})

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("forbidden") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses once the allowance is gone", async () => {
    state.allowed = false

    const result = await getMarketplaceAction({})

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("rate_limited") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("shares one allowance per user across the read actions", async () => {
    state.rpcData = { items: [], next_cursor: null }

    await getMarketplaceAction({})
    await getCommissionsAction({})

    expect(state.limitKeys).toEqual([`key:affiliate-read|${USER_ID}`, `key:affiliate-read|${USER_ID}`])
  })
})

describe("the actor is always the session user", () => {
  it("refuses an input that tries to name the affiliate", async () => {
    // The schemas are strict, so there is nowhere to put another affiliate's
    // id: the request is refused rather than quietly ignored.
    const result = await getMarketplaceAction({ p_affiliate: OTHER_ID, affiliateId: OTHER_ID })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("sends the session user to every affiliate function", async () => {
    state.rpcData = OVERVIEW

    await getOverviewAction({ from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" })

    expect(state.rpcCalls[0]).toEqual({
      name: "affiliate_overview",
      args: {
        p_affiliate: USER_ID,
        p_from: "2026-11-01T00:00:00.000Z",
        p_to: "2026-11-02T00:00:00.000Z",
      },
    })
  })

  it("sends the session user as the vendor", async () => {
    state.roles = ["vendor"]
    state.rpcData = { items: [], next_cursor: null }

    await getVendorAffiliateStatsAction({ from: "2026-11-01", to: "2026-11-02" })

    expect(state.rpcCalls[0].args.p_vendor).toBe(USER_ID)
  })

  it("sends the session user as the revoking actor", async () => {
    state.roles = ["vendor"]

    const result = await revokeInviteAction({ inviteId: "33333333-3333-4333-8333-333333333333" })

    expect(result).toEqual({ ok: true, data: { revoked: true } })
    expect(state.rpcCalls[0]).toEqual({
      name: "revoke_affiliate_invite",
      args: { p_actor: USER_ID, p_invite: "33333333-3333-4333-8333-333333333333" },
    })
  })
})

describe("input validation", () => {
  it("refuses an unknown sort before calling the database", async () => {
    const result = await getMarketplaceAction({ sort: "cheapest" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a limit above the cap the database enforces", async () => {
    const result = await getMarketplaceAction({ limit: 500 })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a search longer than the column allows", async () => {
    const result = await getMarketplaceAction({ q: "a".repeat(81) })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
  })

  it("refuses an unknown breakdown dimension", async () => {
    const result = await getBreakdownAction({
      from: "2026-11-01",
      to: "2026-11-02",
      dimension: "country",
    })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses an unknown status", async () => {
    state.roles = ["vendor"]

    const result = await getAffiliateRequestsAction({ status: "maybe" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
  })

  it("refuses a day that is not a calendar date", async () => {
    const result = await getDailySeriesAction({ from: "2026-11-01T00:00:00Z", to: "2026-11-02" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
  })

  it("refuses a cursor that does not decode", async () => {
    const result = await getLinkStatsAction({
      from: "2026-11-01",
      to: "2026-11-02",
      cursor: "not-a-cursor",
    })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_cursor") })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a link id that is not a uuid", async () => {
    const result = await getLinkQrAction({ linkId: "abc" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_input") })
  })
})

describe("reading the marketplace", () => {
  it("maps a page and keeps the cursor opaque", async () => {
    state.rpcData = {
      items: [
        {
          product_id: "44444444-4444-4444-8444-444444444444",
          slug: "calm-notebook",
          title: "Calm notebook",
          short_description: "A notebook.",
          cover_public_id: "products/calm",
          vendor_name: "Ada Press",
          category_slug: "books",
          price_kobo: 250000,
          commission_bps: 2500,
          affiliate_approval: "approval",
          my_access: "pending",
          my_link_count: 2,
        },
      ],
      next_cursor: { at: "2026-11-19T10:00:00.000Z", id: "44444444-4444-4444-8444-444444444444" },
    }

    const result = await getMarketplaceAction({ q: "calm", sort: "commission", limit: 10 })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.items[0]).toEqual({
      productId: "44444444-4444-4444-8444-444444444444",
      slug: "calm-notebook",
      title: "Calm notebook",
      shortDescription: "A notebook.",
      coverPublicId: "products/calm",
      vendorName: "Ada Press",
      categorySlug: "books",
      priceKobo: 250000,
      commissionBps: 2500,
      affiliateApproval: "approval",
      myAccess: "pending",
      myLinkCount: 2,
    })

    const cursor = result.ok ? result.data.nextCursor : null

    expect(typeof cursor).toBe("string")
    expect(cursor).not.toContain("{")

    // The cursor comes back to the database as the object it left as.
    state.rpcData = { items: [], next_cursor: null }
    await getMarketplaceAction({ cursor: cursor ?? undefined })

    expect(state.rpcCalls[1].args.p_cursor).toEqual({
      at: "2026-11-19T10:00:00.000Z",
      id: "44444444-4444-4444-8444-444444444444",
    })
  })

  it("turns unknown stored values into honest defaults", async () => {
    state.rpcData = {
      items: [{ product_id: "p1", my_access: "surprise", affiliate_approval: "surprise" }],
      next_cursor: null,
    }

    const result = await getMarketplaceAction({})

    expect(result.ok && result.data.items[0].myAccess).toBe("none")
    expect(result.ok && result.data.items[0].affiliateApproval).toBe("open")
  })

  it("drops a row with no product id", async () => {
    state.rpcData = { items: [{ title: "No id" }], next_cursor: null }

    const result = await getMarketplaceAction({})

    expect(result.ok && result.data.items).toEqual([])
  })
})

describe("reading the numbers", () => {
  it("maps the overview and its balance", async () => {
    state.rpcData = OVERVIEW

    const result = await getOverviewAction({
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-20T23:59:59.999Z",
    })

    expect(result.ok && result.data).toEqual({
      clicks: 12,
      uniqueClicks: 9,
      orders: 3,
      revenueKobo: 450000,
      commissionKobo: 45000,
      conversionBps: 3333,
      epcKoboPer100Clicks: 375000,
      balance: { pendingKobo: 1000, availableKobo: 44000, totalKobo: 45000, negative: false },
    })
  })

  it("maps the daily series, zeros included", async () => {
    state.rpcData = [
      { day: "2026-11-18", clicks: 0, unique_clicks: 0, orders: 0, commission_kobo: 0 },
      { day: "2026-11-19", clicks: "4", unique_clicks: 3, orders: 1, commission_kobo: "1500" },
    ]

    const result = await getDailySeriesAction({ from: "2026-11-18", to: "2026-11-19" })

    expect(result.ok && result.data).toEqual([
      { day: "2026-11-18", clicks: 0, uniqueClicks: 0, orders: 0, commissionKobo: 0 },
      { day: "2026-11-19", clicks: 4, uniqueClicks: 3, orders: 1, commissionKobo: 1500 },
    ])
  })

  it("maps the link stats page", async () => {
    state.rpcData = {
      items: [
        {
          link_id: "55555555-5555-4555-8555-555555555555",
          code: "abc123",
          alias: null,
          label: "Story",
          product_title: "Calm notebook",
          status: "active",
          clicks: 5,
          unique_clicks: 4,
          orders: 1,
          commission_kobo: 1500,
        },
      ],
      next_cursor: null,
    }

    const result = await getLinkStatsAction({ from: "2026-11-01", to: "2026-11-20" })

    expect(result.ok && result.data.items[0]).toEqual({
      linkId: "55555555-5555-4555-8555-555555555555",
      code: "abc123",
      alias: null,
      label: "Story",
      productTitle: "Calm notebook",
      status: "active",
      clicks: 5,
      uniqueClicks: 4,
      orders: 1,
      commissionKobo: 1500,
    })
  })

  it("passes the dimension through to the breakdown", async () => {
    state.rpcData = [{ label: "instagram", clicks: 5, unique_clicks: 4, orders: 1, commission_kobo: 1500 }]

    const result = await getBreakdownAction({
      from: "2026-11-01",
      to: "2026-11-20",
      dimension: "sub1",
    })

    expect(state.rpcCalls[0].args.p_dim).toBe("sub1")
    expect(result.ok && result.data.rows[0].label).toBe("instagram")
  })

  it("maps a commission row with no hold", async () => {
    state.rpcData = {
      items: [
        {
          order_number: "AF-1001",
          product_title: "Calm notebook",
          commission_kobo: 1500,
          status: "paid",
          paid_at: "2026-11-18T10:00:00.000Z",
          available_at: null,
        },
      ],
      next_cursor: null,
    }

    const result = await getCommissionsAction({})

    expect(result.ok && result.data.items[0]).toEqual({
      orderNumber: "AF-1001",
      productTitle: "Calm notebook",
      commissionKobo: 1500,
      status: "paid",
      paidAt: "2026-11-18T10:00:00.000Z",
      availableAt: null,
    })
  })
})

describe("the merchant reads", () => {
  it("maps a request row", async () => {
    state.roles = ["vendor"]
    state.rpcData = {
      items: [
        {
          affiliate_id: "66666666-6666-4666-8666-666666666666",
          username: "ada",
          product_id: "77777777-7777-4777-8777-777777777777",
          product_title: "Calm notebook",
          status: "pending",
          note: "I write about notebooks.",
          requested_at: "2026-11-19T09:00:00.000Z",
        },
      ],
      next_cursor: null,
    }

    const result = await getAffiliateRequestsAction({ status: "pending" })

    expect(state.rpcCalls[0].args).toEqual({
      p_vendor: USER_ID,
      p_status: "pending",
      p_product: null,
      p_limit: 20,
      p_cursor: null,
    })
    expect(result.ok && result.data.items[0].username).toBe("ada")
  })

  it("maps an invite row and never invents a token", async () => {
    state.roles = ["vendor"]
    state.rpcData = {
      items: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          product_title: "Calm notebook",
          max_uses: 5,
          uses: 1,
          expires_at: "2026-12-01T00:00:00.000Z",
          revoked_at: null,
          created_at: "2026-11-19T09:00:00.000Z",
          token: "should-not-be-read",
        },
      ],
    }

    const result = await getInvitesAction()

    expect(result.ok && result.data[0]).toEqual({
      id: "88888888-8888-4888-8888-888888888888",
      productTitle: "Calm notebook",
      maxUses: 5,
      uses: 1,
      expiresAt: "2026-12-01T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-11-19T09:00:00.000Z",
    })
  })

  it("maps a performance row", async () => {
    state.roles = ["vendor"]
    state.rpcData = {
      items: [
        {
          affiliate_id: "66666666-6666-4666-8666-666666666666",
          username: "ada",
          clicks: 10,
          unique_clicks: 8,
          orders: 2,
          revenue_kobo: 500000,
          commission_kobo: 50000,
        },
      ],
      next_cursor: null,
    }

    const result = await getVendorAffiliateStatsAction({ from: "2026-11-01", to: "2026-11-20" })

    expect(result.ok && result.data.items[0].revenueKobo).toBe(500000)
  })
})

describe("the QR action", () => {
  it("returns a safe svg for a link the caller owns", async () => {
    state.row = { code: "abc123", alias: null }

    const result = await getLinkQrAction({ linkId: "55555555-5555-4555-8555-555555555555" })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.svg).toContain("<svg")
    expect(result.ok && result.data.svg).not.toContain("<script")
    expect(state.eqCalls).toEqual([
      { column: "id", value: "55555555-5555-4555-8555-555555555555" },
      { column: "affiliate_id", value: USER_ID },
    ])
  })

  it("prefers the alias in the link it encodes", async () => {
    state.row = { code: "abc123", alias: "my-story" }

    const result = await getLinkQrAction({ linkId: "55555555-5555-4555-8555-555555555555" })

    expect(result.ok).toBe(true)
    expect(state.eqCalls[1]).toEqual({ column: "affiliate_id", value: USER_ID })
  })

  it("answers not found for a link that is not the caller's", async () => {
    state.row = null

    const result = await getLinkQrAction({ linkId: "55555555-5555-4555-8555-555555555555" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("not_found") })
  })
})

describe("small safe reads", () => {
  it("reads the hold from settings", async () => {
    state.row = { value: 14 }

    expect(await getCommissionHoldDays()).toBe(14)
  })

  it("falls back when settings cannot be read", async () => {
    state.row = null

    expect(await getCommissionHoldDays()).toBe(7)
  })

  it("refuses a hold that is not a sensible number", async () => {
    state.row = { value: "fourteen" }

    expect(await getCommissionHoldDays()).toBe(7)
  })

  it("returns the title of a live product only", async () => {
    state.row = { title: "Calm notebook", status: "live" }
    expect(await getLiveProductTitle("44444444-4444-4444-8444-444444444444")).toBe("Calm notebook")

    state.row = { title: "Calm notebook", status: "draft" }
    expect(await getLiveProductTitle("44444444-4444-4444-8444-444444444444")).toBeNull()
  })

  it("refuses a product id that is not a uuid before querying", async () => {
    expect(await getLiveProductTitle("not-a-uuid")).toBeNull()
    expect(state.eqCalls).toHaveLength(0)
  })
})

describe("safe errors", () => {
  it("never returns the database's own text", async () => {
    state.rpcError = {
      message: 'relation "public.affiliate_clicks" does not exist',
    }

    const result = await getMarketplaceAction({})

    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).not.toContain("affiliate_clicks")
    expect(result.ok ? "" : result.error).not.toContain("relation")
  })

  it("returns the sentence for a code the database raised", async () => {
    state.rpcError = { message: "invalid_cursor" }

    const result = await getLinkStatsAction({ from: "2026-11-01", to: "2026-11-02" })

    expect(result).toEqual({ ok: false, error: affiliateErrorMessage("invalid_cursor") })
  })
})
