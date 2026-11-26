import type { MetadataRoute } from "next"

import type { SitemapEntries } from "./types"

// The marketplace's share of /sitemap.xml, as a pure function.
//
// Kept apart from the route so the output can be tested without a request or a
// database: the route reads the entries and hands them here.

/** A date the sitemap can carry, or undefined when the value is not a date. */
function dateOrUndefined(value: string): Date | undefined {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? undefined : date
}

export function marketplaceSitemapEntries(
  baseUrl: string,
  entries: SitemapEntries,
): MetadataRoute.Sitemap {
  const base = baseUrl.replace(/\/+$/, "")

  const listing: MetadataRoute.Sitemap = [
    {
      url: `${base}/marketplace`,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ]

  const categories: MetadataRoute.Sitemap = entries.categories.map((slug) => ({
    url: `${base}/marketplace/${slug}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }))

  const stores: MetadataRoute.Sitemap = entries.stores.map((slug) => ({
    url: `${base}/store/${slug}`,
    changeFrequency: "weekly",
    priority: 0.6,
  }))

  const products: MetadataRoute.Sitemap = entries.products.map((product) => {
    const lastModified = dateOrUndefined(product.updatedAt)

    return {
      url: `${base}/p/${product.slug}`,
      ...(lastModified === undefined ? {} : { lastModified }),
      changeFrequency: "weekly",
      priority: 0.6,
    }
  })

  return [...listing, ...categories, ...stores, ...products]
}
