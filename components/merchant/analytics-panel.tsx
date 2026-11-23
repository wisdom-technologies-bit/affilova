import { DataTable, type Column } from "@/components/affiliate/data-table"
import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { KpiCard } from "@/components/affiliate/kpi-card"
import { SkeletonKpis, SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { VendorSalesChart } from "@/components/merchant/sales-chart"
import { formatNaira } from "@/lib/catalog/money"
import type { LagosRange } from "@/lib/dates/lagos"
import { VENDOR_METRICS } from "@/lib/merchant/definitions"
import {
  formatBpsPercent,
  type VendorDailyPoint,
  type VendorOverview,
  type VendorTopProduct,
} from "@/lib/merchant/types"

// Analytics: the same range, looked at from the side.
//
// The KPI row is the range's totals, the chart is the daily shape, the table is
// every product that sold, and the last card is the affiliate share: how many of
// the orders came through an affiliate link.

export function MerchantAnalyticsPanel({
  range,
  today,
  overview,
  series,
  topProducts,
  error = null,
}: {
  range: LagosRange
  today: string
  overview: VendorOverview | null
  series: readonly VendorDailyPoint[]
  topProducts: readonly VendorTopProduct[]
  error?: string | null
}) {
  const affiliateShareBps =
    overview === null || overview.orders === 0
      ? 0
      : Math.round((overview.affiliateOrders * 10000) / overview.orders)

  const productColumns: readonly Column<VendorTopProduct>[] = [
    { key: "title", header: "Product", render: (product) => product.title },
    { key: "orders", header: "Orders", align: "end", render: (product) => String(product.orders) },
    { key: "gross", header: "Gross", align: "end", render: (product) => formatNaira(product.grossKobo) },
    { key: "refunds", header: "Refunds", align: "end", render: (product) => String(product.refunds) },
  ]

  return (
    <div className="space-y-6">
      <DateRangePicker value={range} basePath="/analytics" today={today} />

      {error === null ? null : <ErrorNotice message={error} />}

      {overview === null ? (
        <>
          <SkeletonKpis cards={4} />
          <SkeletonRows rows={4} label="Loading the numbers" />
        </>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard metric={VENDOR_METRICS.orders} value={String(overview.orders)} />
            <KpiCard metric={VENDOR_METRICS.gross} value={formatNaira(overview.grossKobo)} />
            <KpiCard metric={VENDOR_METRICS.net} value={formatNaira(overview.vendorNetKobo)} />
            <KpiCard
              metric={VENDOR_METRICS.affiliateShare}
              value={formatBpsPercent(affiliateShareBps)}
              hint={`${overview.affiliateOrders} of ${overview.orders} orders`}
            />
          </dl>

          <VendorSalesChart points={series} title="Gross sales per day" />

          <div>
            <h2 className="mb-2 text-sm font-semibold text-brand-ink">Products that sold</h2>
            <DataTable
              caption="Products by gross sales"
              columns={productColumns}
              rows={topProducts}
              rowKey={(product) => product.productId}
              emptyMessage="No product sold in this range yet."
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {VENDOR_METRICS.affiliateShare.how} Affiliates earned{" "}
            {formatNaira(overview.affiliateCommissionKobo)} on your products in this range.
          </p>
        </>
      )}
    </div>
  )
}
