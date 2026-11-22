/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { FileText, ArrowRight } from "lucide-react"

import { getMyOrdersAction } from "@/lib/account/actions"
import { formatNaira } from "@/lib/catalog/money"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

export default async function AccountReceiptsPage() {
  const result = await getMyOrdersAction()
  const items = result.ok && result.data ? result.data.items : []

  return (
    <div className="space-y-6">
      <PageHeader title="Receipts" />

      {items.length === 0 ? (
        <div className="rounded-xl border border-brand-border bg-brand-surface p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-surface-muted text-brand-muted">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-medium text-brand-ink">No receipts available</h3>
          <p className="mt-1 text-sm text-brand-muted">Receipts will appear here after you complete a purchase.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((order: any) => (
            <Card key={order.order_id}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
                <div>
                  <div className="font-mono text-xs text-brand-muted">{order.number}</div>
                  <h4 className="font-medium text-brand-ink">{order.product_title || "Digital Product"}</h4>
                  <p className="text-xs text-brand-muted">
                    {new Date(order.paid_at || order.created_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium" })}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-medium text-brand-ink">{formatNaira(order.total_kobo)}</span>
                  <Button size="sm" asChild>
                    <Link href={`/receipts/${order.order_id}`}>
                      View Receipt <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
