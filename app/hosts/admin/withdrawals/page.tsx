import { PageHeader } from "@/components/app-shell/page-header"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { AdminWithdrawalsQueue } from "@/components/payouts/admin-withdrawals"
import { getAuthUser } from "@/lib/identity/session"
import { listWithdrawalsAction } from "@/lib/payouts/actions"

export const dynamic = "force-dynamic"

export default async function AdminWithdrawalsPage() {
  const [user, first] = await Promise.all([getAuthUser(), listWithdrawalsAction({ tab: "needs_approval" })])

  return (
    <>
      <PageHeader title="Withdrawals" />
      {user === null ? (
        <ErrorNotice message="Sign in to continue." />
      ) : (
        <AdminWithdrawalsQueue
          currentUserId={user.id}
          initialTab="needs_approval"
          initialPage={first.ok ? first.data : { rows: [], nextCursor: null }}
          initialError={first.ok ? null : first.error}
        />
      )}
    </>
  )
}
