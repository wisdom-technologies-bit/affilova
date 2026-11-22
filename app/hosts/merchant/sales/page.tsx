/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"

import { getVendorSalesAction, getVendorRefundRequestsAction, decideVendorRefundAction } from "@/lib/merchant/actions"
import { firstParam, type SearchParams } from "@/lib/dates/range-params"
import { formatNaira } from "@/lib/catalog/money"
import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function MerchantSalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const tab = firstParam(params, "tab") || "sales"
  const status = firstParam(params, "status") || "all"

  const salesRes = tab === "sales" ? await getVendorSalesAction({ status }) : { ok: true, data: { items: [] } }
  const refundsRes = tab === "refunds" ? await getVendorRefundRequestsAction({ status }) : { ok: true, data: { items: [] } }

  const sales = salesRes.ok && salesRes.data ? salesRes.data.items : []
  const refunds = refundsRes.ok && refundsRes.data ? refundsRes.data.items : []

  return (
    <div className="space-y-6">
      <PageHeader title="Sales & Refund Requests" />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-brand-border pb-3">
        <Button variant={tab === "sales" ? "default" : "outline"} size="sm" asChild>
          <Link href="/sales?tab=sales">Sales</Link>
        </Button>
        <Button variant={tab === "refunds" ? "default" : "outline"} size="sm" asChild>
          <Link href="/sales?tab=refunds">Refund Requests</Link>
        </Button>
      </div>

      {tab === "sales" ? (
        <div className="space-y-4">
          {sales.length === 0 ? (
            <div className="rounded-xl border border-brand-border bg-brand-surface p-12 text-center text-brand-muted">
              No sales found.
            </div>
          ) : (
            <div className="space-y-3">
              {sales.map((sale: any) => (
                <Card key={sale.order_id}>
                  <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-brand-muted">{sale.order_number}</span>
                        <Badge variant={sale.status === "paid" ? "default" : "secondary"}>{sale.status}</Badge>
                        {sale.via_affiliate && (
                          <span className="bg-brand-surface-muted text-brand-ink text-xs px-2 py-0.5 rounded font-medium">
                            via affiliate
                          </span>
                        )}
                      </div>
                      <h4 className="mt-1 font-medium text-brand-ink">{sale.product_title}</h4>
                      <p className="text-xs text-brand-muted">
                        {new Date(sale.paid_at || Date.now()).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-xs text-brand-muted">Gross</div>
                        <div className="font-mono font-medium text-brand-ink">{formatNaira(sale.gross_kobo)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-brand-muted">Net Earnings</div>
                        <div className="font-mono font-medium text-brand-ink">{formatNaira(sale.vendor_net_kobo)}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {refunds.length === 0 ? (
            <div className="rounded-xl border border-brand-border bg-brand-surface p-12 text-center text-brand-muted">
              No refund requests found.
            </div>
          ) : (
            <div className="space-y-3">
              {refunds.map((req: any) => (
                <Card key={req.request_id}>
                  <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-brand-muted">{req.order_number}</span>
                        <Badge variant={req.status === "approved" ? "default" : req.status === "rejected" ? "destructive" : "secondary"}>
                          {req.status}
                        </Badge>
                      </div>
                      <h4 className="mt-1 font-medium text-brand-ink">{req.product_title}</h4>
                      <p className="text-xs text-brand-muted mt-1">Reason: {req.reason}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-brand-ink">{formatNaira(req.amount_kobo)}</span>
                      {req.status === "requested" && (
                        <div className="flex gap-2">
                          <form action={async () => {
                            "use server"
                            await decideVendorRefundAction({ requestId: req.request_id, decision: "approve", note: "Approved by vendor" })
                          }}>
                            <Button size="sm" type="submit" variant="default">Approve</Button>
                          </form>
                          <form action={async (formData) => {
                            "use server"
                            const note = formData.get("note")?.toString() || "Rejected by vendor"
                            await decideVendorRefundAction({ requestId: req.request_id, decision: "reject", note })
                          }} className="flex items-center gap-2">
                            <input type="hidden" name="note" value="Rejected after review of order details." />
                            <Button size="sm" type="submit" variant="destructive">Reject</Button>
                          </form>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
