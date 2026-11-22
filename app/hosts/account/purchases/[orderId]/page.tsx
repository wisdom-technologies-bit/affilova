/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download, ShieldAlert, CheckCircle2, Clock, AlertCircle } from "lucide-react"

import { getMyOrderAction, downloadMyFileAction, requestMyRefundAction } from "@/lib/account/actions"
import { formatNaira } from "@/lib/catalog/money"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/app-shell/page-header"

export default async function AccountPurchaseDetailPage({ params }: { params: { orderId: string } }) {
  const res = await getMyOrderAction({ orderId: params.orderId })
  if (!res.ok || !res.data) {
    notFound()
  }

  const order = res.data
  const windowEnded = order.refund_window_ends_at ? new Date() > new Date(order.refund_window_ends_at) : true

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to purchases
          </Link>
        </Button>
      </div>

      <PageHeader title={`Order ${order.number}`} />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {/* Items & Files */}
          <Card>
            <CardHeader>
              <CardTitle>Entitled Files</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.entitlements.map((ent: any) => {
                const isClean = ent.scan_clean === true
                return (
                  <div key={ent.entitlement_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-brand-border p-4">
                    <div>
                      <div className="font-medium text-brand-ink">{ent.file_display_name}</div>
                      <div className="text-xs text-brand-muted flex items-center gap-2 mt-1">
                        <span>{Math.round(ent.size_bytes / 1024)} KB</span>
                        <span>&bull;</span>
                        <span>Downloads: {ent.downloads_used} / {ent.max_downloads}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {isClean ? (
                        <form action={async () => {
                          "use server"
                          await downloadMyFileAction({ orderId: order.order_id, entitlementId: ent.entitlement_id })
                        }}>
                          <Button size="sm" type="submit">
                            <Download className="mr-1.5 h-4 w-4" /> Download
                          </Button>
                        </form>
                      ) : (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                          Unavailable while we check it
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Refund Area */}
          <Card>
            <CardHeader>
              <CardTitle>Refund & Support</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.refund_request ? (
                <div className="rounded-lg bg-brand-surface-muted p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-brand-ink">Refund Status</span>
                    <Badge variant={order.refund_request.status === "approved" ? "default" : "secondary"}>
                      {order.refund_request.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-brand-muted">Reason: {order.refund_request.reason}</p>
                </div>
              ) : windowEnded ? (
                <p className="text-sm text-brand-muted">The refund window for this order has closed.</p>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-brand-muted">
                    Refund window open until {new Date(order.refund_window_ends_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}.
                  </p>
                  <form action={async (formData) => {
                    "use server"
                    const reason = formData.get("reason")?.toString() || ""
                    await requestMyRefundAction({ orderId: order.order_id, reason })
                  }} className="space-y-3">
                    <textarea
                      name="reason"
                      placeholder="Reason for refund (at least 10 characters)..."
                      className="w-full rounded-md border border-brand-border bg-brand-surface p-3 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-focus"
                      rows={3}
                      required
                      minLength={10}
                    />
                    <Button type="submit" variant="destructive" size="sm">
                      Request Refund
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-brand-muted">Subtotal</span>
                <span className="font-mono text-brand-ink">{formatNaira(order.subtotal_kobo)}</span>
              </div>
              {order.tax_total_kobo > 0 && (
                <div className="flex justify-between">
                  <span className="text-brand-muted">Tax</span>
                  <span className="font-mono text-brand-ink">{formatNaira(order.tax_total_kobo)}</span>
                </div>
              )}
              <div className="border-t border-brand-border pt-3 flex justify-between font-medium">
                <span>Total</span>
                <span className="font-mono text-brand-ink">{formatNaira(order.total_kobo)}</span>
              </div>
              <div className="border-t border-brand-border pt-3 text-xs text-brand-muted space-y-1">
                <div>Channel: {order.channel}</div>
                <div>Status: {order.status}</div>
              </div>
              <div className="pt-2">
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/receipts/${order.order_id}`}>View Printable Receipt</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
