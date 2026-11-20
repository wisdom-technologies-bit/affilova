"use client"

import { useState } from "react"

import { AccessRequestDialog } from "@/components/affiliate/access-request-dialog"
import { LinkCreationDialog } from "@/components/affiliate/link-creation-dialog"
import { MarketplaceCard } from "@/components/affiliate/marketplace-card"
import { SkeletonCards } from "@/components/affiliate/skeletons"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getMarketplaceAction } from "@/lib/affiliate/read-actions"
import type {
  CategoryOption,
  MarketplaceItem,
  MarketplaceSort,
  Page,
} from "@/lib/affiliate/read-types"
import { productCoverUrl } from "@/lib/affiliate/media"

// The marketplace: a filter bar, a list of products, and one more page at a
// time.
//
// The first page is rendered on the server and handed in, so the list is real
// content in the HTML. Searching, filtering and "Load more" ask the server
// again; the results always say how many are shown and whether there are more.

const SORTS: readonly { value: MarketplaceSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "commission", label: "Highest commission" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
]

const MIN_COMMISSIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "Any commission" },
  { value: 1000, label: "10% or more" },
  { value: 2000, label: "20% or more" },
  { value: 3000, label: "30% or more" },
  { value: 5000, label: "50% or more" },
]

export interface MarketplaceFilters {
  q: string
  category: string
  minCommissionBps: number
  sort: MarketplaceSort
}

export function MarketplaceResults({
  items,
  cloudName,
  loading = false,
  error = null,
  hasMore = false,
  onLoadMore,
  onGetLink,
  onRequestAccess,
}: {
  items: readonly MarketplaceItem[]
  cloudName: string | null
  loading?: boolean
  error?: string | null
  hasMore?: boolean
  onLoadMore?: () => void
  onGetLink?: (item: MarketplaceItem) => void
  onRequestAccess?: (item: MarketplaceItem) => void
}) {
  if (error !== null) {
    return <ErrorNotice message={error} />
  }

  if (loading && items.length === 0) {
    return <SkeletonCards cards={4} label="Loading the marketplace" />
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-ink">No products match this search.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try a shorter search, another category, or a lower minimum commission.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {items.length} {items.length === 1 ? "product" : "products"} shown
        {hasMore ? ", more available" : ""}.
      </p>

      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <MarketplaceCard
            key={item.productId}
            item={item}
            coverUrl={productCoverUrl(item.coverPublicId, cloudName)}
            onGetLink={onGetLink}
            onRequestAccess={onRequestAccess}
          />
        ))}
      </ul>

      {loading ? <SkeletonCards cards={2} label="Loading more products" /> : null}

      {hasMore && !loading ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function MarketplaceBrowser({
  initialPage,
  initialError,
  initialFilters,
  categories,
  cloudName,
}: {
  initialPage: Page<MarketplaceItem>
  initialError: string | null
  initialFilters: MarketplaceFilters
  categories: readonly CategoryOption[]
  cloudName: string | null
}) {
  const [items, setItems] = useState<MarketplaceItem[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [applied, setApplied] = useState<MarketplaceFilters>(initialFilters)
  const [draft, setDraft] = useState<MarketplaceFilters>(initialFilters)
  const [creating, setCreating] = useState<MarketplaceItem | null>(null)
  const [requesting, setRequesting] = useState<MarketplaceItem | null>(null)

  async function run(filters: MarketplaceFilters, append: boolean, nextCursor: string | null): Promise<void> {
    setLoading(true)
    setError(null)

    const result = await getMarketplaceAction({
      q: filters.q === "" ? undefined : filters.q,
      category: filters.category === "" ? undefined : filters.category,
      minCommissionBps: filters.minCommissionBps === 0 ? undefined : filters.minCommissionBps,
      sort: filters.sort,
      limit: 20,
      cursor: append && nextCursor !== null ? nextCursor : undefined,
    })

    if (result.ok) {
      setItems((current) => (append ? [...current, ...result.data.items] : result.data.items))
      setCursor(result.data.nextCursor)
      setApplied(filters)
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run(draft, false, null)
        }}
        className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Filter the marketplace"
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="marketplace-q" className="block text-xs font-medium text-muted-foreground">
            Search
          </label>
          <input
            id="marketplace-q"
            type="search"
            value={draft.q}
            maxLength={80}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Product or description"
            className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </div>

        <div>
          <label htmlFor="marketplace-category" className="block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="marketplace-category"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-min" className="block text-xs font-medium text-muted-foreground">
            Minimum commission
          </label>
          <select
            id="marketplace-min"
            value={draft.minCommissionBps}
            onChange={(event) => setDraft({ ...draft, minCommissionBps: Number(event.target.value) })}
            className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            {MIN_COMMISSIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-sort" className="block text-xs font-medium text-muted-foreground">
            Sort
          </label>
          <select
            id="marketplace-sort"
            value={draft.sort}
            onChange={(event) => setDraft({ ...draft, sort: event.target.value as MarketplaceSort })}
            className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {loading ? "Searching…" : "Search"}
          </button>
          {applied.q === "" && applied.category === "" && applied.minCommissionBps === 0 ? null : (
            <p className="mt-2 text-xs text-muted-foreground">
              Filtered results. Clear the filters to see everything again.
            </p>
          )}
        </div>
      </form>

      <MarketplaceResults
        items={items}
        cloudName={cloudName}
        loading={loading}
        error={error}
        hasMore={cursor !== null}
        onLoadMore={() => {
          void run(applied, true, cursor)
        }}
        onGetLink={setCreating}
        onRequestAccess={setRequesting}
      />

      <LinkCreationDialog item={creating} onClose={() => setCreating(null)} />

      <AccessRequestDialog
        item={requesting}
        onClose={() => setRequesting(null)}
        onRequested={(productId) => {
          setItems((current) =>
            current.map((item) =>
              item.productId === productId ? { ...item, myAccess: "pending" } : item,
            ),
          )
        }}
      />
    </div>
  )
}
