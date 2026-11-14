import { AccountOverview } from "@/components/app-shell/account-overview"
import { getAccountSummary } from "@/lib/identity/account-summary"
import { requireUser } from "@/lib/identity/guards"

// The first page of the Admin app: the account's own data, nothing else.
export default async function AdminOverviewPage() {
  const { user } = await requireUser("/")
  const summary = await getAccountSummary(user.id, user.email)

  return <AccountOverview summary={summary} />
}
