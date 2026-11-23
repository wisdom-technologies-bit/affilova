import { PageHeader } from "@/components/app-shell/page-header"
import { PurchasesScreen } from "@/components/account/purchases-screen"
import { getMyOrdersAction } from "@/lib/account/actions"
import type { Page, OrderSummary } from "@/lib/account/types"

// The first page of the Account app: what this buyer has bought.
//
// The first page is read on the server, so the screen has real content before any
// JavaScript runs; "Load more" reads the next page from the browser. An empty
// answer is a real answer and is shown as one.

export default async function AccountPurchasesPage() {
  const result = await getMyOrdersAction({ limit: 20 })
  const page: Page<OrderSummary> = result.ok ? result.data : { items: [], nextCursor: null }

  return (
    <>
      <PageHeader title="Purchases" />

      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Every product you have bought, with its files and its receipt. A refund can be requested
        from the purchase while its refund window is open.
      </p>

      <PurchasesScreen initialPage={page} initialError={result.ok ? null : result.error} />
    </>
  )
}
