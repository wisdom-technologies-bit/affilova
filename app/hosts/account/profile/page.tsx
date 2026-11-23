import { PageHeader } from "@/components/app-shell/page-header"
import { ProfilePanel } from "@/components/account/profile-panel"
import { getAccountSummary } from "@/lib/identity/account-summary"
import { requireUser } from "@/lib/identity/guards"

// The account's own details: the name and the email it holds, a sign-out button,
// and the honest note about deletion and export.

export default async function AccountProfilePage() {
  const { user } = await requireUser("/profile")
  const summary = await getAccountSummary(user.id, user.email)

  return (
    <>
      <PageHeader title="Profile" />
      <ProfilePanel displayName={summary.displayName} email={summary.email} />
    </>
  )
}
