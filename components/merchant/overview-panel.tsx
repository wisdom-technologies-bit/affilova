import { DataTable, type Column } from "@/components/affiliate/data-table"
import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { KpiCard } from "@/components/affiliate/kpi-card"
import { SkeletonKpis, SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { VendorSalesChart } from "@/components/merchant/sales-chart"
import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import type { LagosRange } from "@/lib/dates/lagos"
import { VENDOR_METRICS, VENDOR_METRIC_LIST, WITHDRAWALS_NOTE } from "@/lib/merchant/definitions"
import { formatBpsPercent, type VendorDailyPoint, type VendorOverview, type VendorTopProduct } from "@/lib/merchant/types"

// The merchant overview: six numbers, a chart, the daily table and the products
// that earned the most, all for one range of Lagos days.
//
// The definitions are not decoration. Each card carries its sentence on hover,
// and the same sentences sit in the "How these are calculated" disclosure, so
// nobody has to guess what "Your earnings" means.

export function MerchantOverviewPanel({
  range,
  today,
  overview,
  series,
  topProducts,
  error = null,
  loading = false,
}: {
  range: LagosRange
  today: string
  overview: VendorOverview | null
  series: readonly VendorDailyPoint[]
  topProducts: readonly VendorTopProduct[]
  error?: string | null
  loading?: boolean
}) {
  const dayColumns: readonly Column<VendorDailyPoint>[] = [
    { key: "day", header: "Day", render: (point) => formatLagosDate(`${point.day}T12:00:00Z`) },
    { key: "orders", header: "Orders", align: "end", render: (point) => String(point.orders) },
    { key: "gross", header: "Gross", align: "end", render: (point) => formatNaira(point.grossKobo) },
    { key: "net", header: "Your earnings", align: "end", render: (point) => formatNaira(point.vendorNetKobo) },
  ]

  const productColumns: readonly Column<VendorTopProduct>[] = [
    { key: "title", header: "Product", render: (product) => product.title },
    { key: "orders", header: "Orders", align: "end", render: (product) => String(product.orders) },
    { key: "gross", header: "Gross", align: "end", render: (product) => formatNaira(product.grossKobo) },
    {
      key: "refunds",
      header: "Refunds",
      align: "end",
      render: (product) => String(product.refunds),
    },
  ]

  return (
    <div className="space-y-6">
      <DateRangePicker value={range} basePath="/" today={today} />

      {error === null ? null : <ErrorNotice message={error} />}

      {loading || overview === null ? (
        <>
          <SkeletonKpis cards={6} />
          <SkeletonRows rows={4} label="Loading your numbers" />
        </>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard metric={VENDOR_METRICS.orders} value={String(overview.orders)} />
            <KpiCard metric={VENDOR_METRICS.gross} value={formatNaira(overview.grossKobo)} />
            <KpiCard metric={VENDOR_METRICS.net} value={formatNaira(overview.vendorNetKobo)} />
            <KpiCard
              metric={VENDOR_METRICS.refunds}
              value={`${overview.refundsCount} · ${formatBpsPercent(overview.refundRateBps)}`}
              hint={`${formatNaira(overview.refundsKobo)} refunded`}
            />
            <KpiCard metric={VENDOR_METRICS.pending} value={formatNaira(overview.pendingKobo)} />
            <KpiCard metric={VENDOR_METRICS.available} value={formatNaira(overview.availableKobo)} />
          </dl>

          <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {WITHDRAWALS_NOTE} Your available balance is what you will be able to withdraw once
            payouts are switched on.
          </p>

          {overview.orders === 0 ? (
            <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
              No sales in this range yet.
            </p>
          ) : null}

          <VendorSalesChart points={series} title="Gross sales per day" />

          <div>
            <h2 className="mb-2 text-sm font-semibold text-brand-ink">Every day</h2>
            <DataTable
              caption="Daily sales"
              columns={dayColumns}
              rows={series}
              rowKey={(point) => point.day}
              emptyMessage="No days in this range."
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-brand-ink">Top products</h2>
            <DataTable
              caption="Top products by gross sales"
              columns={productColumns}
              rows={topProducts}
              rowKey={(product) => product.productId}
              emptyMessage="No product sold in this range yet."
            />
          </div>

          <details className="rounded-md border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-ink">
              How these are calculated
            </summary>
            <dl className="mt-3 space-y-3">
              {VENDOR_METRIC_LIST.map((metric) => (
                <div key={metric.label}>
                  <dt className="text-sm font-medium text-brand-ink">{metric.label}</dt>
                  <dd className="text-sm text-muted-foreground">{metric.definition}</dd>
                  <dd className="text-xs text-muted-foreground">{metric.how}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </div>
  )
}
