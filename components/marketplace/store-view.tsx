import Link from "next/link"

import type { StorePage } from "@/lib/marketplace/types"

import { CARD_FOCUS } from "./product-card"
import { ErrorState, NextPage, ProductGrid, type GridItem } from "./product-grid"

// One vendor's storefront, without the database.
//
// The business name is the h1 and the only identity on the page. There is no
// email address, no phone number and no "message the vendor": the storefront is
// a shelf, and a buyer reaches the vendor through the platform.

export type StoreResult =
  | { kind: "loaded"; page: StorePage; items: GridItem[]; nextHref: string | null }
  | { kind: "error" }

export interface StoreViewProps {
  result: StoreResult
}

export function StoreView({ result }: StoreViewProps) {
  if (result.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Store</h1>
        <div className="mt-8">
          <ErrorState retryHref="/marketplace" />
        </div>
      </main>
    )
  }

  const { page, items, nextHref } = result
  const noun = page.productCount === 1 ? "product" : "products"

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="max-w-prose">
        <p className="text-sm text-muted-foreground">
          <Link href="/marketplace" className={`${CARD_FOCUS} hover:underline`}>
            Marketplace
          </Link>
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {page.vendorName}
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          {page.productCount} live {noun} from this vendor. Prices are in naira.
        </p>
      </header>

      <div className="mt-8">
        <ProductGrid items={items} />
      </div>

      {nextHref === null ? null : <NextPage href={nextHref} />}
    </main>
  )
}
