import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { PayoutRpcError } from "./db"
import type {
  AdminQueueCursor,
  AdminQueuePage,
  AdminQueueRow,
  AdminQueueTab,
  BlackoutDay,
  PayoutScreenData,
  PayoutSettingChange,
  PayoutSettingsSnapshot,
  ScreenWithdrawal,
} from "./screen-types"
import { PAYOUT_SETTING_KEYS } from "./screen-types"
import type { StepUpPurpose } from "./step-up"

// Typed wrappers around the payout-controls SQL (migration 20261123000100).
//
// Same rules as lib/payouts/db.ts: named arguments, every answer checked before
// it is trusted, a PostgrestError turned into the short code the SQL raised.
// Money is read as bigint. Nothing here returns an account number, a recipient
// code or a code hash: the SQL never selects them.

function failure(name: string): Error {
  return new Error(`payout_rpc_failed:${name}`)
}

function rpcError(name: string, error: { message?: unknown } | null): Error {
  const message = typeof error?.message === "string" ? error.message.trim() : ""

  if (message !== "" && /^[a-z0-9_]{3,60}$/.test(message)) {
    return new PayoutRpcError(message)
  }

  return failure(name)
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]

  return typeof value === "string" && value !== "" ? value : null
}

function big(source: Record<string, unknown>, key: string): bigint | null {
  const value = source[key]

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === "string" && /^-?[0-9]{1,19}$/.test(value)) {
    return BigInt(value)
  }

  return null
}

function bool(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key]

  return typeof value === "boolean" ? value : null
}

// ---------------------------------------------------------------------------
// Step-up codes
// ---------------------------------------------------------------------------

export async function createStepUpCode(call: {
  userId: string
  purpose: StepUpPurpose
  codeHash: string
  expiresInSeconds: number
}): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const { data, error } = await getSupabaseAdminClient().rpc("create_step_up_code", {
    p_user: call.userId,
    p_purpose: call.purpose,
    p_code_hash: call.codeHash,
    p_expires_in_seconds: call.expiresInSeconds,
  })

  if (error) {
    throw rpcError("create_step_up_code", error)
  }

  const row = asObject(data)
  const ok = row === null ? null : bool(row, "ok")
  const retry = row === null ? null : big(row, "retry_after_seconds")

  if (ok === null) {
    throw failure("create_step_up_code")
  }

  return { ok, retryAfterSeconds: retry === null ? 0 : Number(retry) }
}

export async function verifyStepUpCode(call: {
  userId: string
  purpose: StepUpPurpose
  codeHash: string
}): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient().rpc("verify_step_up_code", {
    p_user: call.userId,
    p_purpose: call.purpose,
    p_code_hash: call.codeHash,
  })

  if (error) {
    throw rpcError("verify_step_up_code", error)
  }

  return data === true
}

// ---------------------------------------------------------------------------
// The user screen
// ---------------------------------------------------------------------------

function toScreenWithdrawal(value: unknown): ScreenWithdrawal | null {
  const row = asObject(value)

  if (row === null) {
    return null
  }

  const id = str(row, "id")
  const kind = str(row, "kind")
  const status = str(row, "status")
  const gross = big(row, "gross_kobo")
  const fee = big(row, "fee_kobo")
  const net = big(row, "net_kobo")
  const requestedAt = str(row, "requested_at")

  if (
    id === null ||
    (kind !== "auto" && kind !== "manual") ||
    status === null ||
    gross === null ||
    fee === null ||
    net === null ||
    requestedAt === null
  ) {
    return null
  }

  return {
    id,
    kind,
    status,
    grossKobo: gross,
    feeKobo: fee,
    netKobo: net,
    requestedAt,
    paidAt: str(row, "paid_at"),
    reason: str(row, "reason"),
  }
}

export async function getPayoutScreenData(userId: string): Promise<PayoutScreenData> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_payout_screen_data", {
    p_user: userId,
  })

  if (error) {
    throw rpcError("get_payout_screen_data", error)
  }

  const row = asObject(data)

  if (row === null) {
    throw failure("get_payout_screen_data")
  }

  const account = asObject(row.account)
  const settings = asObject(row.settings)
  const available = big(row, "available_kobo")
  const pending = big(row, "pending_kobo")
  const total = big(row, "total_kobo")
  const auto = bool(row, "auto_payout")
  const isDay = bool(row, "today_is_payout_day")
  const minimum = settings === null ? null : big(settings, "min_withdrawal_kobo")
  const feeBps = settings === null ? null : big(settings, "withdrawal_fee_bps")
  const feeMin = settings === null ? null : big(settings, "withdrawal_fee_min_kobo")
  const feeCap = settings === null ? null : big(settings, "withdrawal_fee_cap_kobo")
  const hold = settings === null ? null : big(settings, "commission_hold_days")

  if (
    available === null ||
    pending === null ||
    total === null ||
    auto === null ||
    isDay === null ||
    minimum === null ||
    feeBps === null ||
    feeMin === null ||
    feeCap === null ||
    hold === null
  ) {
    throw failure("get_payout_screen_data")
  }

  const list = Array.isArray(row.withdrawals) ? row.withdrawals : []
  const withdrawals: ScreenWithdrawal[] = []

  for (const item of list) {
    const parsed = toScreenWithdrawal(item)

    if (parsed !== null) {
      withdrawals.push(parsed)
    }
  }

  let safeAccount: PayoutScreenData["account"] = null

  if (account !== null) {
    const bankName = str(account, "bank_name")
    const last4 = str(account, "account_last4")
    const name = str(account, "account_name")

    if (bankName !== null && last4 !== null && name !== null) {
      safeAccount = {
        bankName,
        accountLast4: last4,
        accountName: name,
        frozenUntil: str(account, "frozen_until"),
      }
    }
  }

  return {
    account: safeAccount,
    autoPayout: auto,
    availableKobo: available,
    pendingKobo: pending,
    totalKobo: total,
    today: str(row, "today") ?? "",
    nextPayoutDay: str(row, "next_payout_day"),
    todayIsPayoutDay: isDay,
    blackoutReason: str(row, "blackout_reason"),
    settings: {
      minWithdrawalKobo: minimum,
      feeBps: Number(feeBps),
      feeMinKobo: feeMin,
      feeCapKobo: feeCap,
      holdDays: Number(hold),
    },
    withdrawals,
  }
}

export async function cancelWithdrawal(userId: string, withdrawalId: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("cancel_withdrawal", {
    p_user: userId,
    p_withdrawal: withdrawalId,
  })

  if (error) {
    throw rpcError("cancel_withdrawal", error)
  }
}

// ---------------------------------------------------------------------------
// Admin: queue, blackout days, settings
// ---------------------------------------------------------------------------

function toQueueRow(value: unknown): AdminQueueRow | null {
  const row = asObject(value)

  if (row === null) {
    return null
  }

  const id = str(row, "id")
  const kind = str(row, "kind")
  const status = str(row, "status")
  const gross = big(row, "gross_kobo")
  const fee = big(row, "fee_kobo")
  const net = big(row, "net_kobo")
  const requestedAt = str(row, "requested_at")
  const bankName = str(row, "bank_name")
  const last4 = str(row, "account_last4")
  const accountName = str(row, "account_name")
  const userId = str(row, "user_id")

  if (
    id === null ||
    userId === null ||
    (kind !== "auto" && kind !== "manual") ||
    status === null ||
    gross === null ||
    fee === null ||
    net === null ||
    requestedAt === null ||
    bankName === null ||
    last4 === null ||
    accountName === null
  ) {
    return null
  }

  const approvals = big(row, "approvals")

  return {
    id,
    userId,
    kind,
    status,
    grossKobo: gross,
    feeKobo: fee,
    netKobo: net,
    requestedAt,
    paidAt: str(row, "paid_at"),
    failureReason: str(row, "failure_reason"),
    bankName,
    accountLast4: last4,
    accountName,
    isFirst: bool(row, "is_first") === true,
    hasRiskFlag: bool(row, "has_risk_flag") === true,
    approvals: approvals === null ? 0 : Number(approvals),
    needsTwoApprovers: bool(row, "needs_two_approvers") === true,
    needsSecondApprover: bool(row, "needs_second_approver") === true,
    firstApprover: str(row, "first_approver"),
  }
}

export async function adminWithdrawalQueue(call: {
  actorId: string
  tab: AdminQueueTab
  limit: number
  cursor: AdminQueueCursor | null
}): Promise<AdminQueuePage> {
  const { data, error } = await getSupabaseAdminClient().rpc("admin_withdrawal_queue", {
    p_actor: call.actorId,
    p_tab: call.tab,
    p_limit: call.limit,
    p_cursor: call.cursor === null ? null : { requested_at: call.cursor.requestedAt, id: call.cursor.id },
  })

  if (error) {
    throw rpcError("admin_withdrawal_queue", error)
  }

  const row = asObject(data)

  if (row === null || !Array.isArray(row.rows)) {
    throw failure("admin_withdrawal_queue")
  }

  const rows: AdminQueueRow[] = []

  for (const item of row.rows) {
    const parsed = toQueueRow(item)

    if (parsed !== null) {
      rows.push(parsed)
    }
  }

  const next = asObject(row.next_cursor)
  const requestedAt = next === null ? null : str(next, "requested_at")
  const id = next === null ? null : str(next, "id")

  return {
    rows,
    nextCursor: requestedAt !== null && id !== null ? { requestedAt, id } : null,
  }
}

export async function listBlackoutDates(from: string, to: string): Promise<BlackoutDay[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("list_blackout_dates", {
    p_from: from,
    p_to: to,
  })

  if (error) {
    throw rpcError("list_blackout_dates", error)
  }

  const days: BlackoutDay[] = []

  for (const item of Array.isArray(data) ? data : []) {
    const row = asObject(item)
    const day = row === null ? null : str(row, "day")

    if (row !== null && day !== null) {
      days.push({ day, reason: str(row, "reason") ?? "" })
    }
  }

  return days
}

export async function addBlackoutDate(actorId: string, day: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("add_payout_blackout", {
    p_actor: actorId,
    p_day: day,
    p_reason: reason,
  })

  if (error) {
    throw rpcError("add_payout_blackout", error)
  }
}

export async function removeBlackoutDate(actorId: string, day: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("remove_payout_blackout", {
    p_actor: actorId,
    p_day: day,
  })

  if (error) {
    throw rpcError("remove_payout_blackout", error)
  }
}

export async function updateSetting(actorId: string, key: string, value: boolean | number): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("update_setting", {
    p_actor: actorId,
    p_key: key,
    p_value: value,
  })

  if (error) {
    throw rpcError("update_setting", error)
  }
}

function settingValue(value: unknown): boolean | bigint | null {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === "string" && /^-?[0-9]{1,19}$/.test(value)) {
    return BigInt(value)
  }

  return null
}

/** The current value of every whitelisted key, and the latest changes to them. */
export async function readPayoutSettings(): Promise<PayoutSettingsSnapshot> {
  const supabase = getSupabaseAdminClient()

  const [current, history] = await Promise.all([
    supabase.from("settings").select("key, value").in("key", [...PAYOUT_SETTING_KEYS]),
    supabase
      .from("settings_history")
      .select("key, old_value, new_value, changed_by, changed_at")
      .in("key", [...PAYOUT_SETTING_KEYS])
      .order("changed_at", { ascending: false })
      .limit(25),
  ])

  if (current.error !== null || history.error !== null) {
    throw failure("read_payout_settings")
  }

  const values: Record<string, boolean | bigint> = {}

  for (const item of (current.data ?? []) as unknown[]) {
    const row = asObject(item)
    const key = row === null ? null : str(row, "key")
    const value = row === null ? null : settingValue(row.value)

    if (key !== null && value !== null) {
      values[key] = value
    }
  }

  const changes: PayoutSettingChange[] = []

  for (const item of (history.data ?? []) as unknown[]) {
    const row = asObject(item)
    const key = row === null ? null : str(row, "key")
    const changedAt = row === null ? null : str(row, "changed_at")

    if (row !== null && key !== null && changedAt !== null) {
      changes.push({
        key,
        oldValue: settingValue(row.old_value),
        newValue: settingValue(row.new_value),
        changedBy: str(row, "changed_by"),
        changedAt,
      })
    }
  }

  return { values, changes }
}
