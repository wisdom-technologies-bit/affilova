import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { OverviewPanel } from "@/components/admin-finance/overview"
import { PageHeader } from "@/components/app-shell/page-header"
import {
  getAdminDailySeriesAction,
  getAdminOverviewAction,
  resolveOverviewRangeAction,
} from "@/lib/admin/finance-actions"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"

export const dynamic = "force-dynamic"

// The finance overview: the money, the days, and what needs a person.
//
// The range is in the URL (preset, from, to), so the page is bookmarkable and the
// presets are ordinary links. Nothing is computed in the browser.

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (key: string): string | undefined => {
    const value = params[key]

    return Array.isArray(value) ? value[0] : value
  }

  const user = await getAuthUser()

  if (user === null) {
    return (
      <>
        <PageHeader title="Finance" />
        <ErrorNotice message="Sign in to continue." />
      </>
    )
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "ledger:read")) {
    return (
      <>
        <PageHeader title="Finance" />
        <ErrorNotice message="You do not have access to that." />
      </>
    )
  }

  const range = await resolveOverviewRangeAction({
    preset: first("preset"),
    from: first("from"),
    to: first("to"),
  })

  if (!range.ok) {
    return (
      <>
        <PageHeader title="Finance" />
        <ErrorNotice message={range.error} />
      </>
    )
  }

  const [overview, series] = await Promise.all([
    getAdminOverviewAction({ from: range.data.fromTs, to: range.data.toTs }),
    getAdminDailySeriesAction({ from: range.data.from, to: range.data.to }),
  ])

  return (
    <>
      <PageHeader title="Finance" />

      <div className="mb-6 space-y-3">
        <DateRangePicker
          value={{
            preset: range.data.preset as "today" | "last7" | "last30" | "thisMonth" | "custom",
            from: range.data.from,
            to: range.data.to,
          }}
          basePath="/finance"
          today={range.data.to}
        />
      </div>

      {!overview.ok ? (
        <ErrorNotice message={overview.error} />
      ) : !series.ok ? (
        <ErrorNotice message={series.error} />
      ) : (
        <OverviewPanel
          overview={overview.data}
          points={series.data}
          range={{ from: range.data.from, to: range.data.to }}
        />
      )}
    </>
  )
}
