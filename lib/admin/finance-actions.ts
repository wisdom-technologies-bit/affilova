"use server"

import { z } from "zod"

import { catalogErrorMessage, GENERIC_ERROR } from "@/lib/catalog/errors"
import { resolveRange } from "@/lib/dates/lagos"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { enqueueJob } from "@/lib/jobs/queue"
import { logger } from "@/lib/logger"
import { decodeCursor } from "@/lib/pagination/cursor"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import * as db from "./db"
import { FinanceRpcError } from "./db"
import type {
  DailyPoint,
  DisputeQueueRow,
  LedgerPage,
  OrderDetail,
  OrderRow,
  Overview,
  Page,
  ReconciliationRun,
  RefundQueueRow,
  TrialBalance,
  VatPeriod,
  VatPeriodDetail,
} from "./screen-types"

// The admin finance actions.
//
// Every one of them does the same five things in the same order, and in this
// order only: who is calling, what roles they hold, may they do this, is the
// input well formed, have they done it too often. Only then is the database
// asked. The actor passed to SQL is always the authenticated user's id, never a
// value from the request.
//
// Nothing here returns a database message. A short code becomes a sentence from
// the error table, and anything else becomes the generic sentence.

const NOT_SIGNED_IN = catalogErrorMessage("not_authenticated")
const FORBIDDEN = catalogErrorMessage("forbidden")
const RATE_LIMITED = catalogErrorMessage("rate_limited")

/** 120 calls a minute per person, which no person reaches by using a screen. */
const LIMIT = 120
const WINDOW_SECONDS = 60

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

type Guarded = { ok: true; actor: string; roles: readonly AppRole[] } | { ok: false; error: string }

async function guard(action: Parameters<typeof can>[1]): Promise<Guarded> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: FORBIDDEN }
  }

  return { ok: true, actor: user.id, roles }
}

/** Fails closed: a broken limiter refuses a money action rather than allowing it. */
async function withinLimit(name: string, actor: string): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey(["admin-finance", name, actor]),
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
    onError: "deny",
  })

  return result.allowed
}

function safeError(name: string, error: unknown): string {
  if (error instanceof FinanceRpcError) {
    return catalogErrorMessage(error.code)
  }

  logger.error("admin_finance_action_failed", { action: name, error })

  return GENERIC_ERROR
}

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const periodSchema = z.string().regex(/^\d{4}-\d{2}-01$/)

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).or(z.string().datetime()),
  to: z.string().datetime({ offset: true }).or(z.string().datetime()),
})

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getAdminOverviewAction(input: {
  from: string
  to: string
}): Promise<Result<Overview>> {
  const g = await guard("ledger:read")

  if (!g.ok) return g

  const parsed = rangeSchema.safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_range") }
  }

  if (!(await withinLimit("overview", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await db.adminOverview(g.actor, parsed.data.from, parsed.data.to) }
  } catch (error) {
    return { ok: false, error: safeError("overview", error) }
  }
}

export async function getAdminDailySeriesAction(input: {
  from: string
  to: string
}): Promise<Result<DailyPoint[]>> {
  const g = await guard("ledger:read")

  if (!g.ok) return g

  const parsed = z.object({ from: isoDate, to: isoDate }).safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_range") }
  }

  if (!(await withinLimit("daily", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await db.adminDailySeries(g.actor, parsed.data.from, parsed.data.to) }
  } catch (error) {
    return { ok: false, error: safeError("daily", error) }
  }
}

/** The range the overview page shows, from its query string. */
export async function resolveOverviewRangeAction(input: {
  preset?: string
  from?: string
  to?: string
}): Promise<Result<{ preset: string; from: string; to: string; fromTs: string; toTs: string }>> {
  const g = await guard("ledger:read")

  if (!g.ok) return g

  const result = resolveRange(
    { preset: input?.preset ?? "last30", from: input?.from, to: input?.to },
    new Date(),
  )

  if (!result.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_range") }
  }

  return {
    ok: true,
    data: {
      preset: result.range.preset,
      from: result.range.from,
      to: result.range.to,
      fromTs: `${result.range.from}T00:00:00+01:00`,
      toTs: `${result.range.to}T23:59:59+01:00`,
    },
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ordersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["pending", "paid", "expired", "failed", "refunded", "disputed"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export async function listOrdersAction(input: {
  q?: string
  status?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}): Promise<Result<Page<OrderRow>>> {
  const g = await guard("orders:read")

  if (!g.ok) return g

  const parsed = ordersSchema.safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_cursor") }
  }

  if (!(await withinLimit("orders", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const page = await db.adminOrders(g.actor, {
      q: parsed.data.q === undefined || parsed.data.q === "" ? null : parsed.data.q,
      status: parsed.data.status ?? null,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      limit: parsed.data.limit ?? 25,
      cursor: cursor.value,
    })

    return { ok: true, data: page }
  } catch (error) {
    return { ok: false, error: safeError("orders", error) }
  }
}

export async function getOrderDetailAction(input: { orderId: string }): Promise<Result<OrderDetail>> {
  const g = await guard("orders:read")

  if (!g.ok) return g

  const parsed = z.object({ orderId: uuid }).safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  if (!(await withinLimit("order_detail", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const detail = await db.adminOrderDetail(g.actor, parsed.data.orderId)

    if (detail === null) {
      return { ok: false, error: catalogErrorMessage("not_found") }
    }

    return { ok: true, data: detail }
  } catch (error) {
    return { ok: false, error: safeError("order_detail", error) }
  }
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

const refundsSchema = z.object({
  status: z.enum(["requested", "approved", "processed", "failed", "rejected"]).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export async function listRefundsAction(input: {
  status?: string
  cursor?: string
  limit?: number
}): Promise<Result<Page<RefundQueueRow>>> {
  const g = await guard("orders:read")

  if (!g.ok) return g

  const parsed = refundsSchema.safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_cursor") }
  }

  if (!(await withinLimit("refunds", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return {
      ok: true,
      data: await db.adminRefunds(g.actor, {
        status: parsed.data.status ?? null,
        limit: parsed.data.limit ?? 25,
        cursor: cursor.value,
      }),
    }
  } catch (error) {
    return { ok: false, error: safeError("refunds", error) }
  }
}

/**
 * Put a failed refund submission back in the queue.
 *
 * The function resets the request to approved and writes the audit row; this
 * action then queues the existing refund_submit job under the same dedupe key the
 * rest of the app uses, so a double click queues one job and not two.
 */
export async function retryRefundSubmissionAction(input: {
  requestId: string
}): Promise<Result<{ queued: boolean }>> {
  const g = await guard("refunds:manage")

  if (!g.ok) return g

  const parsed = z.object({ requestId: uuid }).safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  if (!(await withinLimit("refund_retry", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const result = await db.retryRefundSubmission(g.actor, parsed.data.requestId)

    if (!result.enqueue) {
      return { ok: true, data: { queued: false } }
    }

    await enqueueJob({
      type: "refund_submit",
      payload: { requestId: parsed.data.requestId },
      dedupeKey: `refund_submit:${parsed.data.requestId}`,
    })

    return { ok: true, data: { queued: true } }
  } catch (error) {
    return { ok: false, error: safeError("refund_retry", error) }
  }
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export async function listDisputesAction(input: {
  status?: string
  cursor?: string
  limit?: number
}): Promise<Result<Page<DisputeQueueRow>>> {
  const g = await guard("orders:read")

  if (!g.ok) return g

  const parsed = z
    .object({
      status: z.enum(["open", "won", "lost", "needs_decision"]).optional(),
      cursor: z.string().max(2000).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_cursor") }
  }

  if (!(await withinLimit("disputes", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return {
      ok: true,
      data: await db.adminDisputes(g.actor, {
        status: parsed.data.status ?? null,
        limit: parsed.data.limit ?? 25,
        cursor: cursor.value,
      }),
    }
  } catch (error) {
    return { ok: false, error: safeError("disputes", error) }
  }
}

const disputeDecisionSchema = z.object({
  orderId: uuid,
  outcome: z.enum(["won", "lost"]),
  note: z
    .string()
    .trim()
    .min(10, "Write at least 10 characters explaining the decision.")
    .max(1000, "Keep the note to 1000 characters or fewer."),
})

/**
 * Decide a dispute. This is the only path that moves money for one, and it moves
 * it through resolve_dispute, which is the function the database has always used.
 */
export async function decideDisputeAction(input: {
  orderId: string
  outcome: "won" | "lost"
  note: string
}): Promise<Result<{ status: string }>> {
  const g = await guard("disputes:manage")

  if (!g.ok) return g

  const parsed = disputeDecisionSchema.safeParse(input ?? {})

  if (!parsed.success) {
    const first = parsed.error.issues[0]

    return { ok: false, error: first === undefined ? catalogErrorMessage("invalid_input") : first.message }
  }

  if (!(await withinLimit("dispute_decision", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("resolve_dispute", {
      p_order: parsed.data.orderId,
      p_outcome: parsed.data.outcome,
      p_note: parsed.data.note,
    })

    if (error !== null) {
      const code = typeof error.message === "string" ? error.message.trim() : ""

      if (/^[a-z0-9_]{3,60}$/.test(code)) {
        return { ok: false, error: catalogErrorMessage(code) }
      }

      throw new Error("resolve_dispute_failed")
    }

    const row = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}

    return { ok: true, data: { status: typeof row.status === "string" ? row.status : parsed.data.outcome } }
  } catch (error) {
    return { ok: false, error: safeError("dispute_decision", error) }
  }
}

// ---------------------------------------------------------------------------
// Ledger, trial balance and reconciliation
// ---------------------------------------------------------------------------

export async function listLedgerAction(input: {
  account?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}): Promise<Result<LedgerPage>> {
  const g = await guard("ledger:read")

  if (!g.ok) return g

  const parsed = z
    .object({
      account: z.string().max(40).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      cursor: z.string().max(2000).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_cursor") }
  }

  if (!(await withinLimit("ledger", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return {
      ok: true,
      data: await db.adminLedger(g.actor, {
        account: parsed.data.account === undefined || parsed.data.account === "" ? null : parsed.data.account,
        from: parsed.data.from ?? null,
        to: parsed.data.to ?? null,
        limit: parsed.data.limit ?? 25,
        cursor: cursor.value,
      }),
    }
  } catch (error) {
    return { ok: false, error: safeError("ledger", error) }
  }
}

export async function getTrialBalanceAction(input?: { asOf?: string }): Promise<Result<TrialBalance>> {
  const g = await guard("reconciliation:read")

  if (!g.ok) return g

  const parsed = z.object({ asOf: z.string().datetime({ offset: true }).optional() }).safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  if (!(await withinLimit("trial_balance", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await db.adminTrialBalance(g.actor, parsed.data.asOf ?? null) }
  } catch (error) {
    return { ok: false, error: safeError("trial_balance", error) }
  }
}

export async function listReconciliationAction(input?: {
  limit?: number
}): Promise<Result<Page<ReconciliationRun>>> {
  const g = await guard("reconciliation:read")

  if (!g.ok) return g

  const parsed = z.object({ limit: z.number().int().min(1).max(50).optional() }).safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  if (!(await withinLimit("reconciliation", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await db.adminReconciliationRuns(g.actor, parsed.data.limit ?? 30) }
  } catch (error) {
    return { ok: false, error: safeError("reconciliation", error) }
  }
}

// ---------------------------------------------------------------------------
// VAT
// ---------------------------------------------------------------------------

export async function listVatPeriodsAction(input: { year: number }): Promise<Result<VatPeriod[]>> {
  const g = await guard("vat:manage")

  if (!g.ok) return g

  const parsed = z
    .object({ year: z.number().int().min(2000).max(2100) })
    .safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_year") }
  }

  if (!(await withinLimit("vat_periods", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await db.vatPeriods(g.actor, parsed.data.year) }
  } catch (error) {
    return { ok: false, error: safeError("vat_periods", error) }
  }
}

export async function getVatPeriodAction(input: {
  period: string
  cursor?: string
  limit?: number
}): Promise<Result<VatPeriodDetail>> {
  const g = await guard("vat:manage")

  if (!g.ok) return g

  const parsed = z
    .object({
      period: periodSchema,
      cursor: z.string().max(2000).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_period") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: catalogErrorMessage("invalid_cursor") }
  }

  if (!(await withinLimit("vat_period", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return {
      ok: true,
      data: await db.vatPeriodDetail(g.actor, parsed.data.period, {
        limit: parsed.data.limit ?? 25,
        cursor: cursor.value,
      }),
    }
  } catch (error) {
    return { ok: false, error: safeError("vat_period", error) }
  }
}

const statusSchema = z.object({
  period: periodSchema,
  status: z.enum(["open", "filed", "remitted"]),
  remittedAmountKobo: z.union([z.bigint(), z.number().int().min(0), z.string().regex(/^\d{1,15}$/)]).optional(),
  paymentReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})

/** Mark a month filed or remitted. A remitted month can only change by adjustment. */
export async function setVatPeriodStatusAction(input: {
  period: string
  status: "open" | "filed" | "remitted"
  remittedAmountKobo?: bigint | number | string
  paymentReference?: string
  note?: string
}): Promise<Result<{ status: string }>> {
  const g = await guard("vat:manage")

  if (!g.ok) return g

  const parsed = statusSchema.safeParse(input ?? {})

  if (!parsed.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  if (parsed.data.status === "remitted" && parsed.data.remittedAmountKobo === undefined) {
    return { ok: false, error: catalogErrorMessage("invalid_amount") }
  }

  if (!(await withinLimit("vat_status", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("set_vat_period_status", {
      p_actor: g.actor,
      p_period: parsed.data.period,
      p_status: parsed.data.status,
      p_remitted_amount_kobo:
        parsed.data.remittedAmountKobo === undefined ? null : BigInt(parsed.data.remittedAmountKobo).toString(),
      p_payment_reference:
        parsed.data.paymentReference === undefined || parsed.data.paymentReference === ""
          ? null
          : parsed.data.paymentReference,
      p_receipt_key: null,
      p_note: parsed.data.note === undefined || parsed.data.note === "" ? null : parsed.data.note,
    })

    if (error !== null) {
      const code = typeof error.message === "string" ? error.message.trim() : ""

      if (/^[a-z0-9_]{3,60}$/.test(code)) {
        return { ok: false, error: catalogErrorMessage(code) }
      }

      throw new Error("set_vat_period_status_failed")
    }

    return { ok: true, data: { status: parsed.data.status } }
  } catch (error) {
    return { ok: false, error: safeError("vat_status", error) }
  }
}

const adjustmentSchema = z.object({
  period: periodSchema,
  /** Signed, in kobo. A negative amount reduces what is payable. */
  amountKobo: z.union([z.bigint(), z.number().int(), z.string().regex(/^-?\d{1,15}$/)]),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(300),
})

export async function addVatAdjustmentAction(input: {
  period: string
  amountKobo: bigint | number | string
  reason: string
}): Promise<Result<{ id: string }>> {
  const g = await guard("vat:manage")

  if (!g.ok) return g

  const parsed = adjustmentSchema.safeParse(input ?? {})

  if (!parsed.success) {
    const first = parsed.error.issues[0]

    return { ok: false, error: first === undefined ? catalogErrorMessage("invalid_input") : first.message }
  }

  const amount = BigInt(parsed.data.amountKobo)

  if (amount === BigInt(0)) {
    return { ok: false, error: catalogErrorMessage("invalid_amount") }
  }

  if (!(await withinLimit("vat_adjustment", g.actor))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("add_vat_adjustment", {
      p_actor: g.actor,
      p_period: parsed.data.period,
      p_amount_kobo: amount.toString(),
      p_reason: parsed.data.reason,
    })

    if (error !== null) {
      const code = typeof error.message === "string" ? error.message.trim() : ""

      if (/^[a-z0-9_]{3,60}$/.test(code)) {
        return { ok: false, error: catalogErrorMessage(code) }
      }

      throw new Error("add_vat_adjustment_failed")
    }

    return { ok: true, data: { id: typeof data === "string" ? data : "" } }
  } catch (error) {
    return { ok: false, error: safeError("vat_adjustment", error) }
  }
}
