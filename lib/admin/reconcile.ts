import "server-only"

import { logger } from "@/lib/logger"

import { recordReconciliationRun } from "./db"

// The daily reconciliation.
//
// It asks Paystack what it holds, asks our own ledger the same question, and
// stores both numbers and the difference. It never fails the cron because the two
// disagree: a mismatch is information, not an outage, and a cron that returns 500
// would be retried and would store the same row again.
//
// What it does do is shout. A difference above the threshold is logged at error
// level, which lib/logger turns into a Sentry event, because a difference that
// big is either a missed webhook or a transfer we did not write.

/** ₦1,000. Below this the difference is almost always a settlement in flight. */
export const RECONCILIATION_ALERT_KOBO = BigInt(100_000)

export interface ReconciliationDeps {
  balanceKobo: () => Promise<bigint>
  record: (providerBalanceKobo: bigint) => Promise<{ diffKobo: bigint }>
}

export type ReconciliationOutcome =
  | { status: "recorded"; ledgerKobo: bigint; providerKobo: bigint; diffKobo: bigint; alerted: boolean }
  | { status: "unavailable"; reason: string }

function magnitude(value: bigint): bigint {
  return value < BigInt(0) ? -value : value
}

export async function runDailyReconciliation(deps: ReconciliationDeps): Promise<ReconciliationOutcome> {
  let providerKobo: bigint

  try {
    providerKobo = await deps.balanceKobo()
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown"

    // Paystack being unreachable is a normal morning. It is logged as a warning
    // and the run is skipped: there is no honest row to store without its number.
    logger.warn("reconciliation_balance_unavailable", { reason })

    return { status: "unavailable", reason }
  }

  const { diffKobo } = await deps.record(providerKobo)
  const alerted = magnitude(diffKobo) > RECONCILIATION_ALERT_KOBO

  if (alerted) {
    logger.error("reconciliation_difference", {
      diff_kobo: diffKobo.toString(),
      provider_balance_kobo: providerKobo.toString(),
      threshold_kobo: RECONCILIATION_ALERT_KOBO.toString(),
    })
  }

  return {
    status: "recorded",
    ledgerKobo: providerKobo + diffKobo,
    providerKobo,
    diffKobo,
    alerted,
  }
}

/** The real dependencies: Paystack's balance, and the function that stores the run. */
export async function dailyReconciliationDeps(): Promise<ReconciliationDeps> {
  const { getPaystackTransfers } = await import("@/lib/paystack/transfers")
  const transfers = getPaystackTransfers()

  return {
    balanceKobo: async () => {
      const balances = await transfers.getBalance()
      const naira = balances.find((entry) => entry.currency === "NGN")

      if (naira === undefined) {
        throw new Error("no_ngn_balance")
      }

      return BigInt(naira.balanceKobo)
    },
    record: (providerBalanceKobo) => recordReconciliationRun(providerBalanceKobo),
  }
}
