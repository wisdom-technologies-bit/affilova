import { PageHeader } from "@/components/app-shell/page-header"
import { AnalyticsPanel, ANALYTICS_TABS, type AnalyticsTab } from "@/components/affiliate/analytics-panel"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getBreakdownAction, getLinkStatsAction, getOverviewAction } from "@/lib/affiliate/read-actions"
import type { BreakdownRow, LinkStat, Overview } from "@/lib/affiliate/read-types"
import { lagosDayOf } from "@/lib/dates/lagos"
import { firstParam, readRange, type SearchParams } from "@/lib/dates/range-params"

// Analytics: one range, four ways of splitting it.
//
// "By link" reads the link stats function; the other three read the breakdown
// function with the dimension the database expects. Only one of them is fetched
// per visit, because the page shows one at a time.

function readTab(value: string | undefined): AnalyticsTab {
  return ANALYTICS_TABS.find((tab) => tab.value === value)?.value ?? "link"
}

export default async function AffiliateAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const now = new Date()
  const { range, error: rangeError } = readRange(params, now)
  const tab = readTab(firstParam(params, "tab"))

  // The two detail reads have different result shapes, so they are kept apart
  // and only the one for the open tab is fetched.
  const [overviewResult, linkResult, breakdownResult] = await Promise.all([
    getOverviewAction({ from: range.fromUtc, to: range.toUtc }),
    tab === "link"
      ? getLinkStatsAction({ from: range.from, to: range.to, limit: 20 })
      : Promise.resolve(null),
    tab === "link"
      ? Promise.resolve(null)
      : getBreakdownAction({ from: range.from, to: range.to, dimension: tab }),
  ])

  const overview: Overview | null = overviewResult.ok ? overviewResult.data : null
  let linkStats: LinkStat[] = []
  let breakdown: BreakdownRow[] = []
  let detailError: string | null = null

  if (linkResult !== null) {
    if (linkResult.ok) {
      linkStats = linkResult.data.items
    } else {
      detailError = linkResult.error
    }
  }

  if (breakdownResult !== null) {
    if (breakdownResult.ok) {
      breakdown = breakdownResult.data.rows
    } else {
      detailError = breakdownResult.error
    }
  }

  const error = overviewResult.ok ? detailError : overviewResult.error

  return (
    <>
      <PageHeader title="Analytics" />
      {rangeError === null ? null : <ErrorNotice message={rangeError} />}
      <div className="mt-4">
        <AnalyticsPanel
          range={range}
          today={lagosDayOf(now)}
          tab={tab}
          overview={overview}
          linkStats={linkStats}
          breakdown={breakdown}
          error={error}
        />
      </div>
    </>
  )
}
