import type { ReactNode } from "react"

import type { MarketplaceCategory } from "@/lib/marketplace/types"
import { buildMarketplaceHref, isFiltered, type MarketplaceQuery } from "@/lib/marketplace/params"

import { FiltersDisclosure, FiltersSidebar, SearchForm } from "./filters"
import { EmptyState, ErrorState, NextPage, ProductGrid, ResultCount, type GridItem } from "./product-grid"

// The marketplace page, without the database.
//
// It takes a result that has already been read and checked, and renders one of
// exactly three states: a grid, an honest empty state, or an error state. The
// heading is the only h1 on the page, the count sits in an aria-live region so a
// screen reader hears it change, and every control is reachable with a keyboard.

export type MarketplaceResult =
  | { kind: "loaded"; items: GridItem[]; total: number; nextCursor: string | null }
  | { kind: "error" }

export interface MarketplaceViewProps {
  /** The h1. */
  title: string
  /** One sentence under the h1, when the page has something true to add. */
  intro?: string
  basePath: string
  query: MarketplaceQuery
  categories: MarketplaceCategory[] | null
  /** False on a category page, where the category is the page itself. */
  showCategory: boolean
  result: MarketplaceResult
  /** Rendered under the grid, for the product page's related row. */
  children?: ReactNode
}

export function MarketplaceView({
  title,
  intro,
  basePath,
  query,
  categories,
  showCategory,
  result,
  children,
}: MarketplaceViewProps) {
  const filtered = isFiltered(query)
  const clearHref = basePath

  const nextHref =
    result.kind === "loaded" && result.nextCursor !== null
      ? buildMarketplaceHref({ basePath, query: { ...query, cursor: result.nextCursor } })
      : null

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="max-w-prose">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        {intro === undefined ? null : <p className="mt-3 text-base text-muted-foreground">{intro}</p>}
      </header>

      <div className="mt-6">
        <SearchForm basePath={basePath} query={query} idPrefix="marketplace-search" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <aside className="order-1 lg:order-none" aria-label="Filters">
          <FiltersDisclosure
            basePath={basePath}
            query={query}
            categories={categories ?? []}
            showCategory={showCategory}
            idPrefix="filters-mobile"
          />
          <FiltersSidebar
            basePath={basePath}
            query={query}
            categories={categories ?? []}
            showCategory={showCategory}
            idPrefix="filters-desktop"
          />
        </aside>

        <div>
          {result.kind === "error" ? (
            <ErrorState retryHref={basePath} />
          ) : (
            <>
              <div className="mb-4">
                <ResultCount total={result.total} />
              </div>

              {result.items.length === 0 ? (
                <EmptyState clearHref={clearHref} filtered={filtered} />
              ) : (
                <ProductGrid items={result.items} />
              )}

              {nextHref === null ? null : <NextPage href={nextHref} />}
            </>
          )}
        </div>
      </div>

      {children}
    </main>
  )
}
