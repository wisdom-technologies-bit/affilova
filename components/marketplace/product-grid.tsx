import Link from "next/link"

import { resultCountLabel } from "@/lib/marketplace/params"
import type { MarketplaceItem } from "@/lib/marketplace/types"

import { CARD_FOCUS, ProductCard, type CardImage } from "./product-card"

// The grid, and the three states it can be in.
//
// Loaded, empty and failed are separate components so a page cannot render a
// count without a grid, or an empty state over a failed read: the type makes the
// three exclusive.

export interface GridItem {
  item: MarketplaceItem
  image: CardImage | null
}

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"

export function ProductGrid({ items }: { items: GridItem[] }) {
  return (
    <ul className={GRID}>
      {items.map((entry, index) => (
        <li key={entry.item.productId} className="h-full">
          <ProductCard item={entry.item} image={entry.image} priority={index < 3} />
        </li>
      ))}
    </ul>
  )
}

/** The count above the grid. aria-live so a screen reader hears it change. */
export function ResultCount({ total }: { total: number }) {
  return (
    <p aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
      {resultCountLabel(0, total)}
    </p>
  )
}

export interface EmptyStateProps {
  /** Where "Clear filters" goes. */
  clearHref: string
  /** True when the person narrowed the list, which is why nothing matched. */
  filtered: boolean
}

export function EmptyState({ clearHref, filtered }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-base font-medium text-foreground">
        {filtered ? "No products match these filters" : "No products are listed yet"}
      </p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        {filtered
          ? "Try a different search, a wider price range, or another category."
          : "When a vendor publishes a product it appears here. There is nothing to show until then."}
      </p>
      {filtered ? (
        <Link
          href={clearHref}
          className={`mt-6 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted ${CARD_FOCUS}`}
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  )
}

export function ErrorState({ retryHref }: { retryHref: string }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-12 text-center">
      <p className="text-base font-medium text-foreground">The marketplace could not be loaded</p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        This is a problem on our side, not with what you searched for. Nothing was changed. Please try again.
      </p>
      <Link
        href={retryHref}
        className={`mt-6 inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted ${CARD_FOCUS}`}
      >
        Try again
      </Link>
    </div>
  )
}

export interface NextPageProps {
  href: string
  label?: string
}

/** The cursor link. A link, not a button: it is a URL and it works without JS. */
export function NextPage({ href, label = "Next" }: NextPageProps) {
  return (
    <div className="mt-8 flex justify-end">
      <Link
        href={href}
        rel="next"
        className={`inline-flex min-h-11 items-center rounded-md border border-border px-5 text-sm font-medium text-foreground hover:bg-muted ${CARD_FOCUS}`}
      >
        {label}
        <span aria-hidden="true" className="ml-2">
          →
        </span>
      </Link>
    </div>
  )
}
