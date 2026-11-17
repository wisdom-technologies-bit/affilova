import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSupabaseFake, type FakeSupabase } from "@/tests/helpers/supabase-fake"

import { PART_SIZE_BYTES, MULTIPART_THRESHOLD_BYTES } from "@/lib/catalog/files"
import { GENERIC_ERROR } from "@/lib/catalog/errors"
import { ImageRejectedError } from "@/lib/images/cloudinary"

import {
  abortFileUploadAction,
  completeMultipartAction,
  confirmFileUploadAction,
  createProductDraftAction,
  deleteFileAction,
  getPartUrlsAction,
  getProductForEditAction,
  listVendorProductsAction,
  registerImageAction,
  removeImageAction,
  setCoverImageAction,
  signImageUploadAction,
  startFileUploadAction,
  transitionProductAction,
  updateProductAction,
} from "./vendor"

const VENDOR = "11111111-1111-1111-1111-111111111111"
const OTHER_VENDOR = "22222222-2222-2222-2222-222222222222"
const PRODUCT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const FILE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const IMAGE = "cccccccc-cccc-cccc-cccc-cccccccccccc"

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  roles: [] as string[],
  allowed: true,
  db: null as unknown,
  storage: null as unknown,
  images: null as unknown,
  rateLimitCalls: [] as Record<string, unknown>[],
  storageCalls: [] as { method: string; args: unknown }[],
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimitKey: (parts: string[]) => parts.join(":"),
  rateLimit: async (options: Record<string, unknown>) => {
    state.rateLimitCalls.push(options)

    return { allowed: state.allowed, remaining: 0, resetAt: new Date(0) }
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => state.db,
}))

vi.mock("@/lib/storage/r2", () => ({
  getR2Storage: () => state.storage,
}))

vi.mock("@/lib/images/cloudinary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/images/cloudinary")>(
    "@/lib/images/cloudinary",
  )

  return {
    ...actual,
    getCloudinaryImages: () => state.images,
  }
})

type Db = FakeSupabase

function useDb(db: Db): Db {
  state.db = db.client

  return db
}

function setStorage(overrides: Record<string, unknown> = {}): void {
  const base = {
    presignPutUrl: async (args: unknown) => {
      state.storageCalls.push({ method: "presignPutUrl", args })

      return "https://signed.example/put"
    },
    createMultipartUpload: async (args: unknown) => {
      state.storageCalls.push({ method: "createMultipartUpload", args })

      return "upload-123"
    },
    presignPartUrl: async (args: unknown) => {
      state.storageCalls.push({ method: "presignPartUrl", args })

      return `https://signed.example/part-${(args as { partNumber: number }).partNumber}`
    },
    completeMultipartUpload: async (args: unknown) => {
      state.storageCalls.push({ method: "completeMultipartUpload", args })
    },
    abortMultipartUpload: async (args: unknown) => {
      state.storageCalls.push({ method: "abortMultipartUpload", args })
    },
    headObject: async (key: string) => {
      state.storageCalls.push({ method: "headObject", args: key })

      return { sizeBytes: 4096 }
    },
    deleteObject: async (key: string) => {
      state.storageCalls.push({ method: "deleteObject", args: key })
    },
    presignGetUrl: async () => "https://signed.example/get",
  }

  state.storage = { ...base, ...overrides }
}

function setImages(overrides: Record<string, unknown> = {}): void {
  state.images = {
    signImageUpload: ({ productId }: { productId: string }) => ({
      cloudName: "affilova",
      apiKey: "api-key",
      timestamp: 1_700_000_000,
      signature: "signature",
      folder: `products/${productId}`,
      allowedFormats: "jpg,jpeg,png,webp",
    }),
    verifyUploadedImage: async () => ({ width: 1200, height: 800, bytes: 100_000, format: "jpg" }),
    deleteImage: async () => undefined,
    ...overrides,
  }
}

/** A product row owned by VENDOR, in the given status. */
function ownedProduct(status = "draft", owner = VENDOR) {
  return {
    data: { id: PRODUCT, vendor_id: owner, status },
    error: null,
  }
}

beforeEach(() => {
  state.user = { id: VENDOR, email: "vendor@example.com" }
  state.roles = ["vendor"]
  state.allowed = true
  state.rateLimitCalls = []
  state.storageCalls = []
  state.db = null
  setStorage()
  setImages()
})

// ---------------------------------------------------------------------------
// Who is calling
// ---------------------------------------------------------------------------

describe("authentication and permission", () => {
  it("refuses every action when nobody is signed in", async () => {
    state.user = null

    for (const call of [
      () => createProductDraftAction({ fields: {} }),
      () => updateProductAction({ productId: PRODUCT, fields: {} }),
      () => transitionProductAction({ productId: PRODUCT, action: "submit" }),
      () => listVendorProductsAction({}),
      () => getProductForEditAction({ productId: PRODUCT }),
      () => startFileUploadAction({ productId: PRODUCT, filename: "a.pdf", sizeBytes: 10 }),
      () => getPartUrlsAction({ fileId: FILE, partNumbers: [1] }),
      () => completeMultipartAction({ fileId: FILE, parts: [{ partNumber: 1, etag: "e" }] }),
      () => confirmFileUploadAction({ fileId: FILE }),
      () => abortFileUploadAction({ fileId: FILE }),
      () => deleteFileAction({ fileId: FILE }),
      () => signImageUploadAction({ productId: PRODUCT }),
      () => registerImageAction({ productId: PRODUCT, publicId: "products/p/x" }),
      () => removeImageAction({ imageId: IMAGE }),
      () => setCoverImageAction({ imageId: IMAGE }),
    ]) {
      await expect(call()).resolves.toEqual({ ok: false, error: "Sign in to continue." })
    }
  })

  it("refuses a signed-in person with no vendor role", async () => {
    state.roles = ["customer"]

    await expect(createProductDraftAction({ fields: {} })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })

  it("refuses an affiliate", async () => {
    state.roles = ["customer", "affiliate"]

    await expect(startFileUploadAction({ productId: PRODUCT, filename: "a.pdf", sizeBytes: 1 }))
      .resolves.toMatchObject({ ok: false })
  })

  it("lets a vendor holding other roles through", async () => {
    useDb(
      createSupabaseFake({
        rpc: () => ({ data: PRODUCT, error: null }),
      }),
    )

    await expect(
      createProductDraftAction({
        fields: {
          title: "A product",
          categorySlug: "education",
          shortDescription: "A short description.",
          priceKobo: 150_000,
        },
      }),
    ).resolves.toEqual({ ok: true, productId: PRODUCT })
  })
})

// ---------------------------------------------------------------------------
// p_actor
// ---------------------------------------------------------------------------

describe("p_actor", () => {
  it("is the signed-in user, never an id from the input", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: PRODUCT, error: null }) }))

    await createProductDraftAction({
      fields: {
        title: "A product",
        categorySlug: "education",
        shortDescription: "A short description.",
        priceKobo: 150_000,
      },
    })

    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0]?.name).toBe("create_product_draft")
    expect(db.rpcCalls[0]?.args.p_actor).toBe(VENDOR)

    // The only id in the call is the one from the session.
    expect(Object.values(db.rpcCalls[0]?.args ?? {})).not.toContain(OTHER_VENDOR)
  })

  it("refuses an attempt to name a different actor at all", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: PRODUCT, error: null }) }))

    for (const attempt of [
      { p_actor: OTHER_VENDOR },
      { actorId: OTHER_VENDOR },
      { vendorId: OTHER_VENDOR },
    ]) {
      await expect(
        createProductDraftAction({
          fields: {
            title: "A product",
            categorySlug: "education",
            shortDescription: "A short description.",
            priceKobo: 150_000,
          },
          ...attempt,
        }),
      ).resolves.toMatchObject({ ok: false })
    }

    expect(db.rpcCalls).toHaveLength(0)
  })

  it("is the signed-in user for a transition too", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: "submitted", error: null }) }))

    await transitionProductAction({ productId: PRODUCT, action: "submit" })

    expect(db.rpcCalls[0]?.args).toMatchObject({ p_actor: VENDOR, p_product: PRODUCT })
  })
})

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

describe("rate limits", () => {
  it("counts draft creation against 20 an hour, per user", async () => {
    useDb(createSupabaseFake({ rpc: () => ({ data: PRODUCT, error: null }) }))

    await createProductDraftAction({
      fields: {
        title: "A product",
        categorySlug: "education",
        shortDescription: "A short description.",
        priceKobo: 150_000,
      },
    })

    expect(state.rateLimitCalls[0]).toMatchObject({
      key: `catalog:draft:${VENDOR}`,
      limit: 20,
      windowSeconds: 3600,
      onError: "allow",
    })
  })

  it("counts uploads and image signatures against 60 an hour", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct() } }))

    await startFileUploadAction({ productId: PRODUCT, filename: "a.pdf", sizeBytes: 10 })
    await signImageUploadAction({ productId: PRODUCT })

    expect(state.rateLimitCalls.map((call) => call.key)).toEqual([
      `catalog:fileUpload:${VENDOR}`,
      `catalog:imageSign:${VENDOR}`,
    ])
    expect(state.rateLimitCalls[0]).toMatchObject({ limit: 60, onError: "allow" })
  })

  it("refuses when the allowance is spent, before touching the database", async () => {
    state.allowed = false
    const db = useDb(createSupabaseFake())

    await expect(
      createProductDraftAction({
        fields: {
          title: "A product",
          categorySlug: "education",
          shortDescription: "A short description.",
          priceKobo: 150_000,
        },
      }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining("Too many attempts") })

    expect(db.rpcCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Drafts and edits
// ---------------------------------------------------------------------------

describe("createProductDraftAction", () => {
  it("validates before it calls the database", async () => {
    const db = useDb(createSupabaseFake())

    const result = await createProductDraftAction({
      fields: { title: "ab", categorySlug: "education", shortDescription: "A short description.", priceKobo: 150_000 },
    })

    expect(result).toEqual({ ok: false, error: "Check the form and try again." })
    expect(db.rpcCalls).toHaveLength(0)
  })

  it("refuses a missing required field", async () => {
    useDb(createSupabaseFake())

    await expect(createProductDraftAction({ fields: { title: "A product" } })).resolves.toMatchObject({
      ok: false,
    })
  })

  it("refuses an unknown field rather than silently dropping it", async () => {
    useDb(createSupabaseFake())

    await expect(
      createProductDraftAction({
        fields: {
          title: "A product",
          categorySlug: "education",
          shortDescription: "A short description.",
          priceKobo: 150_000,
          status: "live",
        },
      }),
    ).resolves.toMatchObject({ ok: false })
  })

  it("maps the camelCase fields to the keys the function reads", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: PRODUCT, error: null }) }))

    await createProductDraftAction({
      fields: {
        title: "A product",
        slug: "a-product",
        categorySlug: "education",
        shortDescription: "A short description.",
        description: "A long description.",
        priceKobo: 150_000,
        compareAtPriceKobo: 200_000,
        commissionBps: 1500,
        affiliateApproval: "open",
        refundWindowHours: 48,
        maxDownloads: 3,
      },
    })

    expect(db.rpcCalls[0]?.args.p_fields).toEqual({
      title: "A product",
      slug: "a-product",
      category_slug: "education",
      short_description: "A short description.",
      description: "A long description.",
      price_kobo: 150_000,
      compare_at_price_kobo: 200_000,
      commission_bps: 1500,
      affiliate_approval: "open",
      refund_window_hours: 48,
      max_downloads: 3,
    })
  })

  it("answers a plain failure when the function refuses", async () => {
    useDb(
      createSupabaseFake({ rpc: () => ({ data: null, error: { message: "slug_taken" } }) }),
    )

    await expect(
      createProductDraftAction({
        fields: {
          title: "A product",
          categorySlug: "education",
          shortDescription: "A short description.",
          priceKobo: 150_000,
        },
      }),
    ).resolves.toEqual({ ok: false, error: "That address is already used by another product." })
  })

  it("never returns raw database text", async () => {
    useDb(
      createSupabaseFake({
        rpc: () => ({
          data: null,
          error: { message: 'duplicate key value violates unique constraint "products_slug_key"' },
        }),
      }),
    )

    const result = await createProductDraftAction({
      fields: {
        title: "A product",
        categorySlug: "education",
        shortDescription: "A short description.",
        priceKobo: 150_000,
      },
    })

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR })
    expect(JSON.stringify(result)).not.toContain("products_slug_key")
  })

  it("does not trust a non-uuid answer", async () => {
    useDb(createSupabaseFake({ rpc: () => ({ data: 42, error: null }) }))

    await expect(
      createProductDraftAction({
        fields: {
          title: "A product",
          categorySlug: "education",
          shortDescription: "A short description.",
          priceKobo: 150_000,
        },
      }),
    ).resolves.toEqual({ ok: false, error: GENERIC_ERROR })
  })
})

describe("updateProductAction", () => {
  it("passes the product and the changed fields", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: null, error: null }) }))

    await expect(
      updateProductAction({ productId: PRODUCT, fields: { priceKobo: 200_000 } }),
    ).resolves.toEqual({ ok: true })

    expect(db.rpcCalls[0]).toMatchObject({
      name: "update_product",
      args: { p_actor: VENDOR, p_product: PRODUCT, p_fields: { price_kobo: 200_000 } },
    })
  })

  it("maps every refusal the function can raise", async () => {
    const cases: [string, string][] = [
      ["forbidden", "You do not have access to that."],
      ["not_found", "That product could not be found."],
      ["bad_state", "This product is not in a state where that is allowed."],
      ["invalid_price", "Enter a price of at least ₦100 and at most ₦10,000,000."],
      ["slug_taken", "That address is already used by another product."],
    ]

    for (const [code, message] of cases) {
      useDb(createSupabaseFake({ rpc: () => ({ data: null, error: { message: code } }) }))

      await expect(
        updateProductAction({ productId: PRODUCT, fields: { title: "Another title" } }),
      ).resolves.toEqual({ ok: false, error: message })
    }
  })
})

describe("transitionProductAction", () => {
  it("returns the new status", async () => {
    useDb(createSupabaseFake({ rpc: () => ({ data: "submitted", error: null }) }))

    await expect(
      transitionProductAction({ productId: PRODUCT, action: "submit" }),
    ).resolves.toEqual({ ok: true, status: "submitted" })
  })

  it("refuses an action it does not own", async () => {
    const db = useDb(createSupabaseFake())

    for (const action of ["approve", "reject", "staff_pause", "teleport"]) {
      await expect(transitionProductAction({ productId: PRODUCT, action })).resolves.toMatchObject({
        ok: false,
      })
    }

    expect(db.rpcCalls).toHaveLength(0)
  })

  it("explains a product that is not ready", async () => {
    useDb(createSupabaseFake({ rpc: () => ({ data: null, error: { message: "not_ready" } }) }))

    await expect(
      transitionProductAction({ productId: PRODUCT, action: "submit" }),
    ).resolves.toEqual({
      ok: false,
      error: "Finish the product first: fill in the description and add a file and a cover image.",
    })
  })
})

describe("listVendorProductsAction", () => {
  const rows = [
    {
      id: PRODUCT,
      title: "A product",
      slug: "a-product",
      short_description: "A short description.",
      price_kobo: 150_000,
      currency: "NGN",
      status: "draft",
      submitted_at: null,
      published_at: null,
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T10:00:00.000Z",
      reject_reason: null,
    },
  ]

  it("scopes the read to the signed-in vendor", async () => {
    const db = useDb(createSupabaseFake({ tables: { products: { data: rows, error: null } } }))

    await expect(listVendorProductsAction({})).resolves.toMatchObject({
      ok: true,
      items: [{ id: PRODUCT, title: "A product", status: "draft" }],
    })

    expect(db.tableQueries[0]?.filters.vendor_id).toBe(VENDOR)
  })

  it("filters by status when asked", async () => {
    const db = useDb(createSupabaseFake({ tables: { products: { data: [], error: null } } }))

    await listVendorProductsAction({ status: "live" })

    expect(db.tableQueries[0]?.filters.status).toBe("live")
  })

  it("returns a cursor and uses it for the next page", async () => {
    const many = [
      ...rows,
      { ...rows[0], id: "dddddddd-dddd-dddd-dddd-dddddddddddd", created_at: "2026-11-09T10:00:00.000Z" },
    ]
    const db = useDb(createSupabaseFake({ tables: { products: { data: many, error: null } } }))

    const first = await listVendorProductsAction({ limit: 1 })

    expect(first.ok).toBe(true)

    if (first.ok) {
      expect(first.items).toHaveLength(1)
      expect(first.nextCursor).not.toBeNull()

      await listVendorProductsAction({ limit: 1, cursor: first.nextCursor ?? undefined })

      expect(db.tableQueries[1]?.filters.or).toContain("created_at.lt.2026-11-10T10:00:00.000Z")
    }
  })

  it("refuses an unreadable cursor instead of failing", async () => {
    useDb(createSupabaseFake({ tables: { products: { data: rows, error: null } } }))

    await expect(listVendorProductsAction({ cursor: "not-a-cursor" })).resolves.toMatchObject({
      ok: true,
    })
  })
})

describe("getProductForEditAction", () => {
  it("returns the product, its files, its images and the readiness", async () => {
    const readiness = {
      title: true,
      short_description: true,
      description: false,
      category: true,
      price: true,
      commission: true,
      file: true,
      cover: false,
      missing: ["description", "cover"],
    }

    useDb(
      createSupabaseFake({
        tables: {
          products: {
            data: {
              id: PRODUCT,
              vendor_id: VENDOR,
              title: "A product",
              slug: "a-product",
              short_description: "A short description.",
              description: "A long enough description.",
              price_kobo: 150_000,
              currency: "NGN",
              status: "draft",
              commission_bps: 1500,
              affiliate_approval: "open",
              refund_window_hours: 24,
              max_downloads: 5,
              category_id: 1,
              created_at: "2026-11-10T10:00:00.000Z",
              updated_at: "2026-11-10T10:00:00.000Z",
            },
            error: null,
          },
          product_files: {
            data: [
              {
                id: FILE,
                original_name: "guide.pdf",
                content_type: "application/pdf",
                size_bytes: 4096,
                status: "uploaded",
                scan_status: "not_scanned",
                created_at: "2026-11-10T10:00:00.000Z",
              },
            ],
            error: null,
          },
          product_images: {
            data: [
              {
                id: IMAGE,
                cloudinary_public_id: `products/${PRODUCT}/cover`,
                alt_text: null,
                width: 1200,
                height: 800,
                sort: 0,
                is_cover: true,
              },
            ],
            error: null,
          },
        },
        rpc: () => ({ data: readiness, error: null }),
      }),
    )

    const result = await getProductForEditAction({ productId: PRODUCT })

    expect(result).toMatchObject({
      ok: true,
      product: { id: PRODUCT, priceKobo: 150_000, status: "draft" },
      files: [{ id: FILE, originalName: "guide.pdf" }],
      images: [{ id: IMAGE, isCover: true }],
      readiness: { description: false, cover: false, missing: ["description", "cover"] },
    })
  })

  it("refuses another vendor's product", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct("draft", OTHER_VENDOR) } }))

    await expect(getProductForEditAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })

  it("answers not_found for a product that does not exist", async () => {
    useDb(createSupabaseFake())

    await expect(getProductForEditAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "That product could not be found.",
    })
  })
})

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

describe("startFileUploadAction", () => {
  it("reserves the row, then signs one PUT for a small file", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    const result = await startFileUploadAction({
      productId: PRODUCT,
      filename: "guide.pdf",
      sizeBytes: 4096,
    })

    expect(result.ok).toBe(true)

    if (!result.ok || result.plan.kind !== "single") {
      throw new Error("expected a single upload plan")
    }

    expect(result.key).toBe(`products/${PRODUCT}/${result.fileId}/guide.pdf`)
    expect(result.contentType).toBe("application/pdf")
    expect(result.plan.url).toBe("https://signed.example/put")

    const registerCall = db.rpcCalls[0]

    expect(registerCall?.name).toBe("register_product_file")
    expect(registerCall?.args).toMatchObject({
      p_actor: VENDOR,
      p_product: PRODUCT,
      p_storage_key: result.key,
      p_original_name: "guide.pdf",
      p_content_type: "application/pdf",
      p_size_bytes: 4096,
      p_multipart_upload_id: null,
    })
  })

  it("uses a multipart plan above the threshold", async () => {
    const size = MULTIPART_THRESHOLD_BYTES + 1
    const db = useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    const result = await startFileUploadAction({
      productId: PRODUCT,
      filename: "course.zip",
      sizeBytes: size,
    })

    expect(result.ok).toBe(true)

    if (!result.ok || result.plan.kind !== "multipart") {
      throw new Error("expected a multipart plan")
    }

    expect(result.plan.uploadId).toBe("upload-123")
    expect(result.plan.partSizeBytes).toBe(PART_SIZE_BYTES)
    expect(result.plan.parts).toHaveLength(Math.ceil(size / PART_SIZE_BYTES))
    expect(result.plan.parts[0]?.partNumber).toBe(1)
    expect(db.rpcCalls[0]?.args.p_multipart_upload_id).toBe("upload-123")
    expect(
      state.storageCalls.some((call) => call.method === "createMultipartUpload"),
    ).toBe(true)
  })

  it("refuses a type that is not allowed, without reserving anything", async () => {
    const db = useDb(createSupabaseFake({ tables: { products: ownedProduct() } }))

    await expect(
      startFileUploadAction({ productId: PRODUCT, filename: "virus.exe", sizeBytes: 10 }),
    ).resolves.toEqual({ ok: false, error: "That file type is not allowed." })

    expect(db.rpcCalls).toHaveLength(0)
  })

  it("refuses an oversized file before the storage call", async () => {
    const db = useDb(createSupabaseFake({ tables: { products: ownedProduct() } }))

    await expect(
      startFileUploadAction({ productId: PRODUCT, filename: "big.zip", sizeBytes: 2_147_483_649 }),
    ).resolves.toMatchObject({ ok: false })

    expect(db.rpcCalls).toHaveLength(0)
    expect(state.storageCalls).toHaveLength(0)
  })

  it("refuses another vendor's product", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct("draft", OTHER_VENDOR) } }))

    await expect(
      startFileUploadAction({ productId: PRODUCT, filename: "a.pdf", sizeBytes: 10 }),
    ).resolves.toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("refuses an archived product", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct("archived") } }))

    await expect(
      startFileUploadAction({ productId: PRODUCT, filename: "a.pdf", sizeBytes: 10 }),
    ).resolves.toEqual({
      ok: false,
      error: "This product is not in a state where that is allowed.",
    })
  })

  it("aborts the multipart upload when the reservation is refused", async () => {
    useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: null, error: { message: "file_limit" } }),
      }),
    )

    const result = await startFileUploadAction({
      productId: PRODUCT,
      filename: "course.zip",
      sizeBytes: MULTIPART_THRESHOLD_BYTES + 1,
    })

    expect(result).toEqual({ ok: false, error: "A product can have at most 10 files." })
    expect(state.storageCalls.map((call) => call.method)).toContain("abortMultipartUpload")
  })
})

describe("getPartUrlsAction", () => {
  it("signs the parts that were asked for", async () => {
    useDb(
      createSupabaseFake({
        tables: {
          product_files: {
            data: {
              id: FILE,
              product_id: PRODUCT,
              storage_key: `products/${PRODUCT}/${FILE}/course.zip`,
              original_name: "course.zip",
              content_type: "application/zip",
              size_bytes: 200_000_000,
              status: "pending",
              multipart_upload_id: "upload-123",
            },
            error: null,
          },
          products: ownedProduct(),
        },
      }),
    )

    const result = await getPartUrlsAction({ fileId: FILE, partNumbers: [2, 3] })

    expect(result).toEqual({
      ok: true,
      parts: [
        { partNumber: 2, url: "https://signed.example/part-2" },
        { partNumber: 3, url: "https://signed.example/part-3" },
      ],
    })
  })

  it("refuses a file that is not a multipart upload", async () => {
    useDb(
      createSupabaseFake({
        tables: {
          product_files: {
            data: {
              id: FILE,
              product_id: PRODUCT,
              storage_key: "k",
              original_name: "a.pdf",
              content_type: "application/pdf",
              size_bytes: 10,
              status: "pending",
              multipart_upload_id: null,
            },
            error: null,
          },
          products: ownedProduct(),
        },
      }),
    )

    await expect(getPartUrlsAction({ fileId: FILE, partNumbers: [1] })).resolves.toEqual({
      ok: false,
      error: "This product is not in a state where that is allowed.",
    })
  })
})

describe("confirmFileUploadAction", () => {
  function fileRow(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        id: FILE,
        product_id: PRODUCT,
        storage_key: `products/${PRODUCT}/${FILE}/guide.pdf`,
        original_name: "guide.pdf",
        content_type: "application/pdf",
        size_bytes: 4096,
        status: "pending",
        multipart_upload_id: null,
        ...overrides,
      },
      error: null,
    }
  }

  it("heads the object and confirms the real size", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { product_files: fileRow(), products: ownedProduct() },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    await expect(confirmFileUploadAction({ fileId: FILE })).resolves.toEqual({
      ok: true,
      fileId: FILE,
    })

    expect(state.storageCalls[0]).toEqual({
      method: "headObject",
      args: `products/${PRODUCT}/${FILE}/guide.pdf`,
    })
    expect(db.rpcCalls[0]).toMatchObject({
      name: "confirm_product_file",
      args: { p_actor: VENDOR, p_file: FILE, p_actual_size: 4096 },
    })
  })

  it("deletes the object and the row when the size does not match", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { product_files: fileRow(), products: ownedProduct() },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    state.storage = {
      ...(state.storage as Record<string, unknown>),
      headObject: async () => ({ sizeBytes: 999_999 }),
    }

    await expect(confirmFileUploadAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "The uploaded file did not match the size that was reserved.",
    })

    expect(state.storageCalls.some((call) => call.method === "deleteObject")).toBe(true)
    expect(db.rpcCalls.map((call) => call.name)).toEqual(["purge_pending_file"])
    expect(db.rpcCalls.some((call) => call.name === "confirm_product_file")).toBe(false)
  })

  it("cleans up when the object never arrived", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { product_files: fileRow(), products: ownedProduct() },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    state.storage = {
      ...(state.storage as Record<string, unknown>),
      headObject: async () => null,
    }

    await expect(confirmFileUploadAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "The upload did not arrive. Try uploading the file again.",
    })

    expect(db.rpcCalls.map((call) => call.name)).toEqual(["purge_pending_file"])
  })

  it("is idempotent for a file that is already uploaded", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { product_files: fileRow({ status: "uploaded" }), products: ownedProduct() },
      }),
    )

    await expect(confirmFileUploadAction({ fileId: FILE })).resolves.toEqual({
      ok: true,
      fileId: FILE,
    })
    expect(db.rpcCalls).toHaveLength(0)
  })

  it("refuses another vendor's file", async () => {
    useDb(
      createSupabaseFake({
        tables: { product_files: fileRow(), products: ownedProduct("draft", OTHER_VENDOR) },
      }),
    )

    await expect(confirmFileUploadAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })
})

describe("completeMultipartAction", () => {
  it("completes with the parts, then confirms the object", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: {
          product_files: {
            data: {
              id: FILE,
              product_id: PRODUCT,
              storage_key: `products/${PRODUCT}/${FILE}/course.zip`,
              original_name: "course.zip",
              content_type: "application/zip",
              size_bytes: 4096,
              status: "pending",
              multipart_upload_id: "upload-123",
            },
            error: null,
          },
          products: ownedProduct(),
        },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    await expect(
      completeMultipartAction({
        fileId: FILE,
        parts: [
          { partNumber: 1, etag: "etag-1" },
          { partNumber: 2, etag: "etag-2" },
        ],
      }),
    ).resolves.toEqual({ ok: true, fileId: FILE })

    expect(
      state.storageCalls.find((call) => call.method === "completeMultipartUpload")?.args,
    ).toEqual({
      key: `products/${PRODUCT}/${FILE}/course.zip`,
      uploadId: "upload-123",
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
      ],
    })
    expect(db.rpcCalls.map((call) => call.name)).toContain("confirm_product_file")
  })
})

describe("abortFileUploadAction", () => {
  it("aborts the upload and purges the row", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: {
          product_files: {
            data: {
              id: FILE,
              product_id: PRODUCT,
              storage_key: "k",
              original_name: "a.zip",
              content_type: "application/zip",
              size_bytes: 10,
              status: "pending",
              multipart_upload_id: "upload-123",
            },
            error: null,
          },
          products: ownedProduct(),
        },
        rpc: () => ({ data: null, error: null }),
      }),
    )

    await expect(abortFileUploadAction({ fileId: FILE })).resolves.toEqual({ ok: true })
    expect(state.storageCalls.map((call) => call.method)).toContain("abortMultipartUpload")
    expect(db.rpcCalls[0]?.name).toBe("purge_pending_file")
  })

  it("refuses a file that is already uploaded", async () => {
    useDb(
      createSupabaseFake({
        tables: {
          product_files: {
            data: {
              id: FILE,
              product_id: PRODUCT,
              storage_key: "k",
              original_name: "a.pdf",
              content_type: "application/pdf",
              size_bytes: 10,
              status: "uploaded",
              multipart_upload_id: null,
            },
            error: null,
          },
          products: ownedProduct(),
        },
      }),
    )

    await expect(abortFileUploadAction({ fileId: FILE })).resolves.toMatchObject({ ok: false })
  })
})

describe("deleteFileAction", () => {
  it("deletes the row first, then the object", async () => {
    useDb(
      createSupabaseFake({
        rpc: () => ({ data: `products/${PRODUCT}/${FILE}/guide.pdf`, error: null }),
      }),
    )

    await expect(deleteFileAction({ fileId: FILE })).resolves.toEqual({ ok: true })

    const deleteCall = state.storageCalls.find((call) => call.method === "deleteObject")

    expect(deleteCall?.args).toBe(`products/${PRODUCT}/${FILE}/guide.pdf`)
  })

  it("keeps the file when the product would be left with none", async () => {
    useDb(
      createSupabaseFake({
        rpc: () => ({ data: null, error: { message: "last_file" } }),
      }),
    )

    await expect(deleteFileAction({ fileId: FILE })).resolves.toEqual({
      ok: false,
      error: "A published product must keep at least one file.",
    })
    expect(state.storageCalls.some((call) => call.method === "deleteObject")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe("signImageUploadAction", () => {
  it("returns the signature for the product's folder", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct() } }))

    await expect(signImageUploadAction({ productId: PRODUCT })).resolves.toEqual({
      ok: true,
      cloudName: "affilova",
      apiKey: "api-key",
      timestamp: 1_700_000_000,
      signature: "signature",
      folder: `products/${PRODUCT}`,
      allowedFormats: "jpg,jpeg,png,webp",
    })
  })

  it("refuses another vendor's product", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct("draft", OTHER_VENDOR) } }))

    await expect(signImageUploadAction({ productId: PRODUCT })).resolves.toMatchObject({
      ok: false,
    })
  })
})

describe("registerImageAction", () => {
  it("verifies the asset, then attaches it", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: IMAGE, error: null }),
      }),
    )

    await expect(
      registerImageAction({
        productId: PRODUCT,
        publicId: `products/${PRODUCT}/cover`,
        alt: "Cover",
        makeCover: true,
      }),
    ).resolves.toEqual({ ok: true, imageId: IMAGE })

    expect(db.rpcCalls[0]?.args).toMatchObject({
      p_actor: VENDOR,
      p_product: PRODUCT,
      p_public_id: `products/${PRODUCT}/cover`,
      p_alt: "Cover",
      p_width: 1200,
      p_height: 800,
      p_bytes: 100_000,
      p_format: "jpg",
      p_make_cover: true,
    })
  })

  it("refuses an asset that belongs to another product", async () => {
    const db = useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: IMAGE, error: null }),
      }),
    )

    await expect(
      registerImageAction({ productId: PRODUCT, publicId: "products/somebody-else/cover" }),
    ).resolves.toEqual({ ok: false, error: "That upload does not belong to this product." })
    expect(db.rpcCalls).toHaveLength(0)
  })

  it("maps a rejected image to its sentence", async () => {
    useDb(createSupabaseFake({ tables: { products: ownedProduct() } }))

    setImages({
      verifyUploadedImage: async () => {
        throw new ImageRejectedError("image_too_small")
      },
    })

    await expect(
      registerImageAction({ productId: PRODUCT, publicId: `products/${PRODUCT}/small` }),
    ).resolves.toEqual({
      ok: false,
      error: "The image must be at least 400 pixels wide and 400 pixels tall.",
    })
  })

  it("maps the limit refusal", async () => {
    useDb(
      createSupabaseFake({
        tables: { products: ownedProduct() },
        rpc: () => ({ data: null, error: { message: "image_limit" } }),
      }),
    )

    await expect(
      registerImageAction({ productId: PRODUCT, publicId: `products/${PRODUCT}/seven` }),
    ).resolves.toEqual({ ok: false, error: "A product can have at most 6 images." })
  })
})

describe("removeImageAction and setCoverImageAction", () => {
  it("deletes the row, then the asset", async () => {
    const db = useDb(
      createSupabaseFake({ rpc: () => ({ data: `products/${PRODUCT}/cover`, error: null }) }),
    )
    const deleted: string[] = []

    setImages({
      deleteImage: async (publicId: string) => {
        deleted.push(publicId)
      },
    })

    await expect(removeImageAction({ imageId: IMAGE })).resolves.toEqual({ ok: true })
    expect(db.rpcCalls[0]?.name).toBe("remove_product_image")
    expect(deleted).toEqual([`products/${PRODUCT}/cover`])
  })

  it("still reports success when the asset cleanup fails", async () => {
    useDb(createSupabaseFake({ rpc: () => ({ data: "public-id", error: null }) }))

    setImages({
      deleteImage: async () => {
        throw new Error("cloudinary is down")
      },
    })

    await expect(removeImageAction({ imageId: IMAGE })).resolves.toEqual({ ok: true })
  })

  it("sets the cover", async () => {
    const db = useDb(createSupabaseFake({ rpc: () => ({ data: null, error: null }) }))

    await expect(setCoverImageAction({ imageId: IMAGE })).resolves.toEqual({ ok: true })
    expect(db.rpcCalls[0]).toMatchObject({
      name: "set_cover_image",
      args: { p_actor: VENDOR, p_image: IMAGE },
    })
  })
})
