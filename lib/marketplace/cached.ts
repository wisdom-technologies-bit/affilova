import "server-only"

import { unstable_cache } from "next/cache"

import { EMPTY_QUERY } from "./params"
import { getMarketplaceCategories, getMarketplacePage, getSitemapEntries } from "./queries"

// The cache in front of the reads that do not depend on the URL.
//
// The plain listing, the category index and the sitemap change only when a
// vendor publishes or pauses something, so they are revalidated every five
// minutes rather than read on every request. A filtered or searched page is
// never cached: it is the visitor's own question, and there are as many of them
// as there are visitors.
//
// The tags exist so a future publish step can call revalidateTag and have the
// change appear at once instead of within the window.

/** Five minutes, the revalidation window for the public listing. */
export const REVALIDATE_SECONDS = 300

export const PLAIN_LISTING_TAG = "marketplace:plain"
export const CATEGORIES_TAG = "marketplace:categories"
export const SITEMAP_TAG = "marketplace:sitemap"

export const getPlainMarketplacePage = unstable_cache(
  async () => getMarketplacePage(EMPTY_QUERY),
  ["marketplace-plain-listing"],
  { revalidate: REVALIDATE_SECONDS, tags: [PLAIN_LISTING_TAG] },
)

export const getCachedCategories = unstable_cache(
  async () => getMarketplaceCategories(),
  ["marketplace-categories"],
  { revalidate: REVALIDATE_SECONDS, tags: [CATEGORIES_TAG] },
)

export const getCachedCategoryPage = unstable_cache(
  async (slug: string) => getMarketplacePage({ ...EMPTY_QUERY, category: slug }),
  ["marketplace-category-page"],
  { revalidate: REVALIDATE_SECONDS, tags: [PLAIN_LISTING_TAG] },
)

export const getCachedSitemapEntries = unstable_cache(
  async () => getSitemapEntries(),
  ["marketplace-sitemap"],
  { revalidate: REVALIDATE_SECONDS, tags: [SITEMAP_TAG] },
)
