import { PageHeader } from "@/components/app-shell/page-header"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { MerchantOverviewPanel } from "@/components/merchant/overview-panel"
import { lagosDayOf } from "@/lib/dates/lagos"
import { readRange, type SearchParams } from "@/lib/dates/range-params"
import {
  getVendorDailySeriesAction,
  getVendorOverviewAction,
  getVendorTopProductsAction,
} from "@/lib/merchant/actions"
import type { VendorDailyPoint, VendorOverview, VendorTopProduct } from "@/lib/merchant/types"

// The merchant overview: the vendor's own numbers for one range of Lagos days.
//
// The vendor is the signed-in person: the actions take no vendor id, so this page
// cannot ask for anyone else's numbers.

export default async function MerchantOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const now = new Date()
  const { range, error: rangeError } = readRange(params, now)

  const [overviewResult, seriesResult, productsResult] = await Promise.all([
    getVendorOverviewAction({ from: range.fromUtc, to: range.toUtc }),
    getVendorDailySeriesAction({ from: range.from, to: range.to }),
    getVendorTopProductsAction({ from: range.from, to: range.to }),
  ])

  const overview: VendorOverview | null = overviewResult.ok ? overviewResult.data : null
  const series: VendorDailyPoint[] = seriesResult.ok ? seriesResult.data : []
  const topProducts: VendorTopProduct[] = productsResult.ok ? productsResult.data : []

  const error = overviewResult.ok
    ? (seriesResult.ok ? null : seriesResult.error) ?? (productsResult.ok ? null : productsResult.error)
    : overviewResult.error

  return (
    <>
      <PageHeader title="Overview" />

      {rangeError === null ? null : <ErrorNotice message={rangeError} />}

      <div className="mt-4">
        <MerchantOverviewPanel
          range={range}
          today={lagosDayOf(now)}
          overview={overview}
          series={series}
          topProducts={topProducts}
          error={error}
        />
      </div>
    </>
  )
}
