import { PaystackError } from "@/lib/paystack/client"

import { namesMatch } from "./name-match"

// Payout orchestration, with every side effect injected.
//
// Nothing here reads an environment variable, opens a socket or touches a
// database by itself: the transfers client and the SQL wrappers arrive as
// arguments. That is what lets the tests drive every branch, including a Paystack
// rejection, a low balance and a transfer that is stuck in processing, with no
// network and no database.

/** The fixed, neutral reason every payout carries. */
export const PAYOUT_TRANSFER_REASON = "Affilova payout"

/** 24 lowercase alphanumerics after "wd_": 27 characters, inside Paystack's 16-50. */
const REFERENCE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
const REFERENCE_BODY_LENGTH = 24

export function payoutReference(random: (max: number) => number = randomInt): string {
  let body = ""

  for (let index = 0; index < REFERENCE_BODY_LENGTH; index += 1) {
    body += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)]
  }

  return `wd_${body}`
}

function randomInt(max: number): number {
  // crypto.randomInt is uniform and needs no new dependency.
  const cryptoModule = globalThis.crypto

  if (cryptoModule !== undefined && typeof cryptoModule.getRandomValues === "function") {
    const buffer = new Uint32Array(1)
    cryptoModule.getRandomValues(buffer)

    return (buffer[0] as number) % max
  }

  return Math.floor(Math.random() * max)
}

// ---------------------------------------------------------------------------
// The injected surface
// ---------------------------------------------------------------------------

export interface PayoutTransfersPort {
  resolveAccount: (input: { accountNumber: string; bankCode: string }) => Promise<{
    accountName: string
    accountNumber: string
  }>
  createRecipient: (input: {
    name: string
    accountNumber: string
    bankCode: string
  }) => Promise<{ recipientCode: string; name: string }>
  getBalance: () => Promise<readonly { currency: string; balanceKobo: number }[]>
  initiateTransfer: (input: {
    amountKobo: number
    recipientCode: string
    reference: string
    reason: string
  }) => Promise<{
    transferCode: string
    transferId: bigint | null
    reference: string
    status: string
    amountKobo: number
    feeKobo: number | null
    alreadySubmitted: boolean
  }>
  getTransferByReference: (reference: string) => Promise<{
    transferCode: string
    reference: string
    status: string
    amountKobo: number
    feeKobo: number | null
  }>
}

export interface PayoutStorePort {
  setPayoutAccount: (call: {
    userId: string
    bankCode: string
    bankName: string
    accountLast4: string
    accountName: string
    recipientCode: string
    nameMatch: boolean
  }) => Promise<string>
  withdrawalPreview: (
    userId: string,
    amountKobo: bigint,
  ) => Promise<{
    allowed: boolean
    reasons: readonly string[]
    grossKobo: bigint
    feeKobo: bigint
    netKobo: bigint
    availableKobo: bigint
    nextPayoutDay: string | null
    needsApproval: boolean
  }>
  requestWithdrawal: (call: {
    userId: string
    amountKobo: bigint
    kind: "auto" | "manual"
    reference: string
  }) => Promise<{ withdrawalId: string; status: string; needsApproval: boolean }>
  claimWithdrawalsForTransfer: (limit: number) => Promise<
    readonly { id: string; reference: string; netKobo: bigint; recipientCode: string; userId: string }[]
  >
  releaseClaimedWithdrawals: (ids: readonly string[]) => Promise<number>
  markTransferSubmitted: (withdrawalId: string, transferCode: string, transferId: bigint) => Promise<void>
  recordTransferResult: (call: {
    reference: string
    event: "success" | "failed" | "reversed"
    transferCode: string | null
    reason: string | null
    feeKobo: bigint | null
  }) => Promise<{ status: string; applied: boolean }>
  listAutoPayoutCandidates: (limit: number) => Promise<string[]>
  listStuckWithdrawals: (
    olderThan: string,
  ) => Promise<readonly { id: string; reference: string; transferCode: string | null; netKobo: bigint }[]>
  transferFee: (amountKobo: bigint) => Promise<bigint>
}

export interface PayoutLog {
  info: (event: string, fields?: Record<string, unknown>) => void
  warn: (event: string, fields?: Record<string, unknown>) => void
  error: (event: string, fields?: Record<string, unknown>) => void
}

export interface PayoutServiceDeps {
  transfers: PayoutTransfersPort
  store: PayoutStorePort
  log: PayoutLog
  /** Milliseconds, injected so the time budget is testable. */
  now?: () => number
  /** Injected so a test can make references predictable. */
  newReference?: () => string
  /**
   * Called after a transfer result was recorded here (a definite refusal or a
   * reconcile), so the user can be told. A failure in it never undoes the result.
   */
  onSettled?: (call: { reference: string; status: string; applied: boolean }) => Promise<void>
}

export interface PayoutService {
  prepareAccount: (input: {
    userId: string
    bankCode: string
    bankName: string
    accountNumber: string
    profileName: string
  }) => Promise<
    | { status: "ok"; accountId: string; resolvedName: string }
    | { status: "name_mismatch"; resolvedName: string }
  >
  previewWithdrawal: (userId: string, amountKobo: bigint) => Promise<Awaited<ReturnType<PayoutStorePort["withdrawalPreview"]>>>
  requestManualWithdrawal: (input: { userId: string; amountKobo: bigint }) => Promise<{
    withdrawalId: string
    status: string
    needsApproval: boolean
    reference: string
  }>
  runAutoPayouts: (input?: { limit?: number; budgetMs?: number }) => Promise<AutoPayoutSummary>
  processApprovedWithdrawals: (input?: {
    batchSize?: number
    budgetMs?: number
  }) => Promise<TransferBatchSummary>
  reconcileStuck: (input?: { olderThan?: string }) => Promise<ReconcileSummary>
}

export interface AutoPayoutSummary {
  candidates: number
  requested: number
  skipped: number
  failed: number
  stoppedEarly: boolean
}

export interface TransferBatchSummary {
  claimed: number
  submitted: number
  failed: number
  released: number
  lowBalance: boolean
  otpPending: number
  /** True when the time budget stopped the pass and the rest went back. */
  stoppedEarly: boolean
}

export interface ReconcileSummary {
  checked: number
  settled: number
  stillPending: number
  failed: number
}

const DEFAULT_AUTO_BUDGET_MS = 18_000
const DEFAULT_AUTO_LIMIT = 50
const DEFAULT_BATCH_SIZE = 20
const DEFAULT_STUCK_AGE = "15 minutes"
const DEFAULT_TRANSFER_BUDGET_MS = 15_000

/** Paystack's transfer statuses mapped onto our three result events. */
function eventForStatus(status: string): "success" | "failed" | "reversed" | null {
  if (status === "success") {
    return "success"
  }

  if (status === "failed" || status === "rejected" || status === "abandoned" || status === "blocked") {
    return "failed"
  }

  if (status === "reversed") {
    return "reversed"
  }

  return null
}

/** A reason short enough for the column and free of anything identifying. */
function safeReason(error: unknown): string {
  if (error instanceof PaystackError) {
    return `paystack_${error.code}`
  }

  return "paystack_error"
}

export function createPayoutService(deps: PayoutServiceDeps): PayoutService {
  const now = deps.now ?? (() => Date.now())
  const newReference = deps.newReference ?? (() => payoutReference())

  async function notifySettled(reference: string, outcome: { status: string; applied: boolean }): Promise<void> {
    if (deps.onSettled === undefined) {
      return
    }

    try {
      await deps.onSettled({ reference, status: outcome.status, applied: outcome.applied })
    } catch {
      deps.log.warn("payout_settled_hook_failed", { reference })
    }
  }

  return {
    async prepareAccount(input) {
      const resolved = await deps.transfers.resolveAccount({
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      })

      const matched = namesMatch(input.profileName, resolved.accountName)

      if (!matched) {
        // Nothing is stored and no recipient is created: an account we cannot
        // put a name to is an account we must not pay.
        deps.log.warn("payout_name_mismatch", { userId: input.userId })

        return { status: "name_mismatch", resolvedName: resolved.accountName }
      }

      const recipient = await deps.transfers.createRecipient({
        name: resolved.accountName,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      })

      const accountId = await deps.store.setPayoutAccount({
        userId: input.userId,
        bankCode: input.bankCode,
        bankName: input.bankName,
        // Only the last four digits ever leave this function.
        accountLast4: input.accountNumber.slice(-4),
        accountName: resolved.accountName,
        recipientCode: recipient.recipientCode,
        nameMatch: true,
      })

      deps.log.info("payout_account_set", { userId: input.userId })

      return { status: "ok", accountId, resolvedName: resolved.accountName }
    },

    async previewWithdrawal(userId, amountKobo) {
      return deps.store.withdrawalPreview(userId, amountKobo)
    },

    async requestManualWithdrawal(input) {
      const reference = newReference()

      const requested = await deps.store.requestWithdrawal({
        userId: input.userId,
        amountKobo: input.amountKobo,
        kind: "manual",
        reference,
      })

      return { ...requested, reference }
    },

    async runAutoPayouts(input) {
      const limit = input?.limit ?? DEFAULT_AUTO_LIMIT
      const budgetMs = input?.budgetMs ?? DEFAULT_AUTO_BUDGET_MS
      const started = now()

      const summary: AutoPayoutSummary = {
        candidates: 0,
        requested: 0,
        skipped: 0,
        failed: 0,
        stoppedEarly: false,
      }

      const candidates = await deps.store.listAutoPayoutCandidates(limit)
      summary.candidates = candidates.length

      for (const userId of candidates) {
        if (now() - started >= budgetMs) {
          summary.stoppedEarly = true
          deps.log.warn("payout_auto_budget_reached", {
            candidates: summary.candidates,
            requested: summary.requested,
          })
          break
        }

        try {
          // The whole available balance, read from the same function the preview
          // uses. A zero amount is only a probe: it reports available_kobo.
          const preview = await deps.store.withdrawalPreview(userId, BigInt(0))

          if (preview.availableKobo <= BigInt(0)) {
            summary.skipped += 1
            continue
          }

          await deps.store.requestWithdrawal({
            userId,
            amountKobo: preview.availableKobo,
            kind: "auto",
            reference: newReference(),
          })

          summary.requested += 1
        } catch (error) {
          // One user's failure never stops the batch.
          summary.failed += 1

          deps.log.warn("payout_auto_failed", {
            userId,
            code: error instanceof Error ? error.name : "unknown",
          })
        }
      }

      return summary
    },

    async processApprovedWithdrawals(input) {
      const batchSize = input?.batchSize ?? DEFAULT_BATCH_SIZE
      const budgetMs = input?.budgetMs ?? DEFAULT_TRANSFER_BUDGET_MS
      const started = now()

      const claimed = await deps.store.claimWithdrawalsForTransfer(batchSize)

      const summary: TransferBatchSummary = {
        claimed: claimed.length,
        submitted: 0,
        failed: 0,
        released: 0,
        lowBalance: false,
        otpPending: 0,
        stoppedEarly: false,
      }

      if (claimed.length === 0) {
        return summary
      }

      let required = BigInt(0)

      for (const item of claimed) {
        required += item.netKobo + (await deps.store.transferFee(item.netKobo))
      }

      const balances = await deps.transfers.getBalance()
      const ngn = balances.find((entry) => entry.currency === "NGN")
      const balance = ngn === undefined ? BigInt(0) : BigInt(ngn.balanceKobo)

      if (balance < required) {
        summary.lowBalance = true

        // The batch goes back to approved so the next run can try again. This is
        // an error, not a warning: somebody has to top the balance up.
        summary.released = await deps.store.releaseClaimedWithdrawals(claimed.map((item) => item.id))

        deps.log.error("payout_balance_low", {
          requiredKobo: required.toString(),
          balanceKobo: balance.toString(),
          withdrawals: claimed.length,
          released: summary.released,
        })

        return summary
      }

      for (const [index, item] of claimed.entries()) {
        if (now() - started >= budgetMs) {
          // Out of time. Everything not yet sent goes back to approved, so the
          // next run picks it up; nothing is left holding a claim.
          const rest = claimed.slice(index).map((pending) => pending.id)

          summary.stoppedEarly = true
          summary.released += await deps.store.releaseClaimedWithdrawals(rest)

          deps.log.warn("payout_transfer_budget_reached", {
            released: summary.released,
            submitted: summary.submitted,
          })

          break
        }

        try {
          const transfer = await deps.transfers.initiateTransfer({
            amountKobo: Number(item.netKobo),
            recipientCode: item.recipientCode,
            reference: item.reference,
            reason: PAYOUT_TRANSFER_REASON,
          })

          if (transfer.alreadySubmitted) {
            // Paystack already has this reference. The transfer is real; only a
            // result settles it, so it stays processing for the reconciler.
            deps.log.warn("payout_transfer_already_submitted", { reference: item.reference })

            continue
          }

          await deps.store.markTransferSubmitted(
            item.id,
            transfer.transferCode,
            transfer.transferId ?? BigInt(0),
          )

          if (transfer.status === "otp") {
            summary.otpPending += 1

            deps.log.error("payout_transfer_otp_required", { reference: item.reference })

            continue
          }

          summary.submitted += 1
        } catch (error) {
          if (error instanceof PaystackError && !error.retryable) {
            // A definite refusal: no money moved, so the ledger goes back to the
            // user now rather than after a reconcile pass.
            summary.failed += 1

            const outcome = await deps.store.recordTransferResult({
              reference: item.reference,
              event: "failed",
              transferCode: null,
              reason: safeReason(error),
              feeKobo: null,
            })

            await notifySettled(item.reference, outcome)

            deps.log.warn("payout_transfer_rejected", {
              reference: item.reference,
              code: error.code,
            })

            continue
          }

          // An unknown outcome. The row stays processing and reconcileStuck()
          // asks Paystack what happened; never a second initiate.
          deps.log.warn("payout_transfer_uncertain", {
            reference: item.reference,
            code: error instanceof PaystackError ? error.code : "unknown",
          })
        }
      }

      return summary
    },

    async reconcileStuck(input) {
      const olderThan = input?.olderThan ?? DEFAULT_STUCK_AGE

      const stuck = await deps.store.listStuckWithdrawals(olderThan)

      const summary: ReconcileSummary = {
        checked: stuck.length,
        settled: 0,
        stillPending: 0,
        failed: 0,
      }

      for (const item of stuck) {
        try {
          const transfer = await deps.transfers.getTransferByReference(item.reference)
          const event = eventForStatus(transfer.status)

          if (event === null) {
            summary.stillPending += 1
            continue
          }

          const outcome = await deps.store.recordTransferResult({
            reference: item.reference,
            event,
            transferCode: transfer.transferCode === "" ? null : transfer.transferCode,
            reason: event === "success" ? null : `paystack_${transfer.status}`,
            feeKobo: transfer.feeKobo === null ? null : BigInt(transfer.feeKobo),
          })

          await notifySettled(item.reference, outcome)

          summary.settled += 1
        } catch (error) {
          summary.failed += 1

          deps.log.warn("payout_reconcile_failed", {
            reference: item.reference,
            code: error instanceof PaystackError ? error.code : "unknown",
          })
        }
      }

      return summary
    },
  }
}
