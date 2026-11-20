import { DataTable, type Column } from "@/components/affiliate/data-table"
import { formatCount } from "@/lib/affiliate/definitions"
import type { VendorAffiliateRow } from "@/lib/affiliate/read-types"
import { formatNaira } from "@/lib/catalog/money"

// How each affiliate did on the vendor's products, ordered by revenue.
//
// Revenue is what buyers paid; commission is what the affiliate earned from it.
// Both are shown so the vendor can see the cost of the programme beside what it
// brought in.

export function PerformanceTable({ rows }: { rows: readonly VendorAffiliateRow[] }) {
  const columns: readonly Column<VendorAffiliateRow>[] = [
    {
      key: "affiliate",
      header: "Affiliate",
      render: (row) => <span className="text-brand-ink">{row.username}</span>,
    },
    { key: "clicks", header: "Clicks", align: "end", render: (row) => formatCount(row.clicks) },
    {
      key: "unique",
      header: "Unique clicks",
      align: "end",
      render: (row) => formatCount(row.uniqueClicks),
    },
    { key: "orders", header: "Orders", align: "end", render: (row) => formatCount(row.orders) },
    {
      key: "revenue",
      header: "Revenue",
      align: "end",
      render: (row) => formatNaira(row.revenueKobo),
    },
    {
      key: "commission",
      header: "Commission paid",
      align: "end",
      render: (row) => formatNaira(row.commissionKobo),
    },
  ]

  return (
    <DataTable
      caption="Affiliate performance on your products, highest revenue first"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.affiliateId}
      emptyMessage="No affiliate has sold anything in these days yet."
    />
  )
}
