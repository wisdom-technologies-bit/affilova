import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { StoreView, type StoreResult } from "@/components/marketplace/store-view"
import { appUrl } from "@/lib/identity/app-urls"
import { cardImage, cloudNameOrNull } from "@/lib/marketplace/images"
import {
  buildMarketplaceHref,
  cleanVendorSlug,
  parseMarketplaceQuery,
  type RawSearchParams,
} from "@/lib/marketplace/params"
import { getStorePage } from "@/lib/marketplace/queries"

// A vendor's storefront: /store/<slug> on the public host.
//
// The database function answers null for a vendor that is suspended, unknown, or
// has nothing live, and all three become the same 404. The page therefore never
// reveals whether a store exists but is closed.
//
// The vendor's business name is public. Their email address, phone number and
// account are not, and none of them is read here.

export const revalidate = 300

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<RawSearchParams>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = cleanVendorSlug(rawSlug)

  if (slug === "") {
    return { title: "Store not found", robots: { index: false, follow: false } }
  }

  const page = await getStorePage(slug, "")

  if (page === null) {
    return { title: "Store not found", robots: { index: false, follow: false } }
  }

  const canonical = appUrl("public", `/store/${page.vendorSlug}`)
  const noun = page.productCount === 1 ? "product" : "products"

  return {
    title: `${page.vendorName} | Affilova`,
    description: `${page.vendorName} sells ${page.productCount} live ${noun} on Affilova, priced in naira.`,
    alternates: { canonical },
    robots: { index: true, follow: true },
  }
}

export default async function StorePage({ params, searchParams }: PageProps) {
  const { slug: rawSlug } = await params
  const slug = cleanVendorSlug(rawSlug)

  if (slug === "") {
    notFound()
  }

  const { cursor } = parseMarketplaceQuery(await searchParams)
  const page = await getStorePage(slug, cursor)

  if (page === null) {
    notFound()
  }

  const cloudName = cloudNameOrNull()

  const result: StoreResult = {
    kind: "loaded",
    page,
    items: page.items.map((item) => ({ item, image: cardImage(item.coverPublicId, cloudName) })),
    nextHref:
      page.nextCursor === null
        ? null
        : buildMarketplaceHref({
            basePath: `/store/${page.vendorSlug}`,
            query: { cursor: page.nextCursor },
          }),
  }

  return <StoreView result={result} />
}
