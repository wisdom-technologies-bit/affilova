"use client"

import Link from "next/link"
import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import { getMyOrdersAction } from "@/lib/account/actions"
import {
  isDownloadable,
  orderStatusLabel,
  type OrderSummary,
  type Page,
} from "@/lib/account/types"
import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// The buyer's purchases, one page at a time.
//
// The table holds what was bought, when, in what state and for how much, with one
// button that goes to the purchase itself. On a phone the same rows become cards.
// A status is a word and an icon, never a colour on its own.

export function PurchasesScreen({
  initialPage,
  initialError = null,
  loading = false,
}: {
  initialPage: Page<OrderSummary>
  initialError?: string | null
  /** True while the first page is still on its way. */
  loading?: boolean
}) {
  const [items, setItems] = useState<OrderSummary[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function loadMore(): Promise<void> {
    if (cursor === null || working) {
      return
    }

    setWorking(true)
    setError(null)

    const result = await getMyOrdersAction({ limit: 20, cursor })

    if (result.ok) {
      setItems((current) => [...current, ...result.data.items])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  if (loading) {
    return <SkeletonRows rows={4} label="Loading your purchases" />
  }

  if (error !== null && items.length === 0) {
    return <ErrorNotice message={error} />
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-ink">You have not bought anything yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          When you buy a product, it appears here with its files and its receipt.
        </p>
        <p className="mt-3">
          <Link
            href="/products"
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Browse products
          </Link>
        </p>
      </div>
    )
  }

  const columns: readonly Column<OrderSummary>[] = [
    {
      key: "purchase",
      header: "Purchase",
      render: (order) => (
        <span className="text-brand-ink">
          {order.productTitle}
          <span className="block text-xs font-normal text-muted-foreground">{order.number}</span>
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (order) => formatLagosDate(order.paidAt ?? order.createdAt),
    },
    {
      key: "status",
      header: "Status",
      render: (order) => (
        <span className="inline-flex items-center gap-2">
          <StatusPill status={pillStatus(order.status)} label={orderStatusLabel(order.status)} />
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      render: (order) => formatNaira(order.totalKobo),
    },
    {
      key: "action",
      header: "Files",
      align: "end",
      render: (order) => (
        <Link
          href={`/purchases/${order.orderId}`}
          className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          {isDownloadable(order.status) ? "Download" : "View"}
        </Link>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {error === null ? null : <ErrorNotice message={error} />}

      <DataTable
        caption="Your purchases"
        columns={columns}
        rows={items}
        rowKey={(order) => order.orderId}
        emptyMessage="You have not bought anything yet."
      />

      <div className="flex items-center gap-3">
        {cursor === null ? null : (
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            disabled={working}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {working ? "Loading…" : "Load more"}
          </button>
        )}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {working ? "Loading more purchases" : ""}
        </p>
      </div>
    </div>
  )
}
