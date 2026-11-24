import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// Typed wrappers around the payout SQL functions.
//
// Same three rules as lib/commerce/db.ts: call the function with named
// arguments, refuse an answer that does not match the documented shape, and turn
// a PostgrestError into the short code the SQL raised. Money crosses this layer
// as bigint: PostgREST may send a bigint as a number or as a string, and both are
// read exactly.

export class PayoutRpcError extends Error {
  /** The short code the SQL raised, e.g. no_account or insufficient_balance. */
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "PayoutRpcError"
    this.code = code
  }
}

function failure(name: string): Error {
  return new Error(`payout_rpc_failed:${name}`)
}

function rpcError(name: string, error: { message?: unknown } | null): PayoutRpcError | Error {
  const message = typeof error?.message === "string" ? error.message.trim() : ""

  if (message !== "" && /^[a-z0-9_]{3,60}$/.test(message)) {
    return new PayoutRpcError(message)
  }

  return failure(name)
}

function asObject(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null
  }

  return data as Record<string, unknown>
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]

  return typeof value === "string" && value !== "" ? value : null
}

/** Exact for any integer PostgREST sends, as a number or as a decimal string. */
function readBigInt(source: Record<string, unknown>, key: string): bigint | null {
  const value = source[key]

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === "string" && /^-?[0-9]{1,19}$/.test(value)) {
    return BigInt(value)
  }

  return null
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key]

  return typeof value === "boolean" ? value : null
}

function readStringArray(source: Record<string, unknown>, key: string): string[] | null {
  const value = source[key]

  if (!Array.isArray(value)) {
    return null
  }

  const items = value.filter((item): item is string => typeof item === "string")

  return items.length === value.length ? items : null
}

// ---------------------------------------------------------------------------
// Payout accounts and preferences
// ---------------------------------------------------------------------------

export interface SetPayoutAccountCall {
  userId: string
  bankCode: string
  bankName: string
  accountLast4: string
  accountName: string
  recipientCode: string
  nameMatch: boolean
}

export async function setPayoutAccount(call: SetPayoutAccountCall): Promise<string> {
  const { data, error } = await getSupabaseAdminClient().rpc("set_payout_account", {
    p_user: call.userId,
    p_bank_code: call.bankCode,
    p_bank_name: call.bankName,
    p_account_last4: call.accountLast4,
    p_account_name: call.accountName,
    p_recipient_code: call.recipientCode,
    p_name_match: call.nameMatch,
  })

  if (error) {
    throw rpcError("set_payout_account", error)
  }

  if (typeof data !== "string" || data === "") {
    throw failure("set_payout_account")
  }

  return data
}

export async function setAutoPayout(userId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("set_auto_payout", {
    p_user: userId,
    p_enabled: enabled,
  })

  if (error) {
    throw rpcError("set_auto_payout", error)
  }
}

// ---------------------------------------------------------------------------
// Preview and requests
// ---------------------------------------------------------------------------

export interface WithdrawalPreview {
  allowed: boolean
  reasons: readonly string[]
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  availableKobo: bigint
  nextPayoutDay: string | null
  needsApproval: boolean
}

function toPreview(data: unknown): WithdrawalPreview {
  const row = asObject(data)

  if (row === null) {
    throw failure("withdrawal_preview")
  }

  const reasons = readStringArray(row, "reasons")
  const grossKobo = readBigInt(row, "gross_kobo")
  const feeKobo = readBigInt(row, "fee_kobo")
  const netKobo = readBigInt(row, "net_kobo")
  const availableKobo = readBigInt(row, "available_kobo")
  const allowed = readBoolean(row, "allowed")
  const needsApproval = readBoolean(row, "needs_approval")

  if (
    reasons === null ||
    grossKobo === null ||
    feeKobo === null ||
    netKobo === null ||
    availableKobo === null ||
    allowed === null ||
    needsApproval === null
  ) {
    throw failure("withdrawal_preview")
  }

  return {
    allowed,
    reasons,
    grossKobo,
    feeKobo,
    netKobo,
    availableKobo,
    nextPayoutDay: readString(row, "next_payout_day"),
    needsApproval,
  }
}

export async function withdrawalPreview(userId: string, amountKobo: bigint): Promise<WithdrawalPreview> {
  const { data, error } = await getSupabaseAdminClient().rpc("withdrawal_preview", {
    p_user: userId,
    p_amount_kobo: amountKobo.toString(),
  })

  if (error) {
    throw rpcError("withdrawal_preview", error)
  }

  return toPreview(data)
}

export interface RequestWithdrawalCall {
  userId: string
  amountKobo: bigint
  kind: "auto" | "manual"
  reference: string
}

export interface RequestedWithdrawal {
  withdrawalId: string
  status: string
  needsApproval: boolean
}

export async function requestWithdrawal(call: RequestWithdrawalCall): Promise<RequestedWithdrawal> {
  const { data, error } = await getSupabaseAdminClient().rpc("request_withdrawal", {
    p_user: call.userId,
    p_amount_kobo: call.amountKobo.toString(),
    p_kind: call.kind,
    p_reference: call.reference,
  })

  if (error) {
    throw rpcError("request_withdrawal", error)
  }

  const row = asObject(data)
  const withdrawalId = row === null ? null : readString(row, "withdrawal_id")
  const status = row === null ? null : readString(row, "status")
  const needsApproval = row === null ? null : readBoolean(row, "needs_approval")

  if (withdrawalId === null || status === null || needsApproval === null) {
    throw failure("request_withdrawal")
  }

  return { withdrawalId, status, needsApproval }
}

// ---------------------------------------------------------------------------
// Transfer claims
// ---------------------------------------------------------------------------

export interface ClaimedWithdrawal {
  id: string
  reference: string
  netKobo: bigint
  recipientCode: string
  userId: string
}

export async function claimWithdrawalsForTransfer(limit: number): Promise<ClaimedWithdrawal[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("claim_withdrawals_for_transfer", {
    p_limit: limit,
  })

  if (error) {
    throw rpcError("claim_withdrawals_for_transfer", error)
  }

  if (!Array.isArray(data)) {
    return []
  }

  const rows: ClaimedWithdrawal[] = []

  for (const item of data) {
    const row = asObject(item)

    if (row === null) {
      throw failure("claim_withdrawals_for_transfer")
    }

    const id = readString(row, "id")
    const reference = readString(row, "reference")
    const netKobo = readBigInt(row, "net_kobo")
    const recipientCode = readString(row, "recipient_code")
    const userId = readString(row, "user_id")

    if (id === null || reference === null || netKobo === null || recipientCode === null || userId === null) {
      throw failure("claim_withdrawals_for_transfer")
    }

    rows.push({ id, reference, netKobo, recipientCode, userId })
  }

  return rows
}

export async function releaseClaimedWithdrawals(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) {
    return 0
  }

  const { data, error } = await getSupabaseAdminClient().rpc("release_claimed_withdrawals", {
    p_ids: ids,
  })

  if (error) {
    throw rpcError("release_claimed_withdrawals", error)
  }

  if (typeof data === "number" && Number.isInteger(data)) {
    return data
  }

  return 0
}

export async function markTransferSubmitted(
  withdrawalId: string,
  transferCode: string,
  transferId: bigint,
): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("mark_transfer_submitted", {
    p_withdrawal: withdrawalId,
    p_transfer_code: transferCode,
    p_transfer_id: transferId.toString(),
  })

  if (error) {
    throw rpcError("mark_transfer_submitted", error)
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TransferEvent = "success" | "failed" | "reversed"

export interface RecordTransferResultCall {
  reference: string
  event: TransferEvent
  transferCode: string | null
  reason: string | null
  /** The fee Paystack reported, in kobo. Null uses the configured bands. */
  feeKobo: bigint | null
}

export interface TransferResultOutcome {
  status: string
  applied: boolean
}

export async function recordTransferResult(call: RecordTransferResultCall): Promise<TransferResultOutcome> {
  const { data, error } = await getSupabaseAdminClient().rpc("record_transfer_result", {
    p_reference: call.reference,
    p_event: call.event,
    p_transfer_code: call.transferCode,
    p_reason: call.reason,
    p_fee_kobo: call.feeKobo === null ? null : call.feeKobo.toString(),
  })

  if (error) {
    throw rpcError("record_transfer_result", error)
  }

  const row = asObject(data)
  const status = row === null ? null : readString(row, "status")
  const applied = row === null ? null : readBoolean(row, "applied")

  if (status === null || applied === null) {
    throw failure("record_transfer_result")
  }

  return { status, applied }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function listAutoPayoutCandidates(limit: number): Promise<string[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("list_auto_payout_candidates", {
    p_limit: limit,
  })

  if (error) {
    throw rpcError("list_auto_payout_candidates", error)
  }

  if (!Array.isArray(data)) {
    return []
  }

  const ids: string[] = []

  for (const item of data) {
    const row = asObject(item)
    const userId = row === null ? null : readString(row, "user_id")

    if (userId !== null) {
      ids.push(userId)
    }
  }

  return ids
}

export interface StuckWithdrawal {
  id: string
  reference: string
  transferCode: string | null
  netKobo: bigint
}

export async function listStuckWithdrawals(olderThan: string): Promise<StuckWithdrawal[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("list_stuck_withdrawals", {
    p_older_than: olderThan,
  })

  if (error) {
    throw rpcError("list_stuck_withdrawals", error)
  }

  if (!Array.isArray(data)) {
    return []
  }

  const rows: StuckWithdrawal[] = []

  for (const item of data) {
    const row = asObject(item)

    if (row === null) {
      throw failure("list_stuck_withdrawals")
    }

    const id = readString(row, "id")
    const reference = readString(row, "reference")
    const netKobo = readBigInt(row, "net_kobo")

    if (id === null || reference === null || netKobo === null) {
      continue
    }

    rows.push({ id, reference, transferCode: readString(row, "paystack_transfer_code"), netKobo })
  }

  return rows
}

/** The configured Paystack transfer fee for an amount, from the bands. */
export async function transferFee(amountKobo: bigint): Promise<bigint> {
  const { data, error } = await getSupabaseAdminClient().rpc("payout_transfer_fee", {
    p_amount_kobo: amountKobo.toString(),
  })

  if (error) {
    return BigInt(0)
  }

  if (typeof data === "number" && Number.isInteger(data)) {
    return BigInt(data)
  }

  if (typeof data === "string" && /^[0-9]{1,19}$/.test(data)) {
    return BigInt(data)
  }

  return BigInt(0)
}

// ---------------------------------------------------------------------------
// Approval lookup and the admin overview
// ---------------------------------------------------------------------------

export interface WithdrawalForApproval {
  found: boolean
  status: string | null
  netKobo: bigint | null
  recipientCode: string | null
  transferCode: string | null
}

export async function getWithdrawalForApproval(reference: string): Promise<WithdrawalForApproval> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_withdrawal_for_approval", {
    p_reference: reference,
  })

  if (error) {
    throw rpcError("get_withdrawal_for_approval", error)
  }

  const row = asObject(data)

  if (row === null || readBoolean(row, "found") !== true) {
    return { found: false, status: null, netKobo: null, recipientCode: null, transferCode: null }
  }

  return {
    found: true,
    status: readString(row, "status"),
    netKobo: readBigInt(row, "net_kobo"),
    recipientCode: readString(row, "recipient_code"),
    transferCode: readString(row, "transfer_code"),
  }
}

export interface PayoutOverviewRow {
  counts: Readonly<Record<string, number>>
  grossKobo: Readonly<Record<string, bigint>>
  oldestRequestedSeconds: number
  failedLast7Days: number
}

export async function payoutOverview(actorId: string): Promise<PayoutOverviewRow> {
  const { data, error } = await getSupabaseAdminClient().rpc("payout_overview", {
    p_actor: actorId,
  })

  if (error) {
    throw rpcError("payout_overview", error)
  }

  const row = asObject(data)

  if (row === null) {
    throw failure("payout_overview")
  }

  const counts: Record<string, number> = {}
  const grossKobo: Record<string, bigint> = {}

  const rawCounts = asObject(row.counts)
  const rawKobo = asObject(row.gross_kobo)

  if (rawCounts !== null) {
    for (const [key, value] of Object.entries(rawCounts)) {
      if (typeof value === "number" && Number.isInteger(value)) {
        counts[key] = value
      }
    }
  }

  if (rawKobo !== null) {
    for (const [key, value] of Object.entries(rawKobo)) {
      const amount = readBigInt(rawKobo, key)

      if (amount !== null) {
        grossKobo[key] = amount
      }
    }
  }

  const oldest = row.oldest_requested_seconds
  const failed = row.failed_last_7_days

  return {
    counts,
    grossKobo,
    oldestRequestedSeconds: typeof oldest === "number" && Number.isFinite(oldest) ? oldest : 0,
    failedLast7Days: typeof failed === "number" && Number.isInteger(failed) ? failed : 0,
  }
}

// ---------------------------------------------------------------------------
// Admin decisions
// ---------------------------------------------------------------------------

export async function approveWithdrawal(
  actorId: string,
  withdrawalId: string,
  note: string | null,
): Promise<{ status: string; needsSecondApproval: boolean }> {
  const { data, error } = await getSupabaseAdminClient().rpc("approve_withdrawal", {
    p_actor: actorId,
    p_withdrawal: withdrawalId,
    p_note: note,
  })

  if (error) {
    throw rpcError("approve_withdrawal", error)
  }

  const row = asObject(data)
  const status = row === null ? null : readString(row, "status")
  const needsSecondApproval = row === null ? null : readBoolean(row, "needs_second_approval")

  if (status === null || needsSecondApproval === null) {
    throw failure("approve_withdrawal")
  }

  return { status, needsSecondApproval }
}

export async function rejectWithdrawal(
  actorId: string,
  withdrawalId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("reject_withdrawal", {
    p_actor: actorId,
    p_withdrawal: withdrawalId,
    p_reason: reason,
  })

  if (error) {
    throw rpcError("reject_withdrawal", error)
  }
}
