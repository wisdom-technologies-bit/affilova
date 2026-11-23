import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

// The account actions.
//
// What is checked: who is calling, whether they may, whether the input is well
// formed, whether the allowance is left, that the actor id always comes from the
// session and never from the input, that a database error never reaches the
// screen as database text, and that a download URL is never logged.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  allowed: true,
  budget: [] as { key: string; limit: number; windowSeconds: number }[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  replies: new Map<string, { data: unknown; error: { message: string } | null }>(),
  presign: { url: "https://files.example.com/signed?token=secret", throws: false },
  presignCalls: [] as { key: string; filename: string; expiresInSeconds?: number }[],
  refund: null as unknown,
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
  clientIpFromHeaders: () => "203.0.113.9",
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
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

vi.mock("@/lib/storage/r2", () => ({
  getR2Storage: () => ({
    presignGetUrl: async (input: { key: string; filename: string; expiresInSeconds?: number }) => {
      state.presignCalls.push(input)

      if (state.presign.throws) {
        throw new Error("storage is down")
      }

      return state.presign.url
    },
  }),
}))

vi.mock("@/lib/commerce/actions", () => ({
  requestRefundAction: async () => state.refund ?? { ok: false, error: "no mock" },
}))

import { DOWNLOAD_MESSAGES } from "@/lib/commerce/download"
import { logger } from "@/lib/logger"

import { downloadMyFileAction, getMyOrderAction, getMyOrdersAction, requestMyRefundAction } from "./actions"
import { ACCOUNT_GENERIC_ERROR } from "./errors"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"
const ORDER_ID = "33333333-3333-4333-8333-333333333333"
const ENTITLEMENT_ID = "44444444-4444-4444-8444-444444444444"
const OTHER_ENTITLEMENT = "55555555-5555-4555-8555-555555555555"

const ORDER_ROW = {
  order_id: ORDER_ID,
  number: "AFV-2026-000001",
  status: "paid",
  total_kobo: 500000,
  paid_at: "2026-11-17T12:00:00Z",
  created_at: "2026-11-17T11:50:00Z",
  product_title: "Account Product A",
  product_slug: "account-product-a",
  vendor_name: "Vendor One",
  cover_public_id: "affilova/products/cover-a",
}

const DETAIL_ROW = {
  order_id: ORDER_ID,
  number: "AFV-2026-000001",
  status: "paid",
  currency: "NGN",
  subtotal_kobo: 500000,
  tax_kobo: 3750,
  tax_included: true,
  total_kobo: 500000,
  channel: "card",
  paid_at: "2026-11-17T12:00:00Z",
  created_at: "2026-11-17T11:50:00Z",
  refund_window_ends_at: "2026-11-18T12:00:00Z",
  items: [
    {
      order_item_id: "66666666-6666-4666-8666-666666666666",
      product_id: "77777777-7777-4777-8777-777777777777",
      title: "Account Product A",
      unit_price_kobo: 500000,
      vendor_name: "Vendor One",
    },
  ],
  tax_lines: [
    {
      basis: "platform_fee",
      rate_bps: 750,
      base_kobo: 50000,
      tax_kobo: 3750,
      included: true,
      supplier: "affilova",
    },
  ],
  refund_request: null,
  entitlements: [
    {
      entitlement_id: ENTITLEMENT_ID,
      file_display_name: "workbook.pdf",
      size_bytes: 2048,
      downloads_used: 1,
      max_downloads: 3,
      revoked: false,
      scan_clean: true,
    },
  ],
}

function reply(name: string, data: unknown, error: { message: string } | null = null): void {
  state.replies.set(name, { data, error })
}

beforeEach(() => {
  vi.clearAllMocks()

  state.user = { id: USER_ID, email: "buyer@example.com" }
  state.roles = ["customer"]
  state.allowed = true
  state.budget = []
  state.calls = []
  state.replies = new Map()
  state.presign = { url: "https://files.example.com/signed?token=secret", throws: false }
  state.presignCalls = []
  state.refund = null

  reply("claim_guest_orders", 0)
  reply("account_orders", { items: [ORDER_ROW], next_cursor: null })
  reply("account_order_detail", DETAIL_ROW)
})

describe("who is calling", () => {
  it("refuses a signed-out visitor", async () => {
    state.user = null

    expect(await getMyOrdersAction({})).toEqual({ ok: false, error: "Sign in to continue." })
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a role that may not be here", async () => {
    state.roles = []

    expect(await getMyOrderAction({ orderId: ORDER_ID })).toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    expect(state.calls).toHaveLength(0)
  })
})

describe("getMyOrdersAction", () => {
  it("claims guest orders first, then reads the buyer's own page", async () => {
    const result = await getMyOrdersAction({ limit: 10 })

    expect(result).toEqual({
      ok: true,
      data: { items: [expect.objectContaining({ orderId: ORDER_ID })], nextCursor: null },
    })
    expect(state.calls.map((call) => call.name)).toEqual(["claim_guest_orders", "account_orders"])
    expect(state.calls[0].args).toEqual({ p_user: USER_ID })
    expect(state.calls[1].args).toEqual({ p_user: USER_ID, p_limit: 10, p_cursor: null })
  })

  it("never takes the actor from the input", async () => {
    const result = await getMyOrdersAction({ p_user: OTHER_ID, limit: 5 })

    expect(result.ok).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it("maps the row into the shape the screen reads", async () => {
    const result = await getMyOrdersAction({})

    expect(result.ok && result.data.items[0]).toEqual({
      orderId: ORDER_ID,
      number: "AFV-2026-000001",
      status: "paid",
      totalKobo: 500000,
      paidAt: "2026-11-17T12:00:00Z",
      createdAt: "2026-11-17T11:50:00Z",
      productTitle: "Account Product A",
      productSlug: "account-product-a",
      vendorName: "Vendor One",
      coverPublicId: "affilova/products/cover-a",
    })
  })

  it("encodes the next cursor so it can be handed straight back", async () => {
    reply("account_orders", { items: [], next_cursor: { v: "1763000000.000000", id: ORDER_ID } })

    const result = await getMyOrdersAction({})

    expect(result.ok && result.data.nextCursor).toEqual(
      Buffer.from(JSON.stringify({ v: "1763000000.000000", id: ORDER_ID }), "utf8").toString(
        "base64url",
      ),
    )
  })

  it("still answers when the guest claim fails", async () => {
    reply("claim_guest_orders", null, { message: "connection reset" })

    const result = await getMyOrdersAction({})

    expect(result.ok).toBe(true)
    expect(state.calls.map((call) => call.name)).toContain("account_orders")
  })

  it("refuses a bad cursor without reading", async () => {
    expect(await getMyOrdersAction({ cursor: "not-a-cursor" })).toEqual({
      ok: false,
      error: "That page of results is no longer available. Start again.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a limit above the cap", async () => {
    expect((await getMyOrdersAction({ limit: 500 })).ok).toBe(false)
  })

  it("stops at the allowance", async () => {
    state.allowed = false

    expect(await getMyOrdersAction({})).toEqual({
      ok: false,
      error: "Too many attempts. Please wait a moment and try again.",
    })
    expect(state.budget[0]).toMatchObject({ limit: 120, windowSeconds: 60 })
  })

  it("never passes database text to the screen", async () => {
    reply("account_orders", null, { message: 'relation "public.orders" does not exist' })

    expect(await getMyOrdersAction({})).toEqual({ ok: false, error: ACCOUNT_GENERIC_ERROR })
  })

  it("answers a person with no purchases with an empty page", async () => {
    reply("account_orders", { items: [], next_cursor: null })

    expect(await getMyOrdersAction({})).toEqual({ ok: true, data: { items: [], nextCursor: null } })
  })
})

describe("getMyOrderAction", () => {
  it("reads one order the buyer owns", async () => {
    const result = await getMyOrderAction({ orderId: ORDER_ID })

    expect(result.ok).toBe(true)
    expect(state.calls[0].args).toEqual({ p_user: USER_ID, p_order: ORDER_ID })
    expect(result.ok && result.data).toMatchObject({
      orderId: ORDER_ID,
      status: "paid",
      taxLines: [expect.objectContaining({ basis: "platform_fee", taxKobo: 3750 })],
      entitlements: [expect.objectContaining({ fileDisplayName: "workbook.pdf", scanClean: true })],
      refundRequest: null,
    })
  })

  it("keeps the scan state and the download counts", async () => {
    reply("account_order_detail", {
      ...DETAIL_ROW,
      entitlements: [
        {
          entitlement_id: ENTITLEMENT_ID,
          file_display_name: "notes.zip",
          size_bytes: 4096,
          downloads_used: 0,
          max_downloads: 3,
          revoked: false,
          scan_clean: false,
        },
      ],
    })

    const result = await getMyOrderAction({ orderId: ORDER_ID })

    expect(result.ok && result.data.entitlements[0]).toEqual({
      entitlementId: ENTITLEMENT_ID,
      fileDisplayName: "notes.zip",
      sizeBytes: 4096,
      downloadsUsed: 0,
      maxDownloads: 3,
      revoked: false,
      scanClean: false,
    })
  })

  it("turns a refusal into a sentence", async () => {
    reply("account_order_detail", null, { message: "forbidden" })

    expect(await getMyOrderAction({ orderId: ORDER_ID })).toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })

  it("refuses an id that is not an id", async () => {
    expect((await getMyOrderAction({ orderId: "nope" })).ok).toBe(false)
    expect(state.calls).toHaveLength(0)
  })
})

describe("downloadMyFileAction", () => {
  it("claims with the session id, no email, and presigns for five minutes", async () => {
    reply("claim_download", { storage_key: "keys/secret-a-clean", filename: "workbook.pdf" })

    const result = await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })

    expect(result).toEqual({ ok: true, url: "https://files.example.com/signed?token=secret" })

    const claim = state.calls.find((call) => call.name === "claim_download")

    expect(claim?.args).toEqual({
      p_entitlement: ENTITLEMENT_ID,
      p_buyer_user: USER_ID,
      p_buyer_email: null,
      p_ip_hash: createHash("sha256").update("203.0.113.9").digest("hex"),
    })
    expect(state.presignCalls[0]).toEqual({
      key: "keys/secret-a-clean",
      filename: "workbook.pdf",
      expiresInSeconds: 300,
    })
  })

  it("never logs the URL or the storage key", async () => {
    reply("claim_download", { storage_key: "keys/secret-a-clean", filename: "workbook.pdf" })

    await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })

    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ])

    expect(logged).not.toContain("signed")
    expect(logged).not.toContain("keys/secret")
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith("account_download_issued")
  })

  it("refuses a file that is not part of this purchase", async () => {
    const result = await downloadMyFileAction({
      orderId: ORDER_ID,
      entitlementId: OTHER_ENTITLEMENT,
    })

    expect(result).toEqual({ ok: false, error: "This file is not part of this purchase." })
    expect(state.calls.map((call) => call.name)).not.toContain("claim_download")
  })

  it("turns each refusal code into its sentence", async () => {
    reply("claim_download", null, { message: "file_not_clean" })

    expect(await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })).toEqual(
      { ok: false, error: DOWNLOAD_MESSAGES.file_not_clean },
    )

    reply("claim_download", null, { message: "download_limit" })

    expect(await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })).toEqual(
      { ok: false, error: DOWNLOAD_MESSAGES.download_limit },
    )
  })

  it("answers a storage failure with a plain sentence", async () => {
    reply("claim_download", { storage_key: "keys/secret-a-clean", filename: "workbook.pdf" })
    state.presign.throws = true

    expect(await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })).toEqual(
      { ok: false, error: DOWNLOAD_MESSAGES.unavailable },
    )
  })

  it("stops at 30 downloads an hour", async () => {
    state.allowed = false

    const result = await downloadMyFileAction({ orderId: ORDER_ID, entitlementId: ENTITLEMENT_ID })

    expect(result.ok).toBe(false)
    expect(state.budget[0]).toMatchObject({ limit: 30, windowSeconds: 3600 })
    expect(state.calls).toHaveLength(0)
  })
})

describe("requestMyRefundAction", () => {
  it("refuses a reason shorter than 10 characters", async () => {
    expect(await requestMyRefundAction({ orderId: ORDER_ID, reason: "too short" })).toEqual({
      ok: false,
      error: "Check the form and try again.",
    })
    expect(state.calls).toHaveLength(0)
  })

  it("passes the request to the existing commerce action", async () => {
    state.refund = {
      ok: true,
      requestId: "88888888-8888-4888-8888-888888888888",
      autoApproved: false,
    }

    const result = await requestMyRefundAction({
      orderId: ORDER_ID,
      reason: "The files do not open on my machine.",
    })

    expect(result).toEqual({
      ok: true,
      data: { requestId: "88888888-8888-4888-8888-888888888888", autoApproved: false },
    })
  })

  it("passes a refusal straight through", async () => {
    state.refund = { ok: false, error: "This order cannot be refunded." }

    expect(
      await requestMyRefundAction({ orderId: ORDER_ID, reason: "The files do not open at all." }),
    ).toEqual({ ok: false, error: "This order cannot be refunded." })
  })
})
