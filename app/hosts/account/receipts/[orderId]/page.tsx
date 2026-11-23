import { PageHeader } from "@/components/app-shell/page-header"
import { Receipt } from "@/components/account/receipt"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getMyOrderAction } from "@/lib/account/actions"

// One printable receipt. The buyer's id comes from the session and the database
// refuses an order that is not theirs.

export default async function AccountReceiptPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const result = await getMyOrderAction({ orderId })

  return (
    <>
      <PageHeader title="Receipt" />

      {result.ok ? <Receipt detail={result.data} /> : <ErrorNotice message={result.error} />}
    </>
  )
}
