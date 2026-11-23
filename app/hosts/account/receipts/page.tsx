import { PageHeader } from "@/components/app-shell/page-header"
import { ReceiptsList } from "@/components/account/receipts-list"
import { getMyOrdersAction } from "@/lib/account/actions"
import type { OrderSummary } from "@/lib/account/types"

// Receipts: the orders that were actually paid for.
//
// A pending or failed order has no receipt, so it is not listed here even though
// it appears in Purchases. The list reads the same pages as Purchases, filtered to
// the states that have a receipt.

const RECEIPT_STATUSES = ["paid", "refunded", "disputed"] as const

export default async function AccountReceiptsPage() {
  const result = await getMyOrdersAction({ limit: 50 })
  const orders: OrderSummary[] = result.ok
    ? result.data.items.filter((order) =>
        (RECEIPT_STATUSES as readonly string[]).includes(order.status),
      )
    : []

  return (
    <>
      <PageHeader title="Receipts" />

      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        One receipt per paid order. Open a receipt to print it or save it as a PDF.
      </p>

      <ReceiptsList orders={orders} error={result.ok ? null : result.error} />
    </>
  )
}
