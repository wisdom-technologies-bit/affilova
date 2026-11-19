import "server-only"

import type { PaidOrderInput, PaidOrderResult } from "@/lib/commerce/db"
import { logger } from "@/lib/logger"
import { PaystackError, type VerifiedTransaction } from "@/lib/paystack/client"

// Reconciling pending orders against Paystack.
//
// Paystack only sends webhooks for successful charges, so an order that was paid
// while the webhook was lost, or paid a second before the buyer closed the tab,
// stays pending until someone asks. This sweep asks.
//
// It is deliberately conservative:
//   * only orders older than ten minutes and younger than a day are asked about
//     (the window lives in list_orders_needing_verification);
//   * the calls are sequential, so the run is predictable and rate-limit safe;
//   * the run stops before its time budget is spent rather than being killed
//     mid-request, so the next tick starts clean;
//   * an order that is not paid is left alone. It is not failed here: the
//     expiry job owns that, and "abandoned" is a normal outcome, not an error.

export const RECONCILE_BATCH = 50

/** Stop starting new verifications after this. The route must answer in 30s. */
export const RECONCILE_TIME_BUDGET_MS = 18_000

export interface ReconcileDeps {
  listReferences: (limit: number) => Promise<string[]>
  verifyTransaction: (reference: string) => Promise<VerifiedTransaction>
  processPaidOrder: (input: PaidOrderInput) => Promise<PaidOrderResult>
  /** Injected so a test does not wait on the wall clock. */
  now?: () => number
  log?: {
    info: (event: string, fields?: Record<string, unknown>) => void
    warn: (event: string, fields?: Record<string, unknown>) => void
    error: (event: string, fields?: Record<string, unknown>) => void
  }
}

export interface ReconcileSummary {
  checked: number
  paid: number
  skipped: number
  failed: number
  /** True when the time budget ran out before the batch was finished. */
  stoppedEarly: boolean
}

export async function runReconcilePending(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const now = deps.now ?? Date.now
  const log = deps.log ?? logger
  const startedAt = now()

  const summary: ReconcileSummary = {
    checked: 0,
    paid: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
  }

  const references = await deps.listReferences(RECONCILE_BATCH)

  for (const reference of references) {
    if (now() - startedAt >= RECONCILE_TIME_BUDGET_MS) {
      summary.stoppedEarly = true
      break
    }

    summary.checked += 1

    let verified: VerifiedTransaction

    try {
      verified = await deps.verifyTransaction(reference)
    } catch (error) {
      summary.failed += 1

      log.warn("reconcile_verify_failed", {
        reference,
        code: error instanceof PaystackError ? error.code : "unknown",
      })

      continue
    }

    if (verified.status !== "success") {
      // abandoned, failed, ongoing, pending: the expiry job will deal with it.
      summary.skipped += 1
      continue
    }

    try {
      const result = await deps.processPaidOrder({
        reference: verified.reference,
        paystackTransactionId: verified.id,
        amountKobo: verified.amountKobo,
        currency: verified.currency,
        feesKobo: verified.feesKobo ?? 0,
        channel: verified.channel,
        paidAt: verified.paidAt,
      })

      if (result.status === "processed" || result.status === "already_paid") {
        summary.paid += 1
        continue
      }

      if (result.status === "mismatch") {
        summary.failed += 1
        log.error("reconcile_amount_mismatch", { reference, order: result.orderId })
        continue
      }

      summary.skipped += 1
      log.warn("reconcile_order_not_found", { reference })
    } catch (error) {
      summary.failed += 1
      log.error("reconcile_paid_order_failed", { reference, error })
    }
  }

  return summary
}
