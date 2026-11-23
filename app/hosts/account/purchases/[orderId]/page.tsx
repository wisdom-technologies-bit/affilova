import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { PurchaseDetail } from "@/components/account/purchase-detail"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getMyOrderAction } from "@/lib/account/actions"

// One purchase.
//
// The order id comes from the address bar; the buyer's id comes from the
// session, and the database refuses an order that is not theirs. A refusal is a
// sentence, not an empty page.

export default async function AccountPurchasePage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const result = await getMyOrderAction({ orderId })
  const now = new Date().toISOString()

  return (
    <>
      <PageHeader title="Purchase" />

      <p className="mb-4 text-sm">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Back to purchases
        </Link>
      </p>

      {result.ok ? (
        <PurchaseDetail detail={result.data} now={now} />
      ) : (
        <ErrorNotice message={result.error} />
      )}
    </>
  )
}
