import { PageHeader } from "@/components/app-shell/page-header"
import { CommissionsPanel } from "@/components/affiliate/commissions-panel"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import {
  getCommissionsAction,
  getCommissionHoldDays,
  getOverviewAction,
} from "@/lib/affiliate/read-actions"
import type { Balance, CommissionRow, Page } from "@/lib/affiliate/read-types"
import { resolveRange } from "@/lib/dates/lagos"

// Earnings: the balance and the commissions behind it.
//
// The balance is a snapshot, not a range: it is what the ledger says right now.
// The overview call is used only for it, with the default range, because the
// ledger balance does not depend on the dates.

export default async function AffiliateEarningsPage() {
  const now = new Date()
  const rangeResult = resolveRange({ preset: "last30" }, now)

  if (!rangeResult.ok) {
    return (
      <>
        <PageHeader title="Earnings" />
        <ErrorNotice message={rangeResult.error} />
      </>
    )
  }

  const [commissionsResult, overviewResult, holdDays] = await Promise.all([
    getCommissionsAction({ limit: 20 }),
    getOverviewAction({ from: rangeResult.range.fromUtc, to: rangeResult.range.toUtc }),
    getCommissionHoldDays(),
  ])

  const initialPage: Page<CommissionRow> = commissionsResult.ok
    ? commissionsResult.data
    : { items: [], nextCursor: null }
  const balance: Balance = overviewResult.ok
    ? overviewResult.data.balance
    : { pendingKobo: 0, availableKobo: 0, totalKobo: 0, negative: false }
  const error = commissionsResult.ok
    ? overviewResult.ok
      ? null
      : overviewResult.error
    : commissionsResult.error

  return (
    <>
      <PageHeader title="Earnings" />
      {error === null ? null : <ErrorNotice message={error} />}
      <div className="mt-4">
        <CommissionsPanel
          initialPage={initialPage}
          initialError={null}
          balance={balance}
          holdDays={holdDays}
        />
      </div>
    </>
  )
}
