import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import {
  parseDailySeries,
  parseDisputePage,
  parseLedgerPage,
  parseOrderDetail,
  parseOrderPage,
  parseOverview,
  parseReconciliationPage,
  parseRefundPage,
  parseTrialBalance,
  parseVatDetail,
  parseVatExportRows,
  parseVatPeriods,
  parseVatReminderTarget,
  type DailyPoint,
  type DisputeQueueRow,
  type LedgerPage,
  type OrderDetail,
  type OrderRow,
  type Overview,
  type Page,
  type ReconciliationRun,
  type RefundQueueRow,
  type TrialBalance,
  type VatExportRow,
  type VatPeriod,
  type VatPeriodDetail,
  type VatReminderTarget,
} from "./screen-types"

// Typed wrappers around the admin finance SQL functions.
//
// The same three rules as lib/commerce/db.ts: call the function with named
// arguments, refuse an answer that is not the documented shape, and turn a
// PostgrestError into the short code the SQL raised. Money crosses this layer as
// bigint through the parsers in screen-types, never as a float.

export class FinanceRpcError extends Error {
  /** The short code the SQL raised, e.g. forbidden or bad_state. */
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "FinanceRpcError"
    this.code = code
  }
}

function rpcError(name: string, error: { message?: unknown } | null): FinanceRpcError | Error {
  const message = typeof error?.message === "string" ? error.message.trim() : ""

  if (message !== "" && /^[a-z0-9_]{3,60}$/.test(message)) {
    return new FinanceRpcError(message)
  }

  return new Error(`finance_rpc_failed:${name}`)
}

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getSupabaseAdminClient().rpc(name, args)

  if (error !== null) {
    throw rpcError(name, error)
  }

  return data
}

export async function adminOverview(
  actor: string,
  from: string,
  to: string,
): Promise<Overview> {
  return parseOverview(await call("admin_overview", { p_actor: actor, p_from: from, p_to: to }))
}

export async function adminDailySeries(actor: string, from: string, to: string): Promise<DailyPoint[]> {
  return parseDailySeries(await call("admin_daily_series", { p_actor: actor, p_from: from, p_to: to }))
}

export async function adminOrders(
  actor: string,
  query: {
    q: string | null
    status: string | null
    from: string | null
    to: string | null
    limit: number
    cursor: unknown
  },
): Promise<Page<OrderRow>> {
  return parseOrderPage(
    await call("admin_orders_list", {
      p_actor: actor,
      p_q: query.q,
      p_status: query.status,
      p_from: query.from,
      p_to: query.to,
      p_limit: query.limit,
      p_cursor: query.cursor,
    }),
  )
}

export async function adminOrderDetail(actor: string, orderId: string): Promise<OrderDetail | null> {
  return parseOrderDetail(await call("admin_order_detail", { p_actor: actor, p_order: orderId }))
}

export async function adminRefunds(
  actor: string,
  query: { status: string | null; limit: number; cursor: unknown },
): Promise<Page<RefundQueueRow>> {
  return parseRefundPage(
    await call("admin_refunds_list", {
      p_actor: actor,
      p_status: query.status,
      p_limit: query.limit,
      p_cursor: query.cursor,
    }),
  )
}

export async function adminDisputes(
  actor: string,
  query: { status: string | null; limit: number; cursor: unknown },
): Promise<Page<DisputeQueueRow>> {
  return parseDisputePage(
    await call("admin_disputes_list", {
      p_actor: actor,
      p_status: query.status,
      p_limit: query.limit,
      p_cursor: query.cursor,
    }),
  )
}

export async function adminLedger(
  actor: string,
  query: { account: string | null; from: string | null; to: string | null; limit: number; cursor: unknown },
): Promise<LedgerPage> {
  return parseLedgerPage(
    await call("admin_ledger_list", {
      p_actor: actor,
      p_account: query.account,
      p_from: query.from,
      p_to: query.to,
      p_limit: query.limit,
      p_cursor: query.cursor,
    }),
  )
}

export async function adminTrialBalance(actor: string, asOf: string | null): Promise<TrialBalance> {
  return parseTrialBalance(await call("admin_trial_balance", { p_actor: actor, p_as_of: asOf }))
}

export async function adminReconciliationRuns(actor: string, limit: number): Promise<Page<ReconciliationRun>> {
  return parseReconciliationPage(await call("admin_reconciliation_list", { p_actor: actor, p_limit: limit }))
}

export async function vatPeriods(actor: string, year: number): Promise<VatPeriod[]> {
  return parseVatPeriods(await call("vat_periods_list", { p_actor: actor, p_year: year }))
}

export async function vatPeriodDetail(
  actor: string,
  period: string,
  query: { limit: number; cursor: unknown },
): Promise<VatPeriodDetail> {
  return parseVatDetail(
    await call("vat_period_detail", {
      p_actor: actor,
      p_period: period,
      p_limit: query.limit,
      p_cursor: query.cursor,
    }),
  )
}

export async function vatExportRows(actor: string, period: string): Promise<VatExportRow[]> {
  return parseVatExportRows(await call("vat_export_rows", { p_actor: actor, p_period: period }))
}

export async function retryRefundSubmission(
  actor: string,
  requestId: string,
): Promise<{ enqueue: boolean; orderReference: string | null }> {
  const data = await call("retry_refund_submission", { p_actor: actor, p_request: requestId })
  const row = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}

  return {
    enqueue: row.enqueue === true,
    orderReference: typeof row.order_reference === "string" ? row.order_reference : null,
  }
}

/** The service-role-only reminder lookup. No actor: the cron is the caller. */
export async function vatReminderTargets(today: string): Promise<VatReminderTarget | null> {
  return parseVatReminderTarget(await call("vat_reminder_targets", { p_today: today }))
}

/** The service-role-only reconciliation writer. No actor: the cron is the caller. */
export async function recordReconciliationRun(
  providerBalanceKobo: bigint,
): Promise<{ diffKobo: bigint }> {
  const data = await call("record_reconciliation_run", { p_provider_balance_kobo: providerBalanceKobo.toString() })
  const row = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const raw = row.diff_kobo

  return { diffKobo: typeof raw === "string" ? BigInt(raw) : BigInt(typeof raw === "number" ? Math.trunc(raw) : 0) }
}
