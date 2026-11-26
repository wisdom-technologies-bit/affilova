import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { MarketplaceView, type MarketplaceResult } from "@/components/marketplace/marketplace-view"
import { appUrl } from "@/lib/identity/app-urls"
import { getCachedCategories, getCachedCategoryPage } from "@/lib/marketplace/cached"
import { cardImage, cloudNameOrNull } from "@/lib/marketplace/images"
import {
  cleanCategory,
  isFiltered,
  parseMarketplaceQuery,
  type RawSearchParams,
} from "@/lib/marketplace/params"
import { getMarketplacePage } from "@/lib/marketplace/queries"
import type { MarketplaceCategory } from "@/lib/marketplace/types"

// One category: /marketplace/<slug> on the public host.
//
// A category page is worth indexing, so it has its own title, description and h1,
// all built from the category's own name and its live count. A category that
// does not exist, or that has nothing live in it, is the standard 404: the page
// never says "this category exists but is empty", because that is a dead end for
// a visitor and a thin page for a crawler.

export const revalidate = 300

interface PageProps {
  params: Promise<{ category: string }>
  searchParams: Promise<RawSearchParams>
}

async function categoryFor(rawSlug: string): Promise<MarketplaceCategory | null> {
  const slug = cleanCategory(rawSlug)

  if (slug === "") {
    return null
  }

  const categories = await getCachedCategories()

  if (categories === null) {
    return null
  }

  return categories.find((category) => category.slug === slug) ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: rawSlug } = await params
  const category = await categoryFor(rawSlug)

  if (category === null) {
    return { title: "Category not found", robots: { index: false, follow: false } }
  }

  const canonical = appUrl("public", `/marketplace/${category.slug}`)
  const noun = category.productCount === 1 ? "product" : "products"

  return {
    title: `${category.name} | Marketplace | Affilova`,
    description: `${category.productCount} live ${category.name} ${noun} on Affilova, priced in naira.`,
    alternates: { canonical },
    robots: { index: true, follow: true },
  }
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { category: rawSlug } = await params
  const category = await categoryFor(rawSlug)

  if (category === null) {
    notFound()
  }

  const parsed = parseMarketplaceQuery(await searchParams)
  const query = { ...parsed, category: category.slug }

  const page = isFiltered({ ...query, category: "" })
    ? await getMarketplacePage(query)
    : await getCachedCategoryPage(category.slug)

  if (page === null) {
    const errorResult: MarketplaceResult = { kind: "error" }

    return (
      <MarketplaceView
        title={category.name}
        basePath={`/marketplace/${category.slug}`}
        query={query}
        categories={null}
        showCategory={false}
        result={errorResult}
      />
    )
  }

  // An empty category is not a page: there is nothing to read, and a crawler
  // would index a title with no product under it.
  if (page.total === 0 && !isFiltered({ ...query, category: "" })) {
    notFound()
  }

  const cloudName = cloudNameOrNull()
  const noun = page.total === 1 ? "product" : "products"

  const result: MarketplaceResult = {
    kind: "loaded",
    items: page.items.map((item) => ({ item, image: cardImage(item.coverPublicId, cloudName) })),
    total: page.total,
    nextCursor: page.nextCursor,
  }

  return (
    <MarketplaceView
      title={category.name}
      intro={`${page.total} live ${noun} in ${category.name}. Prices are in naira.`}
      basePath={`/marketplace/${category.slug}`}
      query={query}
      categories={null}
      showCategory={false}
      result={result}
    />
  )
}
