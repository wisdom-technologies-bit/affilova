import type { MetadataRoute } from "next"

import { LEGAL_DOCUMENTS } from "@/content/legal"
import { hostMapFromEnv } from "@/lib/hosts"
import { getSitemapEntries } from "@/lib/marketplace/queries"
import { marketplaceSitemapEntries } from "@/lib/marketplace/sitemap"

const PUBLIC_STATIC_ROUTES = [
  "/",
  "/how-it-works",
  "/about",
  "/blog",
  "/contact",
  "/products",
  "/legal",
] as const

function resolvePublicBaseUrl(): string {
  const hosts = hostMapFromEnv()
  if (hosts.public !== undefined) {
    return `https://${hosts.public}`
  }

  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (rawAppUrl !== undefined && rawAppUrl !== "") {
    return rawAppUrl.replace(/\/+$/, "")
  }

  return "https://affilova.com"
}

// The whole file is revalidated every five minutes, the same window the listing
// uses. A database read that fails leaves the rest of the sitemap intact rather
// than failing the file.
export const revalidate = 300

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = resolvePublicBaseUrl()

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_STATIC_ROUTES.map((path) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: path === "/products" || path === "/blog" ? "daily" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }))

  const legalEntries: MetadataRoute.Sitemap = LEGAL_DOCUMENTS.map((doc) => ({
    url: `${baseUrl}${doc.href}`,
    lastModified: new Date(doc.effectiveDate),
    changeFrequency: "monthly",
    priority: 0.4,
  }))

  // The marketplace: the listing, its categories, the stores and the products.
  // A read that fails leaves the rest of the sitemap intact rather than failing
  // the whole file, so a crawler still gets the pages that do not need it.
  let marketplaceEntries: MetadataRoute.Sitemap = []

  try {
    const entries = await getSitemapEntries()

    if (entries !== null) {
      marketplaceEntries = marketplaceSitemapEntries(baseUrl, entries)
    }
  } catch {
    marketplaceEntries = []
  }

  return [...staticEntries, ...legalEntries, ...marketplaceEntries]
}
