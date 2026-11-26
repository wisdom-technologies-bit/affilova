import { describe, expect, it, vi } from "vitest"

import { EMPTY_QUERY, type MarketplaceQuery } from "./params"
import {
  cursorArgument,
  getMarketplaceCategories,
  getMarketplacePage,
  getProductStoreSlug,
  getRelatedProducts,
  getSitemapEntries,
  getStorePage,
  TIMEOUT_MS,
  type MarketplaceDeps,
  type Rpc,
} from "./queries"

const PRODUCT = {
  product_id: "a1000000-0000-4000-8000-000000000001",
  slug: "keto-diet-guide",
  title: "Keto Diet Guide",
  short_description: "A practical guide.",
  cover_public_id: "affilova/keto/cover",
  price_kobo: 150_000,
  compare_at_price_kobo: null,
  category_slug: "education",
  category_name: "Education",
  vendor_name: "Ada Digital",
  vendor_slug: "ada-digital",
}

function query(overrides: Partial<MarketplaceQuery> = {}): MarketplaceQuery {
  return { ...EMPTY_QUERY, ...overrides }
}

function deps(rpc: Rpc, timeoutMs?: number): MarketplaceDeps {
  return timeoutMs === undefined ? { rpc } : { rpc, timeoutMs }
}

const ok =
  (data: unknown): Rpc =>
  async () => ({ data, error: null })

describe("getMarketplacePage", () => {
  it("returns a page in the shape the components use", async () => {
    const page = await getMarketplacePage(
      query({ q: "keto" }),
      deps(ok({ items: [PRODUCT], next_cursor: null, total_estimate: 1 })),
    )

    expect(page).not.toBeNull()
    expect(page?.total).toBe(1)
    expect(page?.nextCursor).toBeNull()
    expect(page?.items[0]).toEqual({
      productId: PRODUCT.product_id,
      slug: PRODUCT.slug,
      title: PRODUCT.title,
      shortDescription: PRODUCT.short_description,
      coverPublicId: PRODUCT.cover_public_id,
      priceKobo: 150_000,
      compareAtPriceKobo: null,
      categorySlug: "education",
      categoryName: "Education",
      vendorName: "Ada Digital",
      vendorSlug: "ada-digital",
    })
  })

  it("encodes the next cursor for a URL", async () => {
    const page = await getMarketplacePage(
      query(),
      deps(ok({ items: [PRODUCT], next_cursor: { v: "1", t: "2", id: PRODUCT.product_id, s: "newest" }, total_estimate: 9 })),
    )

    expect(page?.nextCursor).not.toBeNull()
    expect(page?.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("sends the filters as the database expects them", async () => {
    const rpc = vi.fn(async () => ({ data: { items: [], next_cursor: null, total_estimate: 0 }, error: null }))

    await getMarketplacePage(
      query({ q: "keto", category: "education", minKobo: 100, maxKobo: 200, sort: "price_high" }),
      deps(rpc as unknown as Rpc),
    )

    expect(rpc).toHaveBeenCalledWith("public_marketplace", {
      p_q: "keto",
      p_category: "education",
      p_min_price_kobo: 100,
      p_max_price_kobo: 200,
      p_sort: "price_high",
      p_limit: 12,
      p_cursor: null,
    })
  })

  it("sends null rather than an empty string for an absent filter", async () => {
    const rpc = vi.fn(async () => ({ data: { items: [], next_cursor: null, total_estimate: 0 }, error: null }))

    await getMarketplacePage(query(), deps(rpc as unknown as Rpc))

    expect(rpc).toHaveBeenCalledWith(
      "public_marketplace",
      expect.objectContaining({ p_q: null, p_category: null, p_min_price_kobo: null }),
    )
  })

  it("answers null when the database reports an error", async () => {
    const page = await getMarketplacePage(
      query(),
      deps(async () => ({ data: null, error: { message: "boom" } })),
    )

    expect(page).toBeNull()
  })

  it("answers null when the call throws", async () => {
    const page = await getMarketplacePage(
      query(),
      deps(async () => {
        throw new Error("network down")
      }),
    )

    expect(page).toBeNull()
  })

  it("gives up after the timeout instead of hanging the page", async () => {
    const never = new Promise<{ data: unknown; error: unknown }>(() => {})

    const started = Date.now()
    const page = await getMarketplacePage(query(), deps(() => never, 20))

    expect(page).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("has a three second default timeout", () => {
    expect(TIMEOUT_MS).toBe(3000)
  })

  it("refuses an answer carrying a field the page must never show", async () => {
    const page = await getMarketplacePage(
      query(),
      deps(ok({ items: [{ ...PRODUCT, commission_bps: 2000 }], next_cursor: null, total_estimate: 1 })),
    )

    expect(page).toBeNull()
  })

  it("refuses an answer with a missing field", async () => {
    const { title: _title, ...withoutTitle } = PRODUCT

    const page = await getMarketplacePage(
      query(),
      deps(ok({ items: [withoutTitle], next_cursor: null, total_estimate: 1 })),
    )

    expect(page).toBeNull()
  })

  it("refuses an answer that is not an object", async () => {
    expect(await getMarketplacePage(query(), deps(ok("nope")))).toBeNull()
    expect(await getMarketplacePage(query(), deps(ok([])))).toBeNull()
    expect(await getMarketplacePage(query(), deps(ok(null)))).toBeNull()
  })

  it("accepts a bigint sent as a string", async () => {
    const page = await getMarketplacePage(
      query(),
      deps(ok({ items: [{ ...PRODUCT, price_kobo: "150000" }], next_cursor: null, total_estimate: "1" })),
    )

    expect(page?.items[0]?.priceKobo).toBe(150_000)
    expect(page?.total).toBe(1)
  })
})

describe("cursorArgument", () => {
  it("is null on the first page", () => {
    expect(cursorArgument("")).toBeNull()
  })

  it("decodes a cursor into the object the database expects", () => {
    const encoded = Buffer.from(JSON.stringify({ v: "1", t: "2", id: "x", s: "newest" })).toString("base64url")

    expect(cursorArgument(encoded)).toEqual({ v: "1", t: "2", id: "x", s: "newest" })
  })

  it("is null for a cursor that does not decode", () => {
    expect(cursorArgument("not-json")).toBeNull()
  })
})

describe("getMarketplaceCategories", () => {
  it("returns the categories in the camelCase the components use", async () => {
    const categories = await getMarketplaceCategories(
      deps(ok([{ slug: "education", name: "Education", product_count: 3 }])),
    )

    expect(categories).toEqual([{ slug: "education", name: "Education", productCount: 3 }])
  })

  it("answers null when the read fails", async () => {
    expect(await getMarketplaceCategories(deps(async () => ({ data: null, error: { message: "x" } })))).toBeNull()
  })

  it("answers null for a malformed answer", async () => {
    expect(await getMarketplaceCategories(deps(ok({ slug: "education" })))).toBeNull()
  })
})

describe("getRelatedProducts", () => {
  it("asks for at most four, for one product", async () => {
    const rpc = vi.fn(async () => ({ data: [PRODUCT], error: null }))

    const related = await getRelatedProducts(PRODUCT.product_id, deps(rpc as unknown as Rpc))

    expect(rpc).toHaveBeenCalledWith("public_product_related", {
      p_product: PRODUCT.product_id,
      p_limit: 4,
    })
    expect(related).toHaveLength(1)
  })

  it("answers null when the read fails", async () => {
    expect(await getRelatedProducts(PRODUCT.product_id, deps(ok("nope")))).toBeNull()
  })
})

describe("getStorePage", () => {
  const STORE = {
    vendor_name: "Ada Digital",
    vendor_slug: "ada-digital",
    product_count: 3,
    items: [PRODUCT],
    next_cursor: null,
  }

  it("returns a store", async () => {
    const store = await getStorePage("ada-digital", "", deps(ok(STORE)))

    expect(store?.vendorName).toBe("Ada Digital")
    expect(store?.productCount).toBe(3)
    expect(store?.nextCursor).toBeNull()
  })

  it("answers null for a store the database refuses", async () => {
    expect(await getStorePage("chidi-co", "", deps(ok(null)))).toBeNull()
  })

  it("answers null when the read fails", async () => {
    expect(await getStorePage("ada-digital", "", deps(async () => ({ data: null, error: { message: "x" } })))).toBeNull()
  })

  it("answers null for a malformed store", async () => {
    expect(await getStorePage("ada-digital", "", deps(ok({ ...STORE, product_count: -1 })))).toBeNull()
  })
})

describe("getSitemapEntries", () => {
  it("returns products, categories and stores", async () => {
    const entries = await getSitemapEntries(
      deps(
        ok({
          products: [{ slug: "keto-diet-guide", updated_at: "2026-11-20T09:00:00Z" }],
          categories: ["education"],
          stores: ["ada-digital"],
        }),
      ),
    )

    expect(entries).toEqual({
      products: [{ slug: "keto-diet-guide", updatedAt: "2026-11-20T09:00:00Z" }],
      categories: ["education"],
      stores: ["ada-digital"],
    })
  })

  it("answers null when the read fails", async () => {
    expect(await getSitemapEntries(deps(async () => ({ data: null, error: { message: "x" } })))).toBeNull()
  })
})

describe("getProductStoreSlug", () => {
  const load = (row: unknown) => ({ loadStoreSlug: async () => row })

  it("returns the vendor's handle", async () => {
    expect(await getProductStoreSlug(PRODUCT.product_id, load({ vendor_profiles: { slug: "ada-digital" } }))).toBe(
      "ada-digital",
    )
  })

  it("answers null when the row is missing", async () => {
    expect(await getProductStoreSlug(PRODUCT.product_id, load(null))).toBeNull()
  })

  it("answers null for a handle the database would never store", async () => {
    expect(await getProductStoreSlug(PRODUCT.product_id, load({ vendor_profiles: { slug: "Not A Slug" } }))).toBeNull()
    expect(await getProductStoreSlug(PRODUCT.product_id, load({ vendor_profiles: { slug: "" } }))).toBeNull()
    expect(await getProductStoreSlug(PRODUCT.product_id, load({ vendor_profiles: {} }))).toBeNull()
  })

  it("answers null when the loader throws", async () => {
    expect(
      await getProductStoreSlug(PRODUCT.product_id, {
        loadStoreSlug: async () => {
          throw new Error("x")
        },
      }),
    ).toBeNull()
  })
})
