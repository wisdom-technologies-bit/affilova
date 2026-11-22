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

export default async function MerchantOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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
    pending_kobo: 0,
    available_kobo: 0,
  }

  const series = seriesRes.ok ? seriesRes.data : []
  const topProducts = topRes.ok ? topRes.data : []

  return (
    <div className="space-y-6">
      <PageHeader title="Merchant Overview" />

      {/* Notice */}
      <div className="rounded-lg border border-brand-border bg-brand-surface-muted p-4 text-sm text-brand-muted">
        Withdrawals are not available yet until payouts ship.
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{overview.orders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Gross Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.gross_kobo)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Your Earnings (Net)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.vendor_net_kobo)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Refunds ({overview.refund_rate_bps / 100}%)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.refunds_kobo)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Pending Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.pending_kobo)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-brand-muted uppercase">Available Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-brand-ink">{formatNaira(overview.available_kobo)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle>Top Products</CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <p className="text-sm text-brand-muted">No sales in this period.</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((prod: any) => (
                <div key={prod.product_id} className="flex items-center justify-between border-b border-brand-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="font-medium text-brand-ink">{prod.title}</div>
                    <div className="text-xs text-brand-muted">{prod.orders_count} orders</div>
                  </div>
                  <div className="text-right font-mono font-medium text-brand-ink">
                    {formatNaira(prod.gross_kobo)}
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
