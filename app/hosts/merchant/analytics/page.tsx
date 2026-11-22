/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getVendorOverviewAction, getVendorDailySeriesAction, getVendorTopProductsAction } from "@/lib/merchant/actions"
import { resolveRange } from "@/lib/dates/lagos"
import { firstParam, type SearchParams } from "@/lib/dates/range-params"
import { formatNaira } from "@/lib/catalog/money"
import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function MerchantAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const rangeRes = resolveRange({ preset: firstParam(params, "preset"), from: firstParam(params, "from"), to: firstParam(params, "to") }, new Date())
  const range = rangeRes.ok ? rangeRes.range : null

  const [overviewRes, seriesRes, topRes] = await Promise.all([
    getVendorOverviewAction({ from: range?.fromUtc, to: range?.toUtc }),
    getVendorDailySeriesAction({ from: range?.from, to: range?.to }),
    getVendorTopProductsAction({ from: range?.from, to: range?.to }),
  ])

  const overview = overviewRes.ok && overviewRes.data ? overviewRes.data : {
    orders: 0,
    gross_kobo: 0,
    vendor_net_kobo: 0,
    platform_fee_kobo: 0,
    affiliate_commission_kobo: 0,
    refunds_count: 0,
    refunds_kobo: 0,
    refund_rate_bps: 0,
  }

  const series = seriesRes.ok ? seriesRes.data : []
  const topProducts = topRes.ok ? topRes.data : []

  return (
    <div className="space-y-6">
      <PageHeader title="Merchant Analytics" />

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{overview.orders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Gross Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.gross_kobo)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Refund Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{overview.refund_rate_bps / 100}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Series Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <p className="text-sm text-brand-muted">No daily data available.</p>
          ) : (
            <div className="space-y-2">
              {series.map((day: any) => (
                <div key={day.day} className="flex justify-between items-center text-sm border-b border-brand-border pb-2 last:border-0">
                  <span className="font-mono text-brand-muted">{day.day}</span>
                  <div className="flex gap-6 font-mono text-brand-ink">
                    <span>{day.orders} orders</span>
                    <span>{formatNaira(day.gross_kobo)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
