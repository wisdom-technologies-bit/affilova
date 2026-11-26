import type { Metadata } from "next"
import { headers } from "next/headers"

import { MarketplaceView, type MarketplaceResult } from "@/components/marketplace/marketplace-view"
import { SearchLimited } from "@/components/marketplace/search-limited"
import { appUrl } from "@/lib/identity/app-urls"
import { getCachedCategories, getPlainMarketplacePage } from "@/lib/marketplace/cached"
import { cardImage, cloudNameOrNull } from "@/lib/marketplace/images"
import { isFiltered, parseMarketplaceQuery, type RawSearchParams } from "@/lib/marketplace/params"
import { getMarketplacePage } from "@/lib/marketplace/queries"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"

// The public marketplace: /marketplace on the public host.
//
// The plain listing is the same twelve products for everybody, so it is cached
// for five minutes. Anything with a query, a filter, a sort or a cursor is the
// visitor's own question and is read fresh.
//
// Only the plain listing is indexable. Every filtered view is noindex, follow,
// with a canonical pointing at /marketplace: they are the same products in a
// different order, and indexing each combination would bury the real pages.

export const revalidate = 300

const SEARCH_LIMIT = 120
const SEARCH_WINDOW_SECONDS = 60

interface PageProps {
  searchParams: Promise<RawSearchParams>
}

function canonical(): string {
  return appUrl("public", "/marketplace")
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const query = parseMarketplaceQuery(await searchParams)
  const filtered = isFiltered(query)

  return {
    title: filtered ? "Marketplace search | Affilova" : "Marketplace | Affilova",
    description:
      "Browse live digital products from independent vendors on Affilova. Every price is in naira.",
    alternates: { canonical: canonical() },
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
  }
}

/**
 * Count one search for this address.
 *
 * A database hiccup answers "allowed" (the limiter's onError policy), because a
 * marketplace that locks people out when the counter is unreachable is worse
 * than one that briefly counts nothing.
 */
async function searchAllowed(): Promise<boolean> {
  const headerList = await headers()

  const result = await rateLimit({
    key: rateLimitKey(["marketplace-search", clientIpFromHeaders(headerList)]),
    limit: SEARCH_LIMIT,
    windowSeconds: SEARCH_WINDOW_SECONDS,
    onError: "allow",
  })

  return result.allowed
}

export default async function MarketplacePage({ searchParams }: PageProps) {
  const query = parseMarketplaceQuery(await searchParams)

  if (query.q !== "" && !(await searchAllowed())) {
    return <SearchLimited basePath="/marketplace" />
  }

  const [categories, page] = await Promise.all([
    getCachedCategories(),
    isFiltered(query) ? getMarketplacePage(query) : getPlainMarketplacePage(),
  ])

  const cloudName = cloudNameOrNull()

  const result: MarketplaceResult =
    page === null
      ? { kind: "error" }
      : {
          kind: "loaded",
          items: page.items.map((item) => ({ item, image: cardImage(item.coverPublicId, cloudName) })),
          total: page.total,
          nextCursor: page.nextCursor,
        }

  return (
    <MarketplaceView
      title="Marketplace"
      intro="Every live product from every active vendor on Affilova. Prices are in naira."
      basePath="/marketplace"
      query={query}
      categories={categories}
      showCategory
      result={result}
    />
  )
}
