/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"

import { getMyOrderAction } from "@/lib/account/actions"
import { formatNaira } from "@/lib/catalog/money"
import { legalIdentityLine, LEGAL } from "@/lib/site-config"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default async function ReceiptDetailPage({ params }: { params: { orderId: string } }) {
  const res = await getMyOrderAction({ orderId: params.orderId })
  if (!res.ok || !res.data) {
    notFound()
  }

  const order = res.data
  const firstItem = order.items[0] || {}
  const legalText = legalIdentityLine(LEGAL)

  return (
    <div className="space-y-6 max-w-3xl mx-auto py-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/receipts">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to receipts
          </Link>
        </Button>
        <Button size="sm" onClick={() => {}}>
          <Printer className="mr-2 h-4 w-4" /> Print Receipt
        </Button>
      </div>

      <div className="rounded-xl border border-brand-border bg-brand-surface p-8 shadow-sm print:border-none print:shadow-none space-y-8">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-brand-border pb-6">
          <div>
            <h1 className="text-2xl font-bold text-brand-ink">Affilova</h1>
            <p className="text-sm text-brand-muted">Digital Commerce Platform</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-semibold text-brand-ink">Receipt #{order.number}</div>
            <div className="text-xs text-brand-muted mt-1">
              {new Date(order.paid_at || order.created_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} (Lagos Time)
            </div>
          </div>
        </div>

        {/* Vendor & Channel */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-brand-muted uppercase tracking-wider block">Vendor</span>
            <span className="font-medium text-brand-ink">{firstItem.vendor_name || "Affilova Merchant"}</span>
          </div>
          <div>
            <span className="text-xs text-brand-muted uppercase tracking-wider block">Payment Channel</span>
            <span className="font-medium text-brand-ink uppercase">{order.channel || "Paystack"}</span>
          </div>
        </div>

        {/* Items Table */}
        <div className="border-t border-b border-brand-border py-4 space-y-3">
          <div className="text-xs text-brand-muted uppercase tracking-wider">Line Items</div>
          {order.items.map((item: any) => (
            <div key={item.order_item_id} className="flex justify-between items-center text-sm">
              <div>
                <span className="font-medium text-brand-ink">{item.product_title}</span>
                <span className="text-xs text-brand-muted ml-2">({item.quantity}x)</span>
              </div>
              <span className="font-mono text-brand-ink">{formatNaira(item.total_amount_kobo)}</span>
            </div>
          ))}

          {order.tax_lines.map((tax: any) => (
            <div key={tax.tax_line_id} className="flex justify-between items-center text-sm text-brand-muted">
              <span>Tax ({tax.rate_bps / 100}%)</span>
              <span className="font-mono">{formatNaira(tax.amount_kobo)}</span>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="flex justify-between items-center pt-2 font-bold text-lg text-brand-ink">
          <span>Total Paid</span>
          <span className="font-mono">{formatNaira(order.total_kobo)}</span>
        </div>

        {/* Platform & Legal footer */}
        <div className="border-t border-brand-border pt-6 text-xs text-brand-muted space-y-1 text-center">
          <div>Powered by <strong>Affilova</strong> as platform and technology provider.</div>
          {legalText && <div>{legalText}</div>}
        </div>
      </div>
    </div>
  )
}
