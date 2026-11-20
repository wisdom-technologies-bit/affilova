import { PageHeader } from "@/components/app-shell/page-header"
import { MarketplaceBrowser } from "@/components/affiliate/marketplace-browser"
import type { MarketplaceFilters } from "@/components/affiliate/marketplace-browser"
import { getCategoriesAction, getMarketplaceAction } from "@/lib/affiliate/read-actions"
import type { CategoryOption, MarketplaceItem, MarketplaceSort, Page } from "@/lib/affiliate/read-types"
import { getCloudinaryEnv } from "@/lib/env"
import { firstParam, type SearchParams } from "@/lib/dates/range-params"

// The marketplace. The first page is rendered here; the filter bar and "Load
// more" ask the server again from the client.
//
// The filters live in the address bar too, so a filtered marketplace can be
// bookmarked. The form itself is client-side, so submitting does not reload the
// whole page.

const SORTS: readonly MarketplaceSort[] = ["newest", "commission", "price_low", "price_high"]

function readSort(value: string | undefined): MarketplaceSort {
  return SORTS.find((sort) => sort === value) ?? "newest"
}

function readMinCommission(value: string | undefined): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 8000 ? parsed : 0
}

function cloudName(): string | null {
  try {
    return getCloudinaryEnv().CLOUDINARY_CLOUD_NAME
  } catch {
    return null
  }
}

export default async function AffiliateMarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const filters: MarketplaceFilters = {
    q: firstParam(params, "q")?.slice(0, 80) ?? "",
    category: firstParam(params, "category")?.slice(0, 60) ?? "",
    minCommissionBps: readMinCommission(firstParam(params, "min")),
    sort: readSort(firstParam(params, "sort")),
  }

  const [marketplaceResult, categoriesResult] = await Promise.all([
    getMarketplaceAction({
      q: filters.q === "" ? undefined : filters.q,
      category: filters.category === "" ? undefined : filters.category,
      minCommissionBps: filters.minCommissionBps === 0 ? undefined : filters.minCommissionBps,
      sort: filters.sort,
      limit: 20,
    }),
    getCategoriesAction(),
  ])

  const initialPage: Page<MarketplaceItem> = marketplaceResult.ok
    ? marketplaceResult.data
    : { items: [], nextCursor: null }
  const categories: CategoryOption[] = categoriesResult.ok ? categoriesResult.data : []

  return (
    <>
      <PageHeader title="Marketplace" />
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Products from vendors who work with affiliates. Choose Get link on a product you may
        promote, or ask the vendor for access.
      </p>
      <MarketplaceBrowser
        initialPage={initialPage}
        initialError={marketplaceResult.ok ? null : marketplaceResult.error}
        initialFilters={filters}
        categories={categories}
        cloudName={cloudName()}
      />
    </>
  )
}
