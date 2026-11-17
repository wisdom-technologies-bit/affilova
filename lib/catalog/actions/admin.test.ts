import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSupabaseFake } from "@/tests/helpers/supabase-fake"

import { GENERIC_ERROR } from "@/lib/catalog/errors"

import {
  getProductForReviewAction,
  getReviewFileDownloadUrlAction,
  listReviewQueueAction,
  reviewProductAction,
  staffPauseProductAction,
} from "./admin"

const ADMIN = "33333333-3333-3333-3333-333333333333"
const MODERATOR = "44444444-4444-4444-4444-444444444444"
const VENDOR = "11111111-1111-1111-1111-111111111111"
const PRODUCT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const FILE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  roles: [] as string[],
  db: null as unknown,
  storage: null as unknown,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => state.db,
}))

vi.mock("@/lib/storage/r2", () => ({
  getR2Storage: () => state.storage,
}))

const PRODUCT_ROW = {
  id: PRODUCT,
  vendor_id: VENDOR,
  title: "A product",
  slug: "a-product",
  short_description: "A short description.",
  description: "A long enough description that satisfies readiness.",
  price_kobo: 150_000,
  currency: "NGN",
  status: "submitted",
  commission_bps: 1500,
  affiliate_approval: "open",
  refund_window_hours: 24,
  max_downloads: 5,
  category_id: 1,
  submitted_at: "2026-11-12T09:00:00.000Z",
  created_at: "2026-11-11T09:00:00.000Z",
  updated_at: "2026-11-12T09:00:00.000Z",
  vendor_profiles: { business_name: "Alpha Digital" },
}

beforeEach(() => {
  state.user = { id: ADMIN, email: "admin@example.com" }
  state.roles = ["customer", "admin"]
  state.db = createSupabaseFake().client
  state.storage = {
    presignGetUrl: async () => "https://signed.example/download",
  }
})

describe("who may review", () => {
  it("refuses a signed-out visitor", async () => {
    state.user = null

    for (const call of [
      () => listReviewQueueAction({}),
      () => getProductForReviewAction({ productId: PRODUCT }),
      () => reviewProductAction({ productId: PRODUCT, decision: "approve" }),
      () => staffPauseProductAction({ productId: PRODUCT, reason: "A good enough reason" }),
      () => getReviewFileDownloadUrlAction({ fileId: FILE }),
    ]) {
      await expect(call()).resolves.toEqual({ ok: false, error: "Sign in to continue." })
    }
  })

  it("refuses a vendor, even the one who owns the product", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["customer", "vendor"]

    await expect(listReviewQueueAction({})).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    await expect(
      reviewProductAction({ productId: PRODUCT, decision: "approve" }),
    ).resolves.toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("refuses support and finance", async () => {
    for (const roles of [["customer", "support"], ["customer", "finance"]]) {
      state.roles = roles

      await expect(listReviewQueueAction({})).resolves.toMatchObject({ ok: false })
    }
  })

  it("lets a moderator in", async () => {
    state.user = { id: MODERATOR, email: "mod@example.com" }
    state.roles = ["customer", "moderator"]

    await expect(listReviewQueueAction({})).resolves.toMatchObject({ ok: true })
  })
})

describe("listReviewQueueAction", () => {
  it("reads submitted products oldest first, with the business name and file count", async () => {
    const db = createSupabaseFake({
      tables: {
        products: { data: [PRODUCT_ROW], error: null },
        product_files: {
          data: [{ product_id: PRODUCT }, { product_id: PRODUCT }],
          error: null,
        },
      },
    })
    state.db = db.client

    const result = await listReviewQueueAction({})

    expect(result).toEqual({
      ok: true,
      items: [
        {
          id: PRODUCT,
          title: "A product",
          slug: "a-product",
          priceKobo: 150_000,
          businessName: "Alpha Digital",
          fileCount: 2,
          submittedAt: "2026-11-12T09:00:00.000Z",
        },
      ],
      nextCursor: null,
    })

    expect(db.tableQueries[0]?.filters.status).toBe("submitted")
  })

  it("pages with a cursor over submitted_at", async () => {
    const second = { ...PRODUCT_ROW, id: "dddddddd-dddd-dddd-dddd-dddddddddddd" }
    const db = createSupabaseFake({
      tables: { products: { data: [PRODUCT_ROW, second], error: null } },
    })
    state.db = db.client

    const first = await listReviewQueueAction({ limit: 1 })

    expect(first.ok).toBe(true)

    if (!first.ok) {
      throw new Error("expected a page")
    }

    expect(first.nextCursor).not.toBeNull()

    await listReviewQueueAction({ limit: 1, cursor: first.nextCursor ?? undefined })

    const productQueries = db.tableQueries.filter((query) => query.table === "products")

    expect(productQueries[productQueries.length - 1]?.filters.or).toContain(
      "submitted_at.gt.2026-11-12T09:00:00.000Z",
    )
  })

  it("never returns raw database text", async () => {
    state.db = createSupabaseFake({
      tables: {
        products: {
          data: null,
          error: { message: 'relation "products" does not exist' },
        },
      },
    }).client

    const result = await listReviewQueueAction({})

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR })
    expect(JSON.stringify(result)).not.toContain("relation")
  })
})

describe("getProductForReviewAction", () => {
  it("returns the product with its business name, files and images", async () => {
    state.db = createSupabaseFake({
      tables: {
        products: { data: PRODUCT_ROW, error: null },
        product_files: {
          data: [
            {
              id: FILE,
              original_name: "guide.pdf",
              content_type: "application/pdf",
              size_bytes: 4096,
              status: "uploaded",
              scan_status: "not_scanned",
              created_at: "2026-11-11T09:00:00.000Z",
            },
          ],
          error: null,
        },
        product_images: { data: [], error: null },
      },
      rpc: () => ({
        data: { title: true, short_description: true, description: true, category: true, price: true, commission: true, file: true, cover: false, missing: ["cover"] },
        error: null,
      }),
    }).client

    const result = await getProductForReviewAction({ productId: PRODUCT })

    expect(result).toMatchObject({
      ok: true,
      businessName: "Alpha Digital",
      product: { id: PRODUCT, status: "submitted" },
      files: [{ id: FILE }],
      readiness: { cover: false, missing: ["cover"] },
    })
  })

  it("answers not_found for a product that is gone", async () => {
    await expect(getProductForReviewAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "That product could not be found.",
    })
  })
})

describe("reviewProductAction", () => {
  it("approves", async () => {
    const db = createSupabaseFake({ rpc: () => ({ data: "live", error: null }) })
    state.db = db.client

    await expect(reviewProductAction({ productId: PRODUCT, decision: "approve" })).resolves.toEqual({
      ok: true,
      status: "live",
    })

    expect(db.rpcCalls[0]).toMatchObject({
      name: "product_transition",
      args: { p_actor: ADMIN, p_product: PRODUCT, p_action: "approve", p_reason: null },
    })
  })

  it("rejects with the reason", async () => {
    const db = createSupabaseFake({ rpc: () => ({ data: "rejected", error: null }) })
    state.db = db.client

    await expect(
      reviewProductAction({
        productId: PRODUCT,
        decision: "reject",
        reason: "The cover image is unreadable.",
      }),
    ).resolves.toEqual({ ok: true, status: "rejected" })

    expect(db.rpcCalls[0]?.args).toMatchObject({
      p_action: "reject",
      p_reason: "The cover image is unreadable.",
    })
  })

  it("never sends a reason with an approval", async () => {
    const db = createSupabaseFake({ rpc: () => ({ data: "live", error: null }) })
    state.db = db.client

    await reviewProductAction({ productId: PRODUCT, decision: "approve", reason: "ignored" })

    expect(db.rpcCalls[0]?.args.p_reason).toBeNull()
  })

  it("explains a missing reason and a self review", async () => {
    const cases: [string, string][] = [
      ["reason_required", "Give a reason of at least 10 characters."],
      ["self_review", "You cannot review your own product."],
      ["bad_state", "This product is not in a state where that is allowed."],
    ]

    for (const [code, message] of cases) {
      state.db = createSupabaseFake({ rpc: () => ({ data: null, error: { message: code } }) }).client

      await expect(
        reviewProductAction({ productId: PRODUCT, decision: "reject", reason: "short" }),
      ).resolves.toEqual({ ok: false, error: message })
    }
  })

  it("refuses a decision it does not recognise before calling anything", async () => {
    const db = createSupabaseFake()
    state.db = db.client

    await expect(
      reviewProductAction({ productId: PRODUCT, decision: "delete" }),
    ).resolves.toMatchObject({ ok: false })
    expect(db.rpcCalls).toHaveLength(0)
  })
})

describe("staffPauseProductAction", () => {
  it("pauses with a reason", async () => {
    const db = createSupabaseFake({ rpc: () => ({ data: "paused", error: null }) })
    state.db = db.client

    await expect(
      staffPauseProductAction({ productId: PRODUCT, reason: "The download link is broken." }),
    ).resolves.toEqual({ ok: true, status: "paused" })

    expect(db.rpcCalls[0]?.args).toMatchObject({ p_action: "staff_pause" })
  })

  it("needs a reason", async () => {
    state.db = createSupabaseFake({
      rpc: () => ({ data: null, error: { message: "reason_required" } }),
    }).client

    await expect(
      staffPauseProductAction({ productId: PRODUCT, reason: "nope" }),
    ).resolves.toEqual({ ok: false, error: "Give a reason of at least 10 characters." })
  })
})

describe("getReviewFileDownloadUrlAction", () => {
  it("audits the access before handing out a 5 minute link", async () => {
    const order: string[] = []
    const db = createSupabaseFake({
      tables: {
        product_files: {
          data: {
            id: FILE,
            storage_key: `products/${PRODUCT}/${FILE}/guide.pdf`,
            original_name: "guide.pdf",
          },
          error: null,
        },
      },
      rpc: (name) => {
        order.push(name)

        return { data: null, error: null }
      },
    })
    state.db = db.client
    state.storage = {
      presignGetUrl: async (args: { expiresInSeconds?: number }) => {
        order.push(`presign:${args.expiresInSeconds ?? "default"}`)

        return "https://signed.example/download"
      },
    }

    await expect(getReviewFileDownloadUrlAction({ fileId: FILE })).resolves.toEqual({
      ok: true,
      url: "https://signed.example/download",
      expiresInSeconds: 300,
    })

    expect(order).toEqual(["log_product_file_admin_access", "presign:300"])
    expect(db.rpcCalls[0]?.args).toEqual({ p_actor: ADMIN, p_file: FILE })
  })

  it("hands out no link when the audit row cannot be written", async () => {
    let presigned = false

    state.db = createSupabaseFake({
      tables: {
        product_files: {
          data: { id: FILE, storage_key: "k", original_name: "a.pdf" },
          error: null,
        },
      },
      rpc: () => ({ data: null, error: { message: "forbidden" } }),
    }).client
    state.storage = {
      presignGetUrl: async () => {
        presigned = true

        return "https://signed.example/download"
      },
    }

    await expect(getReviewFileDownloadUrlAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    expect(presigned).toBe(false)
  })

  it("answers not_found for a file that does not exist", async () => {
    state.db = createSupabaseFake().client

    await expect(getReviewFileDownloadUrlAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "That product could not be found.",
    })
  })
})
