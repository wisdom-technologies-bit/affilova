import { ErrorNotice } from "@/components/affiliate/status-pill"
import { PageHeader } from "@/components/app-shell/page-header"
import { VatPeriodsView } from "@/components/admin-finance/vat"
import { listVatPeriodsAction } from "@/lib/admin/finance-actions"
import { lagosDayOf } from "@/lib/dates/lagos"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"
import { getVatSettings } from "@/lib/commerce/vat-settings"

export const dynamic = "force-dynamic"

// The VAT year: twelve months, each with its status as a sentence.

export default async function AdminVatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = Array.isArray(params.year) ? params.year[0] : params.year
  const today = lagosDayOf(new Date())
  const year = /^\d{4}$/.test(raw ?? "") ? Number(raw) : Number(today.slice(0, 4))

  const user = await getAuthUser()

  if (user === null) {
    return (
      <>
        <PageHeader title="VAT" />
        <ErrorNotice message="Sign in to continue." />
      </>
    )
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "vat:manage")) {
    return (
      <>
        <PageHeader title="VAT" />
        <ErrorNotice message="You do not have access to that." />
      </>
    )
  }

  const [periods, settings] = await Promise.all([listVatPeriodsAction({ year }), getVatSettings()])

  return (
    <>
      <PageHeader title="VAT" />
      {periods.ok ? (
        <VatPeriodsView
          periods={periods.data}
          year={year}
          vatEnabled={settings.enabled}
          rateBps={settings.rateBps}
          basis={settings.basis}
          today={today}
        />
      ) : (
        <ErrorNotice message={periods.error} />
      )}
    </>
  )
}
