import { ErrorNotice } from "@/components/affiliate/status-pill"
import { PageHeader } from "@/components/app-shell/page-header"
import { OrderDetailView } from "@/components/admin-finance/transactions"
import { LinkButton } from "@/components/admin-finance/ui"
import { getOrderDetailAction } from "@/lib/admin/finance-actions"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"

export const dynamic = "force-dynamic"

// One order, everything about it.
//
// The full buyer address is only in this page, and only for admin and support.
// Reading it as one of those roles writes an audit row inside the database, so
// the record of who looked exists even if this page is closed immediately.

export default async function AdminOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const user = await getAuthUser()

  if (user === null) {
    return (
      <>
        <PageHeader title="Order" />
        <ErrorNotice message="Sign in to continue." />
      </>
    )
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "orders:read")) {
    return (
      <>
        <PageHeader title="Order" />
        <ErrorNotice message="You do not have access to that." />
      </>
    )
  }

  const result = await getOrderDetailAction({ orderId })

  return (
    <>
      <PageHeader title={result.ok ? result.data.number : "Order"} />

      <div className="mb-4">
        <LinkButton href="/transactions">Back to transactions</LinkButton>
      </div>

      {result.ok ? (
        <OrderDetailView
          detail={result.data}
          canManageRefunds={can(roles, "refunds:manage")}
          canDecideDisputes={can(roles, "disputes:manage")}
        />
      ) : (
        <ErrorNotice message={result.error} />
      )}
    </>
  )
}
