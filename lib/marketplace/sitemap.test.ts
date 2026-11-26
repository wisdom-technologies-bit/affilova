import { describe, expect, it } from "vitest"

import { marketplaceSitemapEntries } from "./sitemap"
import type { SitemapEntries } from "./types"

const ENTRIES: SitemapEntries = {
  products: [
    { slug: "keto-diet-guide", updatedAt: "2026-11-20T09:00:00.000Z" },
    { slug: "pasta-masterclass", updatedAt: "2026-11-15T09:00:00.000Z" },
  ],
  categories: ["education", "software"],
  stores: ["ada-digital"],
}

describe("marketplaceSitemapEntries", () => {
  const entries = marketplaceSitemapEntries("https://affilova.com", ENTRIES)
  const urls = entries.map((entry) => entry.url)

  it("lists the marketplace itself", () => {
    expect(urls).toContain("https://affilova.com/marketplace")
  })

  it("lists every category page", () => {
    expect(urls).toContain("https://affilova.com/marketplace/education")
    expect(urls).toContain("https://affilova.com/marketplace/software")
  })

  it("lists every store", () => {
    expect(urls).toContain("https://affilova.com/store/ada-digital")
  })

  it("lists every product with its last change", () => {
    const product = entries.find((entry) => entry.url === "https://affilova.com/p/keto-diet-guide")

    expect(product).toBeDefined()
    expect(product?.lastModified).toBeInstanceOf(Date)
    expect((product?.lastModified as Date).toISOString()).toBe("2026-11-20T09:00:00.000Z")
  })

  it("has no duplicate URLs", () => {
    expect(new Set(urls).size).toBe(urls.length)
  })

  it("does not carry a date it cannot parse", () => {
    const withBadDate = marketplaceSitemapEntries("https://affilova.com", {
      ...ENTRIES,
      products: [{ slug: "broken", updatedAt: "not a date" }],
    })

    const product = withBadDate.find((entry) => entry.url === "https://affilova.com/p/broken")

    expect(product?.lastModified).toBeUndefined()
  })

  it("does not double the slash in a base URL", () => {
    const withSlash = marketplaceSitemapEntries("https://affilova.com/", ENTRIES)

    expect(withSlash[0]?.url).toBe("https://affilova.com/marketplace")
  })

  it("is empty apart from the listing when there is nothing published", () => {
    const empty = marketplaceSitemapEntries("https://affilova.com", {
      products: [],
      categories: [],
      stores: [],
    })

    expect(empty).toHaveLength(1)
  })
})
