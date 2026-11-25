import { WithdrawalsPage } from "@/components/payouts/payout-pages"

export const dynamic = "force-dynamic"

export default async function AffiliateWithdrawalsPage() {
  return await WithdrawalsPage({ payoutDetailsHref: "/payout-details" })
}
