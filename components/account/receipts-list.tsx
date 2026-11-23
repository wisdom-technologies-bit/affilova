import Link from "next/link"

import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import { orderStatusLabel, type OrderSummary } from "@/lib/account/types"
import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// The receipts list: one line per order that has a receipt, with the date and the
// amount, and a link to the printable page. Nothing is invented: an order that
// has not been paid has no receipt and is not listed.

export function ReceiptsList({
  orders,
  error = null,
}: {
  orders: readonly OrderSummary[]
  error?: string | null
}) {
  if (error !== null) {
    return <ErrorNotice message={error} />
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-md border border-border px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-ink">You have no receipts yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          A receipt appears here as soon as an order is paid.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li
          key={order.orderId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-4"
        >
          <div>
            <p className="text-sm font-medium text-brand-ink">{order.productTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {order.number} · {formatLagosDate(order.paidAt ?? order.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={pillStatus(order.status)} label={orderStatusLabel(order.status)} />
            <span className="text-sm font-medium tabular-nums text-brand-ink">
              {formatNaira(order.totalKobo)}
            </span>
            <Link
              href={`/receipts/${order.orderId}`}
              className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Open receipt
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
