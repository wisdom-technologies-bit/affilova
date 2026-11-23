"use server"

import { z } from "zod"

import { merchantErrorMessage } from "@/lib/merchant/errors"
import type {
  ActionResult,
  Page,
  VendorDailyPoint,
  VendorOverview,
  VendorRefundRow,
  VendorSaleRow,
  VendorTopProduct,
} from "@/lib/merchant/types"
import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { decodeCursor, encodeCursor } from "@/lib/pagination/cursor"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { asArray, asRecord, toBoolean, toInteger, toText, toTextOrNull } from "@/lib/read-model/json"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The read side of the merchant screens: the vendor's own numbers, and nothing
// else.
//
// The vendor id is never an input. Every call uses the authenticated user's id as
// the actor, and the database checks that this actor really has an active vendor
// profile before it answers anything. A vendor cannot ask for another vendor's
// numbers because there is no parameter in which to name one.
//
// Refund decisions are not here: they go through the existing
// decideRefundAction in lib/commerce/actions.ts, unchanged.

const READ_BUDGET = { limit: 120, windowSeconds: 60 } as const

type Actor = { userId: string; roles: AppRole[] }

type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

async function requireActor(action: Action): Promise<GuardResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: merchantErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: merchantErrorMessage("forbidden") }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

async function withinBudget(userId: string): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey(["merchant-read", userId]),
    limit: READ_BUDGET.limit,
    windowSeconds: READ_BUDGET.windowSeconds,
    onError: "allow",
  })

  return result.allowed
}

function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input)

  if (!result.success) {
    return { ok: false, error: merchantErrorMessage("invalid_input") }
  }

  return { ok: true, data: result.data }
}

function rpcError(error: unknown): Error {
  if (typeof error === "object" && error !== null) {
    const message: unknown = (error as { message?: unknown }).message

    if (typeof message === "string" && message.trim() !== "") {
      return new Error(message.trim())
    }
  }

  return new Error("rpc_failed")
}

function failed(error: unknown): { ok: false; error: string } {
  const code = error instanceof Error ? error.message.trim() : ""

  if (code !== "" && code.length <= 40 && /^[a-z_]+$/.test(code)) {
    logger.warn("merchant_read_failed", { code })
  } else {
    logger.error("merchant_read_failed", { reason: error })
  }

  return { ok: false, error: merchantErrorMessage(error) }
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(name, args)

    if (error) {
      return { ok: false, error: merchantErrorMessage(rpcError(error)) }
    }

    return { ok: true, data }
  } catch (error) {
    return failed(error)
  }
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const instantSchema = z.string().min(20).max(40)

const instantRangeSchema = z
  .object({
    from: instantSchema,
    to: instantSchema,
  })
  .strict()

const dayRangeSchema = z
  .object({
    from: daySchema,
    to: daySchema,
  })
  .strict()

const salesStatusSchema = z.enum(["pending", "paid", "expired", "failed", "refunded", "disputed"])

const refundStatusSchema = z.enum(["requested", "approved", "rejected", "processed", "failed"])

const listSchema = z
  .object({
    status: z.string().trim().max(20).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(600).optional(),
  })
  .strict()

function validInstants(input: { from: string; to: string }): boolean {
  return !Number.isNaN(Date.parse(input.from)) && !Number.isNaN(Date.parse(input.to))
}

// ---------------------------------------------------------------------------
// Reading the database's JSON
// ---------------------------------------------------------------------------

function toOverview(data: unknown): VendorOverview | null {
  const row = asRecord(data)

  if (row === null) {
    return null
  }

  return {
    orders: toInteger(row.orders),
    grossKobo: toInteger(row.gross_kobo),
    vendorNetKobo: toInteger(row.vendor_net_kobo),
    platformFeeKobo: toInteger(row.platform_fee_kobo),
    affiliateCommissionKobo: toInteger(row.affiliate_commission_kobo),
    affiliateOrders: toInteger(row.affiliate_orders),
    refundsCount: toInteger(row.refunds_count),
    refundsKobo: toInteger(row.refunds_kobo),
    refundRateBps: toInteger(row.refund_rate_bps),
    pendingKobo: toInteger(row.pending_kobo),
    availableKobo: toInteger(row.available_kobo),
  }
}

function toSaleRow(raw: unknown): VendorSaleRow | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  const orderNumber = toText(row.order_number)

  if (orderNumber === "") {
    return null
  }

  return {
    orderNumber,
    productTitle: toText(row.product_title),
    status: toText(row.status),
    paidAt: toTextOrNull(row.paid_at),
    grossKobo: toInteger(row.gross_kobo),
    vendorNetKobo: toInteger(row.vendor_net_kobo),
    viaAffiliate: toBoolean(row.via_affiliate),
  }
}

function toRefundRow(raw: unknown): VendorRefundRow | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  const requestId = toText(row.request_id)

  if (requestId === "") {
    return null
  }

  return {
    requestId,
    orderNumber: toText(row.order_number),
    productTitle: toText(row.product_title),
    reason: toText(row.reason),
    status: toText(row.status),
    autoApproved: toBoolean(row.auto_approved),
    requestedAt: toText(row.requested_at),
    decidedAt: toTextOrNull(row.decided_at),
    amountKobo: toInteger(row.amount_kobo),
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** The vendor's headline numbers for a range of whole Lagos days. */
export async function getVendorOverviewAction(input: unknown): Promise<ActionResult<VendorOverview>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(instantRangeSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!validInstants(parsed.data)) {
    return { ok: false, error: merchantErrorMessage("invalid_range") }
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: merchantErrorMessage("rate_limited") }
  }

  const result = await callRpc("vendor_overview", {
    p_vendor: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  })

  if (!result.ok) {
    return result
  }

  const overview = toOverview(result.data)

  if (overview === null) {
    return { ok: false, error: merchantErrorMessage("invalid_input") }
  }

  return { ok: true, data: overview }
}

/** One row per Lagos day in the range, including days with no sale. */
export async function getVendorDailySeriesAction(
  input: unknown,
): Promise<ActionResult<VendorDailyPoint[]>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(dayRangeSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: merchantErrorMessage("rate_limited") }
  }

  const result = await callRpc("vendor_daily_series", {
    p_vendor: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  })

  if (!result.ok) {
    return result
  }

  const points: VendorDailyPoint[] = []

  for (const raw of asArray(result.data)) {
    const row = asRecord(raw)
    const day = toText(row?.day)

    if (row === null || day === "") {
      continue
    }

    points.push({
      day,
      orders: toInteger(row.orders),
      grossKobo: toInteger(row.gross_kobo),
      vendorNetKobo: toInteger(row.vendor_net_kobo),
    })
  }

  return { ok: true, data: points }
}

/** The ten products that earned the most in the range. */
export async function getVendorTopProductsAction(
  input: unknown,
): Promise<ActionResult<VendorTopProduct[]>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(dayRangeSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: merchantErrorMessage("rate_limited") }
  }

  const result = await callRpc("vendor_top_products", {
    p_vendor: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  })

  if (!result.ok) {
    return result
  }

  const products: VendorTopProduct[] = []

  for (const raw of asArray(result.data)) {
    const row = asRecord(raw)
    const productId = toText(row?.product_id)

    if (row === null || productId === "") {
      continue
    }

    products.push({
      productId,
      title: toText(row.title),
      orders: toInteger(row.orders),
      grossKobo: toInteger(row.gross_kobo),
      refunds: toInteger(row.refunds),
    })
  }

  return { ok: true, data: products }
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/** One page of the vendor's own sales, newest first. No buyer identity at all. */
export async function getVendorSalesAction(
  input: unknown,
): Promise<ActionResult<Page<VendorSaleRow>>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(listSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: merchantErrorMessage("rate_limited") }
  }

  let status: string | null = null

  if (parsed.data.status !== undefined && parsed.data.status !== "") {
    const checked = salesStatusSchema.safeParse(parsed.data.status)

    if (!checked.success) {
      return { ok: false, error: merchantErrorMessage("invalid_status") }
    }

    status = checked.data
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: merchantErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("vendor_sales_list", {
    p_vendor: guard.actor.userId,
    p_status: status,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: VendorSaleRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = toSaleRow(raw)

    if (row !== null) {
      items.push(row)
    }
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

/** One page of the refund requests on the vendor's own orders. */
export async function getVendorRefundRequestsAction(
  input: unknown,
): Promise<ActionResult<Page<VendorRefundRow>>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(listSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: merchantErrorMessage("rate_limited") }
  }

  let status: string | null = null

  if (parsed.data.status !== undefined && parsed.data.status !== "") {
    const checked = refundStatusSchema.safeParse(parsed.data.status)

    if (!checked.success) {
      return { ok: false, error: merchantErrorMessage("invalid_status") }
    }

    status = checked.data
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: merchantErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("vendor_refund_requests", {
    p_vendor: guard.actor.userId,
    p_status: status,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: VendorRefundRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = toRefundRow(raw)

    if (row !== null) {
      items.push(row)
    }
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}
