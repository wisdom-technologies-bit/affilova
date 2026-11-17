"use client"

import Link from "next/link"
import { useState } from "react"

import { listVendorProductsAction } from "@/lib/catalog/actions/vendor"
import type { ProductSummary } from "@/lib/catalog/action-types"
import {
  formatLagosDate,
  PRODUCT_STATUS_TABS,
  type StatusTab,
} from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { StatusBadge } from "@/components/catalog/status-badge"

// The vendor's product list: tabs by status, a table on a wide screen, cards on
// a narrow one, and a "Load more" that appends the next cursor page.
//
// The first page is rendered on the server and handed in, so the list is real
// content in the HTML rather than a spinner. Load more is the only thing that
// asks the server again.

const EMPTY: Record<StatusTab, string> = {
  all: "You have not created a product yet.",
  draft: "No drafts.",
  submitted: "No products are waiting for review.",
  live: "Nothing is live yet.",
  paused: "No paused products.",
  rejected: "No rejected products.",
  archived: "Nothing archived.",
}

function tabHref(tab: StatusTab): string {
  return tab === "all" ? "/products" : `/products?status=${tab}`
}

export function ProductList({
  status,
  initialItems,
  initialCursor,
  initialError = null,
}: {
  status: StatusTab
  initialItems: readonly ProductSummary[]
  initialCursor: string | null
  initialError?: string | null
}) {
  const [items, setItems] = useState<ProductSummary[]>([...initialItems])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) {
      return
    }

    setLoading(true)
    setError(null)

    const result = await listVendorProductsAction({
      cursor,
      ...(status === "all" ? {} : { status }),
    })

    if (result.ok) {
      setItems((current) => [...current, ...result.items])
      setCursor(result.nextCursor)
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Product status">
        <ul className="flex flex-wrap gap-1 border-b border-border pb-1">
          {PRODUCT_STATUS_TABS.map((tab) => {
            const current = tab.value === status

            return (
              <li key={tab.value}>
                <Link
                  href={tabHref(tab.value)}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center rounded-t-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                    current
                      ? "border-b-2 border-brand-600 font-medium text-brand-ink"
                      : "border-b-2 border-transparent text-muted-foreground hover:text-brand-ink"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-md border border-border px-6 py-10 text-center">
          <p className="text-sm text-brand-ink">{EMPTY[status]}</p>
          {status === "all" ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <Link
                href="/products/new"
                className="font-medium text-brand-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Create your first product
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {/* Wide screens: one dense row per product. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Your products, newest first</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Product
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Price
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr key={product.id} className="border-b border-border align-middle">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      <Link
                        href={`/products/${product.id}`}
                        className="inline-flex min-h-[44px] items-center text-brand-ink underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      >
                        {product.title}
                      </Link>
                    </th>
                    <td className="py-3 pr-4">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-brand-ink">{formatNaira(product.priceKobo)}</td>
                    <td className="py-3 text-muted-foreground">{formatLagosDate(product.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow screens: the same facts as cards. */}
          <ul className="space-y-3 md:hidden">
            {items.map((product) => (
              <li key={product.id} className="rounded-md border border-border p-4">
                <Link
                  href={`/products/${product.id}`}
                  className="block min-h-[44px] text-sm font-medium text-brand-ink underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  {product.title}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <StatusBadge status={product.status} />
                  <span className="text-sm tabular-nums text-brand-ink">{formatNaira(product.priceKobo)}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Updated {formatLagosDate(product.updatedAt)}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {cursor === null ? null : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
