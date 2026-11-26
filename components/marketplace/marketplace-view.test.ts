import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { PublicProduct } from "@/lib/catalog/public"
import { EMPTY_QUERY, type MarketplaceQuery } from "@/lib/marketplace/params"
import type { MarketplaceCategory, MarketplaceItem, StorePage } from "@/lib/marketplace/types"

import { MarketplaceView, type MarketplaceResult } from "./marketplace-view"
import { StoreView } from "./store-view"
import { SearchLimited } from "./search-limited"

const ITEM: MarketplaceItem = {
  productId: "a1000000-0000-4000-8000-000000000001",
  slug: "keto-diet-guide",
  title: "Keto Diet Guide",
  shortDescription: "A practical guide to a ketogenic diet.",
  coverPublicId: "affilova/keto/cover",
  priceKobo: 150_050,
  compareAtPriceKobo: null,
  categorySlug: "education",
  categoryName: "Education",
  vendorName: "Ada Digital",
  vendorSlug: "ada-digital",
}

const SECOND: MarketplaceItem = {
  ...ITEM,
  productId: "a1000000-0000-4000-8000-000000000002",
  slug: "pasta-masterclass",
  title: "Pasta Masterclass",
  priceKobo: 200_000,
  compareAtPriceKobo: 300_000,
  vendorName: "Bola Studio",
  vendorSlug: "bola-studio",
}

const IMAGE = {
  src: "https://res.cloudinary.com/demo/image/upload/c_fill,f_auto,q_auto,w_640/affilova/keto/cover",
  srcSet:
    "https://res.cloudinary.com/demo/image/upload/c_fill,f_auto,q_auto,w_320/affilova/keto/cover 320w, https://res.cloudinary.com/demo/image/upload/c_fill,f_auto,q_auto,w_480/affilova/keto/cover 480w, https://res.cloudinary.com/demo/image/upload/c_fill,f_auto,q_auto,w_640/affilova/keto/cover 640w",
  sizes: "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw",
}

const CATEGORIES: MarketplaceCategory[] = [
  { slug: "education", name: "Education", productCount: 3 },
  { slug: "software", name: "Software", productCount: 2 },
]

function query(overrides: Partial<MarketplaceQuery> = {}): MarketplaceQuery {
  return { ...EMPTY_QUERY, ...overrides }
}

function loaded(overrides: Partial<Extract<MarketplaceResult, { kind: "loaded" }>> = {}): MarketplaceResult {
  return {
    kind: "loaded",
    items: [{ item: ITEM, image: IMAGE }],
    total: 1,
    nextCursor: null,
    ...overrides,
  }
}

function marketplace(result: MarketplaceResult, overrides: Partial<Parameters<typeof MarketplaceView>[0]> = {}) {
  return renderToString(
    createElement(MarketplaceView, {
      title: "Marketplace",
      basePath: "/marketplace",
      query: query(),
      categories: CATEGORIES,
      showCategory: true,
      result,
      ...overrides,
    }),
  )
}

describe("MarketplaceView", () => {
  it("has exactly one h1", () => {
    const html = marketplace(loaded())

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Marketplace")
  })

  it("renders a card per product, with its title, vendor and price", () => {
    const html = marketplace(loaded({ items: [{ item: ITEM, image: IMAGE }, { item: SECOND, image: null }], total: 2 }))

    expect(html).toContain("Keto Diet Guide")
    expect(html).toContain("Pasta Masterclass")
    expect(html).toContain("Ada Digital")
    expect(html).toContain("/store/ada-digital")
    expect(html).toContain("₦1,500.50")
    expect(html).toContain("₦2,000")
  })

  it("shows a compare-at price struck through only when it is present", () => {
    const withCompare = marketplace(loaded({ items: [{ item: SECOND, image: null }] }))
    const withoutCompare = marketplace(loaded())

    expect(withCompare).toContain("line-through")
    expect(withCompare).toContain("was ")
    expect(withCompare).toContain("₦3,000")
    expect(withoutCompare).not.toContain("line-through")
  })

  it("offers three image widths and lazy-loads everything below the first row", () => {
    const html = marketplace(loaded())

    expect(html).toContain("320w")
    expect(html).toContain("480w")
    expect(html).toContain("640w")
    expect(html).toContain('sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"')
    expect(html).toContain('width="640"')
    expect(html).toContain('height="480"')
    expect(html).toContain('loading="eager"')
  })

  it("lazy-loads cards after the first three", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      item: { ...ITEM, productId: `a1000000-0000-4000-8000-00000000000${index}`, slug: `product-${index}` },
      image: IMAGE,
    }))

    const html = marketplace(loaded({ items, total: 5 }))

    expect((html.match(/loading="eager"/g) ?? []).length).toBe(3)
    expect((html.match(/loading="lazy"/g) ?? []).length).toBe(2)
  })

  it("announces the result count in a live region", () => {
    const html = marketplace(loaded({ total: 7 }))

    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("7 products")
  })

  it("offers a search form that works without JavaScript", () => {
    const html = marketplace(loaded())

    expect(html).toContain('method="get"')
    expect(html).toContain('action="/marketplace"')
    expect(html).toContain('role="search"')
    expect(html).toContain('name="q"')
    expect(html).toContain("Search products")
  })

  it("offers the filters in a collapsible panel and in a sidebar", () => {
    const html = marketplace(loaded())

    expect(html).toContain("<details")
    expect(html).toContain("Filters and sorting")
    expect((html.match(/name="sort"/g) ?? []).length).toBe(2)
    expect((html.match(/name="min"/g) ?? []).length).toBe(2)
    expect((html.match(/name="category"/g) ?? []).length).toBe(2)
    expect(html).toContain('<option value="education">Education</option>')
  })

  it("hides the category select on a category page", () => {
    const html = marketplace(loaded(), { showCategory: false, basePath: "/marketplace/education", title: "Education" })

    expect(html).not.toContain('name="category"')
  })

  it("links to the next page with the cursor", () => {
    const html = marketplace(loaded({ nextCursor: "abc123" }))

    expect(html).toContain("/marketplace?cursor=abc123")
    expect(html).toContain(">Next<")
  })

  it("has no next link on the last page", () => {
    expect(marketplace(loaded({ nextCursor: null }))).not.toContain("cursor=")
  })

  it("shows an honest empty state with a way out when filters are set", () => {
    const html = marketplace(loaded({ items: [], total: 0 }), { query: query({ q: "nothing" }) })

    expect(html).toContain("No products match these filters")
    expect(html).toContain("Clear filters")
    expect(html).toContain('href="/marketplace"')
    expect(html).toContain("No products found")
  })

  it("shows a different empty state when nothing is listed at all", () => {
    const html = marketplace(loaded({ items: [], total: 0 }))

    expect(html).toContain("No products are listed yet")
    expect(html).not.toContain("No products match these filters")
  })

  it("shows an error state, not an empty one, when the read failed", () => {
    const html = marketplace({ kind: "error" })

    expect(html).toContain('role="alert"')
    expect(html).toContain("The marketplace could not be loaded")
    expect(html).not.toContain("No products match these filters")
  })

  it("keeps the search when the filters are applied", () => {
    const html = marketplace(loaded(), { query: query({ q: "keto" }) })

    expect(html).toContain('type="hidden" name="q" value="keto"')
  })

  it("shows the filters a person set back to them", () => {
    const html = marketplace(loaded(), { query: query({ minKobo: 150_000, maxKobo: 250_050, sort: "price_low" }) })

    expect(html).toContain('value="1500"')
    expect(html).toContain('value="2500.50"')
    expect(html).toContain('<option value="price_low" selected="">Price: low to high</option>')
  })

  it("renders a child row under the grid", () => {
    const html = renderToString(
      createElement(
        MarketplaceView,
        {
          title: "Marketplace",
          basePath: "/marketplace",
          query: query(),
          categories: CATEGORIES,
          showCategory: true,
          result: loaded(),
        },
        createElement("p", null, "a related row"),
      ),
    )

    expect(html).toContain("a related row")
  })
})

describe("StoreView", () => {
  const PAGE: StorePage = {
    vendorName: "Ada Digital",
    vendorSlug: "ada-digital",
    productCount: 1,
    items: [ITEM],
    nextCursor: null,
  }

  it("puts the business name in the single h1 and the count under it", () => {
    const html = renderToString(createElement(StoreView, { result: { kind: "loaded", page: PAGE, items: [{ item: ITEM, image: IMAGE }], nextHref: null } }))

    // React separates adjacent text nodes in SSR, so the comments come out
    // before the sentence is compared.
    const text = html.replace(/<!-- -->/g, "")

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(text).toContain("Ada Digital")
    expect(text).toContain("1 live product from this vendor")
    expect(text).toContain("Keto Diet Guide")
  })

  it("carries no contact details", () => {
    const html = renderToString(createElement(StoreView, { result: { kind: "loaded", page: PAGE, items: [{ item: ITEM, image: IMAGE }], nextHref: null } }))

    expect(html).not.toContain("mailto:")
    expect(html).not.toContain("@example.com")
    expect(html).not.toContain("tel:")
  })

  it("links to the next page", () => {
    const html = renderToString(
      createElement(StoreView, {
        result: { kind: "loaded", page: PAGE, items: [{ item: ITEM, image: IMAGE }], nextHref: "/store/ada-digital?cursor=xyz" },
      }),
    )

    expect(html).toContain("/store/ada-digital?cursor=xyz")
  })

  it("shows an error state", () => {
    const html = renderToString(createElement(StoreView, { result: { kind: "error" } }))

    expect(html).toContain("The marketplace could not be loaded")
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
  })
})

describe("SearchLimited", () => {
  it("says what happened and offers the unlimited listing", () => {
    const html = renderToString(createElement(SearchLimited, { basePath: "/marketplace" }))

    expect(html).toContain("Too many searches")
    expect(html).toContain("Please wait a minute")
    expect(html).toContain('href="/marketplace"')
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
  })
})

// A product page's additions, rendered through the same components the page uses.
describe("product page additions", () => {
  const PRODUCT: PublicProduct = {
    id: ITEM.productId,
    slug: ITEM.slug,
    title: ITEM.title,
    shortDescription: ITEM.shortDescription,
    description: "Long description",
    priceKobo: ITEM.priceKobo,
    categoryName: "Education",
    vendorBusinessName: "Ada Digital",
    images: [],
    fileCount: 0,
    fileTypes: [],
    refundWindowHours: 24,
    publishedAt: "2026-11-20T09:00:00Z",
  }

  it("renders the breadcrumb trail with the current page marked", async () => {
    const { ProductBreadcrumbs } = await import("@/components/commerce/product-breadcrumbs")

    const html = renderToString(
      createElement(ProductBreadcrumbs, {
        crumbs: [
          { label: "Marketplace", href: "/marketplace" },
          { label: "Education", href: "/marketplace/education" },
          { label: "Keto Diet Guide" },
        ],
      }),
    )

    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/marketplace"')
    expect(html).toContain('href="/marketplace/education"')
    expect(html).toContain('aria-current="page"')
  })

  it("renders nothing for an empty trail", async () => {
    const { ProductBreadcrumbs } = await import("@/components/commerce/product-breadcrumbs")

    expect(renderToString(createElement(ProductBreadcrumbs, { crumbs: [] }))).toBe("")
  })

  it("renders the related row, and nothing when it is empty", async () => {
    const { RelatedProducts } = await import("@/components/commerce/related-products")

    const withItems = renderToString(createElement(RelatedProducts, { items: [{ item: SECOND, image: null }] }))

    expect(withItems).toContain("Related products")
    expect(withItems).toContain("Pasta Masterclass")
    expect(renderToString(createElement(RelatedProducts, { items: [] }))).toBe("")
  })

  it("puts the additions into the product page without touching the buy box", async () => {
    const { ProductView } = await import("@/components/commerce/product-view")
    const { RelatedProducts } = await import("@/components/commerce/related-products")

    const html = renderToString(
      createElement(ProductView, {
        product: PRODUCT,
        testMode: false,
        breadcrumbs: [{ label: "Marketplace", href: "/marketplace" }, { label: PRODUCT.title }],
        vendorHref: "/store/ada-digital",
        related: createElement(RelatedProducts, { items: [{ item: SECOND, image: null }] }),
      }),
    )

    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/store/ada-digital"')
    expect(html).toContain("Sold by")
    expect(html).toContain("Related products")
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
  })
})
