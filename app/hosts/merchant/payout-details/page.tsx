import { PayoutDetailsPage } from "@/components/payouts/payout-pages"

export const dynamic = "force-dynamic"

// The merchant navigation has no Withdrawals entry, so the balance, the withdraw
// form and the history are shown below the payout account on this page.
export default async function MerchantPayoutDetailsPage() {
  return await PayoutDetailsPage({
    withdrawalsHref: null,
    payoutDetailsHref: "/payout-details",
    includeWithdrawals: true,
  })
}
