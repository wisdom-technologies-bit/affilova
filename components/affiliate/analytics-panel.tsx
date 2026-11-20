import Link from "next/link"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { KpiCard } from "@/components/affiliate/kpi-card"
import { SkeletonKpis, SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { formatBpsPercent, formatCount, METRICS } from "@/lib/affiliate/definitions"
import type { BreakdownRow, LinkStat, Overview } from "@/lib/affiliate/read-types"
import { formatNaira } from "@/lib/catalog/money"
import type { LagosRange } from "@/lib/dates/lagos"

// Analytics: the same range, seen four ways.
//
// The tabs are links, so a view can be bookmarked and the back button works. The
// breakdown is the database's top 20 for the chosen dimension; there is no
// client-side regrouping, so the numbers here are the numbers the reports hold.

export type AnalyticsTab = "link" | "product" | "sub1" | "utm_source"

export const ANALYTICS_TABS: readonly { value: AnalyticsTab; label: string; dimension: string }[] = [
  { value: "link", label: "By link", dimension: "Your links" },
  { value: "product", label: "By product", dimension: "Products" },
  { value: "sub1", label: "By campaign (s1)", dimension: "Campaign labels" },
  { value: "utm_source", label: "By utm_source", dimension: "Sources" },
]

function tabHref(tab: AnalyticsTab, range: LagosRange): string {
  const search = new URLSearchParams({ preset: range.preset, tab })

  if (range.preset === "custom") {
    search.set("from", range.from)
    search.set("to", range.to)
  }

  return `/analytics?${search.toString()}`
}

export function AnalyticsPanel({
  range,
  today,
  tab,
  overview,
  linkStats,
  breakdown,
  error = null,
  loading = false,
}: {
  range: LagosRange
  today: string
  tab: AnalyticsTab
  overview: Overview | null
  linkStats: readonly LinkStat[]
  breakdown: readonly BreakdownRow[]
  error?: string | null
  loading?: boolean
}) {
  const breakdownColumns: readonly Column<BreakdownRow>[] = [
    { key: "label", header: "Group", render: (row) => row.label },
    { key: "clicks", header: "Clicks", align: "end", render: (row) => formatCount(row.clicks) },
    {
      key: "unique",
      header: "Unique clicks",
      align: "end",
      render: (row) => formatCount(row.uniqueClicks),
    },
    { key: "orders", header: "Orders", align: "end", render: (row) => formatCount(row.orders) },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      render: (row) => formatNaira(row.commissionKobo),
    },
  ]

  const linkColumns: readonly Column<LinkStat>[] = [
    {
      key: "label",
      header: "Link",
      render: (row) => (
        <span className="text-brand-ink">
          {row.label ?? "No name"}
          <span className="block text-xs font-normal text-muted-foreground">{row.productTitle}</span>
        </span>
      ),
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
      key: "commission",
      header: "Commission",
      align: "end",
      render: (row) => formatNaira(row.commissionKobo),
    },
  ]

  return (
    <div className="space-y-6">
      <DateRangePicker value={range} basePath="/analytics" params={{ tab }} today={today} />

      {error === null ? null : <ErrorNotice message={error} />}

      {loading || overview === null ? (
        <SkeletonKpis cards={5} />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard metric={METRICS.clicks} value={formatCount(overview.clicks)} />
          <KpiCard metric={METRICS.uniqueClicks} value={formatCount(overview.uniqueClicks)} />
          <KpiCard metric={METRICS.orders} value={formatCount(overview.orders)} />
          <KpiCard metric={METRICS.conversion} value={formatBpsPercent(overview.conversionBps)} />
          <KpiCard metric={METRICS.commission} value={formatNaira(overview.commissionKobo)} />
        </dl>
      )}

      <nav aria-label="Breakdown">
        <ul className="flex flex-wrap gap-1 border-b border-border pb-1">
          {ANALYTICS_TABS.map((entry) => {
            const current = entry.value === tab

            return (
              <li key={entry.value}>
                <Link
                  href={tabHref(entry.value, range)}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center rounded-t-md border-b-2 px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                    current
                      ? "border-brand-600 font-medium text-brand-ink"
                      : "border-transparent text-muted-foreground hover:text-brand-ink"
                  }`}
                >
                  {entry.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {loading ? (
        <SkeletonRows rows={4} label="Loading the breakdown" />
      ) : tab === "link" ? (
        <DataTable
          caption="Your links for this range"
          columns={linkColumns}
          rows={linkStats}
          rowKey={(row) => row.linkId}
          emptyMessage="No link activity in this range."
        />
      ) : (
        <DataTable
          caption={`The top groups for ${ANALYTICS_TABS.find((entry) => entry.value === tab)?.dimension ?? tab}`}
          columns={breakdownColumns}
          rows={breakdown}
          rowKey={(row) => row.label}
          emptyMessage="Nothing recorded for this breakdown in these days."
        />
      )}

      <p className="text-xs text-muted-foreground">
        {tab === "sub1"
          ? "s1 is the campaign label you add to a link. Clicks without one are grouped as Not set."
          : tab === "utm_source"
            ? "utm_source comes from the link you shared. It is read from the click, never from the browser."
            : tab === "product"
              ? "Orders are counted under the product of the click that earned them."
              : "Every link you own, with the numbers it recorded in the range."}
      </p>
    </div>
  )
}
