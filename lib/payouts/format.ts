import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Words for the payout screens. Pure functions: no environment, no database.

/** Basis points as a percent: 200 is "2%", 250 is "2.5%". */
export function bpsToPercent(bps: number): string {
  const percent = bps / 100

  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`
}

/** Naira for a setting value, "Not set" when the database has none. */
export function nairaOrDash(value: bigint | null | undefined): string {
  return value === null || value === undefined ? "Not set" : formatNaira(value)
}

export type WithdrawalStatusKey =
  | "requested"
  | "approved"
  | "processing"
  | "paid"
  | "failed"
  | "reversed"
  | "rejected"
  | "cancelled"

const STATUS_WORDS: Readonly<Record<WithdrawalStatusKey, string>> = {
  requested: "Requested",
  approved: "Approved, queued",
  processing: "Sending to your bank",
  paid: "Paid",
  failed: "Failed, money returned",
  reversed: "Reversed, money returned",
  rejected: "Rejected, money returned",
  cancelled: "Cancelled, money returned",
}

export function withdrawalStatusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_WORDS, status)
    ? STATUS_WORDS[status as WithdrawalStatusKey]
    : "Unknown"
}

/** Plain-language text for each reason withdrawal_preview can give. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  user_not_active: "Your account is not active, so withdrawals are paused.",
  no_account: "Add a payout account first.",
  account_frozen: "Your payout account was changed recently. Withdrawals reopen when the 72 hour wait ends.",
  account_too_new: "Your account is too new to withdraw yet. Try again in a few days.",
  below_minimum: "That is below the minimum withdrawal.",
  insufficient_balance: "That is more than your available balance.",
  daily_limit: "That is over today's withdrawal limit.",
  not_payout_day: "Payouts do not run today.",
}

export function reasonText(reason: string): string {
  return REASON_WORDS[reason] ?? "This withdrawal cannot be requested right now."
}

/** "24 Nov 2026" for a YYYY-MM-DD Lagos day. */
export function formatPayoutDay(day: string | null): string {
  if (day === null || day === "") {
    return "Not scheduled"
  }

  return formatLagosDate(`${day}T12:00:00+01:00`)
}

/** The result line after a request: what happens next. */
export function requestOutcomeText(status: string, needsApproval: boolean): string {
  if (status === "approved") {
    return "Approved and queued"
  }

  return needsApproval ? "Waiting for admin approval" : "Requested"
}

/** True when a YYYY-MM-DD Lagos day is a Saturday or a Sunday. */
export function isWeekendDay(day: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) {
    return false
  }

  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()

  return weekday === 0 || weekday === 6
}

/** "2.5" or "2" percent as basis points, or null when it is not a number with at most two decimals. */
export function percentToBps(input: string): number | null {
  const text = input.trim().replace(/%$/, "").trim()

  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(text)) {
    return null
  }

  return Math.round(Number(text) * 100)
}

/** Basis points as the text of a percent field: 250 is "2.5". */
export function bpsToPercentInput(bps: number): string {
  return (bps / 100).toString()
}
