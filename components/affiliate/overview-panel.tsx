import Link from "next/link"
import { CursorClick } from "@/components/ds/icons"

import { ClicksChart } from "@/components/affiliate/clicks-chart"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ds/empty-state"
import { InlineAlert } from "@/components/ds/inline-alert"
import { DataTable, type Column } from "@/components/affiliate/data-table"
import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { KpiCard } from "@/components/affiliate/kpi-card"
import { SkeletonKpis, SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { formatBpsPercent, formatCount, HOW_CALCULATED, METRICS } from "@/lib/affiliate/definitions"
import type { DailyPoint, Overview } from "@/lib/affiliate/read-types"
import { formatNaira } from "@/lib/catalog/money"
import { formatLagosDate } from "@/lib/catalog/format"
import type { LagosRange } from "@/lib/dates/lagos"

// The affiliate overview: eight numbers, a chart and the daily table, all for
// one range of Lagos days.
//
// The definitions are not decoration. Each card carries its sentence on hover,
// and the same sentences sit in the "How these are calculated" disclosure, so
// nobody has to guess what "Earnings per 100 clicks" means.

export function OverviewPanel({
  range,
  today,
  overview,
  series,
  error = null,
  loading = false,
}: {
  range: LagosRange
  today: string
  overview: Overview | null
  series: readonly DailyPoint[]
  error?: string | null
  loading?: boolean
}) {
  const columns: readonly Column<DailyPoint>[] = [
    { key: "day", header: "Day", render: (point) => formatLagosDate(`${point.day}T12:00:00Z`) },
    { key: "clicks", header: "Clicks", align: "end", render: (point) => formatCount(point.clicks) },
    {
      key: "unique",
      header: "Unique clicks",
      align: "end",
      render: (point) => formatCount(point.uniqueClicks),
    },
    { key: "orders", header: "Orders", align: "end", render: (point) => formatCount(point.orders) },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      render: (point) => formatNaira(point.commissionKobo),
    },
  ]

  const isEmpty =
    overview !== null &&
    overview.clicks === 0 &&
    overview.orders === 0 &&
    overview.commissionKobo === 0

  return (
    <div className="space-y-6">
      <DateRangePicker value={range} basePath="/" today={today} />

      {error === null ? null : <ErrorNotice message={error} />}

      {loading || overview === null ? (
        <>
          <SkeletonKpis cards={8} />
          <SkeletonRows rows={4} label="Loading the daily numbers" />
        </>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard metric={METRICS.clicks} value={formatCount(overview.clicks)} />
            <KpiCard metric={METRICS.uniqueClicks} value={formatCount(overview.uniqueClicks)} />
            <KpiCard metric={METRICS.orders} value={formatCount(overview.orders)} />
            <KpiCard metric={METRICS.conversion} value={formatBpsPercent(overview.conversionBps)} />
            <KpiCard metric={METRICS.epc} value={formatNaira(overview.epcKoboPer100Clicks)} />
            <KpiCard metric={METRICS.commission} value={formatNaira(overview.commissionKobo)} />
            <KpiCard metric={METRICS.pending} value={formatNaira(overview.balance.pendingKobo)} />
            <KpiCard metric={METRICS.available} value={formatNaira(overview.balance.availableKobo)} />
          </dl>

          {overview.balance.negative ? (
            <InlineAlert tone="warning">
              Your balance is below zero by {formatNaira(Math.abs(overview.balance.totalKobo))}. This
              happens when a sale you had already earned from is refunded. New commission pays it
              back first.
            </InlineAlert>
          ) : null}

          <details className="rounded-md border border-border px-4 py-3">
            <summary className="focus-ring inline-flex min-h-control-md cursor-pointer items-center rounded-sm text-dense font-medium text-foreground">
              How these are calculated
            </summary>
            <dl className="mt-3 space-y-3">
              {HOW_CALCULATED.map((metric) => (
                <div key={metric.label}>
                  <dt className="text-dense font-medium text-foreground">{metric.label}</dt>
                  <dd className="text-dense text-text-muted">
                    {metric.definition} {metric.how}
                  </dd>
                </div>
              ))}
            </dl>
          </details>

          {isEmpty ? (
            <EmptyState
              icon={<CursorClick className="h-5 w-5" />}
              title="Nothing happened in these days yet."
              description="Pick a product in the marketplace and share your link. Clicks appear here within a few minutes of the first visit."
              primaryAction={
                <Button asChild>
                  <Link href="/marketplace">Find a product to promote</Link>
                </Button>
              }
            />
          ) : (
            <>
              <ClicksChart points={series} title={`Clicks per day, ${range.from} to ${range.to}`} />

              <div>
                <h2 className="mb-2 text-dense font-semibold text-foreground">Every day in the range</h2>
                <DataTable
                  caption={`Daily clicks, orders and commission from ${range.from} to ${range.to}`}
                  columns={columns}
                  rows={series}
                  rowKey={(point) => point.day}
                  emptyMessage="No days in this range."
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
