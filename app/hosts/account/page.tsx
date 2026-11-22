/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { Package, Download, ExternalLink, ArrowRight } from "lucide-react"

import { getMyOrdersAction } from "@/lib/account/actions"
import { formatNaira } from "@/lib/catalog/money"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/app-shell/page-header"

export default async function AccountPurchasesPage() {
  const result = await getMyOrdersAction()
  const items = result.ok && result.data ? result.data.items : []

  return (
    <div className="space-y-6">
      <PageHeader title="Your Purchases" />

      {items.length === 0 ? (
        <div className="rounded-xl border border-brand-border bg-brand-surface p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-surface-muted text-brand-muted">
            <Package className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-medium text-brand-ink">You have not bought anything yet.</h3>
          <p className="mt-1 text-sm text-brand-muted">Explore the marketplace and discover digital products.</p>
          <div className="mt-6">
            <Button asChild>
              <Link href="/">Browse products</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((order: any) => (
            <Card key={order.order_id} className="transition-all hover:border-brand-border-strong">
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  {order.cover_public_id ? (
                    <img
                      src={`https://res.cloudinary.com/demo/image/upload/w_100,h_100,c_fill/${order.cover_public_id}`}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover bg-brand-surface-muted"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-surface-muted text-brand-muted">
                      <Package className="h-6 w-6" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand-muted">{order.number}</span>
                      <Badge variant={order.status === "paid" ? "default" : "secondary"}>
                        {order.status}
                      </Badge>
                    </div>
                    <h4 className="mt-1 font-medium text-brand-ink">{order.product_title || "Digital Product"}</h4>
                    <p className="text-xs text-brand-muted">
                      {order.vendor_name} &bull; {new Date(order.paid_at || order.created_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium" })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-brand-border pt-4 sm:border-t-0 sm:pt-0">
                  <div className="text-right">
                    <div className="font-mono font-medium text-brand-ink">{formatNaira(order.total_kobo)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/receipts/${order.order_id}`}>Receipt</Link>
                    </Button>
                    <Button size="sm" asChild>
                      <Link href={`/purchases/${order.order_id}`}>
                        View files <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
