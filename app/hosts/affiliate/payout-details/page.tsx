import { PayoutDetailsPage } from "@/components/payouts/payout-pages"

// Dynamic: the page reads the signed-in person's own payout account.
export const dynamic = "force-dynamic"

export default async function AffiliatePayoutDetailsPage() {
  return await PayoutDetailsPage({
    withdrawalsHref: "/withdrawals",
    payoutDetailsHref: "/payout-details",
    includeWithdrawals: false,
  })
}
