import { PageHeader } from "@/components/app-shell/page-header"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getPayoutScreenAction, listBanksAction } from "@/lib/payouts/actions"

import { PayoutDetailsPanel } from "./payout-details-panel"
import { WithdrawalHistory } from "./withdrawal-history"
import { WithdrawPanel } from "./withdraw-panel"

// The pages both apps use. Each app's route file is one line that picks the
// links, so the affiliate and merchant screens cannot drift apart.

/** Payout account and automatic payout. The merchant app also shows withdrawals below it. */
export async function PayoutDetailsPage({
  withdrawalsHref,
  payoutDetailsHref,
  includeWithdrawals,
}: {
  withdrawalsHref: string | null
  payoutDetailsHref: string
  includeWithdrawals: boolean
}) {
  const [screen, banks] = await Promise.all([getPayoutScreenAction(), listBanksAction()])

  if (!screen.ok) {
    return (
      <>
        <PageHeader title="Payout details" />
        <ErrorNotice message={screen.error} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Payout details" />
      <PayoutDetailsPanel
        data={screen.data}
        banks={banks.ok ? banks.data : null}
        banksError={banks.ok ? null : banks.error}
        withdrawalsHref={withdrawalsHref}
      />

      {includeWithdrawals ? (
        <div className="mt-10 space-y-6">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Withdrawals</h2>
          <WithdrawPanel data={screen.data} payoutDetailsHref={payoutDetailsHref} />
          <div>
            <h3 className="mb-3 text-h3 text-foreground">Recent withdrawals</h3>
            <WithdrawalHistory withdrawals={screen.data.withdrawals} />
          </div>
        </div>
      ) : null}
    </>
  )
}

export async function WithdrawalsPage({ payoutDetailsHref }: { payoutDetailsHref: string }) {
  const screen = await getPayoutScreenAction()

  if (!screen.ok) {
    return (
      <>
        <PageHeader title="Withdrawals" />
        <ErrorNotice message={screen.error} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Withdrawals" />
      <WithdrawPanel data={screen.data} payoutDetailsHref={payoutDetailsHref} />
      <div className="mt-8">
        <h2 className="mb-3 text-h3 text-foreground">Recent withdrawals</h2>
        <WithdrawalHistory withdrawals={screen.data.withdrawals} />
      </div>
    </>
  )
}
