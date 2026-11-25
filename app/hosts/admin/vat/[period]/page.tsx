import { ErrorNotice } from "@/components/affiliate/status-pill"
import { PageHeader } from "@/components/app-shell/page-header"
import { VatDetailView } from "@/components/admin-finance/vat"
import { LinkButton } from "@/components/admin-finance/ui"
import { getVatPeriodAction } from "@/lib/admin/finance-actions"
import { lagosDayOf } from "@/lib/dates/lagos"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"
import { getVatSettings } from "@/lib/commerce/vat-settings"

export const dynamic = "force-dynamic"

// One VAT month: the summary, the adjustments, the tax lines, the export and the
// three workflow buttons.

export default async function AdminVatPeriodPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params
  const user = await getAuthUser()

  if (user === null) {
    return (
      <>
        <PageHeader title="VAT month" />
        <ErrorNotice message="Sign in to continue." />
      </>
    )
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "vat:manage")) {
    return (
      <>
        <PageHeader title="VAT month" />
        <ErrorNotice message="You do not have access to that." />
      </>
    )
  }

  if (!/^\d{4}-\d{2}-01$/.test(period)) {
    return (
      <>
        <PageHeader title="VAT month" />
        <ErrorNotice message="Choose a VAT month." />
      </>
    )
  }

  const [detail, settings] = await Promise.all([getVatPeriodAction({ period }), getVatSettings()])

  return (
    <>
      <PageHeader title="VAT month" />
      <div className="mb-4">
        <LinkButton href="/vat">Back to VAT</LinkButton>
      </div>
      {detail.ok ? (
        <VatDetailView
          detail={detail.data}
          period={period}
          today={lagosDayOf(new Date())}
          vatEnabled={settings.enabled}
        />
      ) : (
        <ErrorNotice message={detail.error} />
      )}
    </>
  )
}
