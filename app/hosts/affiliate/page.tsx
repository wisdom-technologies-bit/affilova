import { PageHeader } from "@/components/app-shell/page-header"
import { OverviewPanel } from "@/components/affiliate/overview-panel"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getDailySeriesAction, getOverviewAction } from "@/lib/affiliate/read-actions"
import type { DailyPoint, Overview } from "@/lib/affiliate/read-types"
import { lagosDayOf } from "@/lib/dates/lagos"
import { readRange, type SearchParams } from "@/lib/dates/range-params"

// The affiliate overview. Two reads in parallel: the totals and the daily
// series. A failed read shows one sentence and leaves the rest of the page
// standing, so the date range still works while the database is unhappy.

export default async function AffiliateOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const now = new Date()
  const { range, error: rangeError } = readRange(params, now)

  const [overviewResult, seriesResult] = await Promise.all([
    getOverviewAction({ from: range.fromUtc, to: range.toUtc }),
    getDailySeriesAction({ from: range.from, to: range.to }),
  ])

  const overview: Overview | null = overviewResult.ok ? overviewResult.data : null
  const series: DailyPoint[] = seriesResult.ok ? seriesResult.data : []
  const error = overviewResult.ok ? (seriesResult.ok ? null : seriesResult.error) : overviewResult.error

  return (
    <>
      <PageHeader title="Overview" />
      {rangeError === null ? null : <ErrorNotice message={rangeError} />}
      <div className="mt-4">
        <OverviewPanel
          range={range}
          today={lagosDayOf(now)}
          overview={overview}
          series={series}
          error={error}
        />
      </div>
    </>
  )
}
