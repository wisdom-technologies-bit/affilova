"use client"

import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { getVendorSalesAction } from "@/lib/merchant/actions"
import { saleStatusLabel, type Page, type VendorSaleRow } from "@/lib/merchant/types"

// The vendor's sales, one page at a time.
//
// The table holds the order, what sold, when, in what state, the gross and the
// vendor's own share, with a small "via affiliate" tag when the order came
// through a link. There is no buyer name and no buyer email anywhere: a vendor
// sees what sold, never who bought.
//
// On a phone the same rows become cards.

export function SalesView({
  initialPage,
  initialError = null,
  status,
}: {
  initialPage: Page<VendorSaleRow>
  initialError?: string | null
  status: string | null
}) {
  const [items, setItems] = useState<VendorSaleRow[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function loadMore(): Promise<void> {
    if (cursor === null || working) {
      return
    }

    setWorking(true)
    setError(null)

    const result = await getVendorSalesAction({
      status: status ?? undefined,
      limit: 20,
      cursor,
    })

    if (result.ok) {
      setItems((current) => [...current, ...result.data.items])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  if (error !== null && items.length === 0) {
    return <ErrorNotice message={error} />
  }

  const columns: readonly Column<VendorSaleRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (sale) => (
        <span className="text-brand-ink">
          {sale.orderNumber}
          <span className="block text-xs font-normal text-muted-foreground">
            {sale.productTitle}
            {sale.viaAffiliate ? " · via affiliate" : ""}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      header: "Paid",
      render: (sale) => (sale.paidAt === null ? "Not paid" : formatLagosDate(sale.paidAt)),
    },
    {
      key: "status",
      header: "Status",
      render: (sale) => (
        <StatusPill status={pillStatus(sale.status)} label={saleStatusLabel(sale.status)} />
      ),
    },
    {
      key: "gross",
      header: "Gross",
      align: "end",
      render: (sale) => formatNaira(sale.grossKobo),
    },
    {
      key: "net",
      header: "Your earnings",
      align: "end",
      render: (sale) => formatNaira(sale.vendorNetKobo),
    },
    {
      key: "affiliate",
      header: "Source",
      card: false,
      render: (sale) => (sale.viaAffiliate ? "Affiliate link" : "Direct"),
    },
  ]

  return (
    <div className="space-y-4">
      {error === null ? null : <ErrorNotice message={error} />}

      <DataTable
        caption="Your sales"
        columns={columns}
        rows={items}
        rowKey={(sale) => `${sale.orderNumber}-${sale.productTitle}`}
        emptyMessage="No sales in this view yet."
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
          {working ? "Loading more sales" : ""}
        </p>
      </div>
    </div>
  )
}

/** The loading shape, used while a first page is on its way. */
export function SalesLoading() {
  return <SkeletonRows rows={4} label="Loading your sales" />
}
