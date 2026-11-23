"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { accountErrorMessage } from "@/lib/account/errors"
import type {
  ActionResult,
  DownloadResult,
  EntitlementRow,
  OrderDetail,
  OrderItemLine,
  OrderSummary,
  Page,
  RefundRequestSummary,
  TaxBasis,
  TaxLine,
} from "@/lib/account/types"
import { orderStatus } from "@/lib/account/types"
import { requestRefundAction } from "@/lib/commerce/actions"
import { DOWNLOAD_MESSAGES, DOWNLOAD_URL_SECONDS, hashDownloadIp } from "@/lib/commerce/download"
import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { decodeCursor, encodeCursor } from "@/lib/pagination/cursor"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { asArray, asRecord, toBoolean, toInteger, toText, toTextOrNull } from "@/lib/read-model/json"
import { getR2Storage } from "@/lib/storage/r2"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The read side of the customer account screens.
//
// Every action follows the same order as the affiliate actions: who is calling
// (from the session, never from the input), may they, is the input well formed,
// have they used up their allowance, and then the database function with the
// actor's real id in its first argument.
//
// Nothing throws to the client. A database error becomes a sentence from
// lib/account/errors.ts, never the database's own text, and never a table or
// constraint name.
//
// A download URL is a credential: it is returned to the caller and never logged,
// not even at debug level. The log line carries the event, and nothing else.

const READ_BUDGET = { limit: 120, windowSeconds: 60 } as const
const DOWNLOAD_BUDGET = { limit: 30, windowSeconds: 3600 } as const

type Actor = { userId: string; roles: AppRole[] }

type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

async function requireActor(action: Action): Promise<GuardResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: accountErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: accountErrorMessage("forbidden") }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

async function withinBudget(
  namespace: string,
  userId: string,
  budget: { limit: number; windowSeconds: number },
  onError: "allow" | "deny",
): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey([namespace, userId]),
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
    onError,
  })

  return result.allowed
}

function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input)

  if (!result.success) {
    return { ok: false, error: accountErrorMessage("invalid_input") }
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

function failed(event: string, error: unknown): { ok: false; error: string } {
  const code = error instanceof Error ? error.message.trim() : ""

  if (code !== "" && code.length <= 40 && /^[a-z_]+$/.test(code)) {
    logger.warn(event, { code })
  } else {
    logger.error(event, { reason: error })
  }

  return { ok: false, error: accountErrorMessage(error) }
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(name, args)

    if (error) {
      return { ok: false, error: accountErrorMessage(rpcError(error)) }
    }

    return { ok: true, data }
  } catch (error) {
    return failed("account_read_failed", error)
  }
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

const limitSchema = z.number().int().min(1).max(50).optional()
const cursorSchema = z.string().min(1).max(600).optional()

const ordersSchema = z
  .object({
    limit: limitSchema,
    cursor: cursorSchema,
  })
  .strict()

const orderSchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict()

const downloadSchema = z
  .object({
    orderId: z.string().uuid(),
    entitlementId: z.string().uuid(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Reading the database's JSON
// ---------------------------------------------------------------------------

function toBasis(value: unknown): TaxBasis {
  return value === "product_price" ? "product_price" : "platform_fee"
}

function toSupplier(value: unknown): "affilova" | "vendor" {
  return value === "vendor" ? "vendor" : "affilova"
}

function toOrderSummary(raw: unknown): OrderSummary | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  const orderId = toText(row.order_id)

  if (orderId === "") {
    return null
  }

  return {
    orderId,
    number: toText(row.number),
    status: orderStatus(toText(row.status)),
    totalKobo: toInteger(row.total_kobo),
    paidAt: toTextOrNull(row.paid_at),
    createdAt: toText(row.created_at),
    productTitle: toText(row.product_title),
    productSlug: toText(row.product_slug),
    vendorName: toText(row.vendor_name),
    coverPublicId: toTextOrNull(row.cover_public_id),
  }
}

function toEntitlement(raw: unknown): EntitlementRow | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  const entitlementId = toText(row.entitlement_id)

  if (entitlementId === "") {
    return null
  }

  return {
    entitlementId,
    fileDisplayName: toText(row.file_display_name),
    sizeBytes: toInteger(row.size_bytes),
    downloadsUsed: toInteger(row.downloads_used),
    maxDownloads: toInteger(row.max_downloads),
    revoked: toBoolean(row.revoked),
    scanClean: toBoolean(row.scan_clean),
  }
}

function toTaxLine(raw: unknown): TaxLine | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  return {
    basis: toBasis(row.basis),
    rateBps: toInteger(row.rate_bps),
    baseKobo: toInteger(row.base_kobo),
    taxKobo: toInteger(row.tax_kobo),
    included: toBoolean(row.included),
    supplier: toSupplier(row.supplier),
  }
}

function toItemLine(raw: unknown): OrderItemLine | null {
  const row = asRecord(raw)

  if (row === null) {
    return null
  }

  const orderItemId = toText(row.order_item_id)

  if (orderItemId === "") {
    return null
  }

  return {
    orderItemId,
    productId: toText(row.product_id),
    title: toText(row.title),
    unitPriceKobo: toInteger(row.unit_price_kobo),
    vendorName: toText(row.vendor_name),
  }
}

function toDetail(data: unknown): OrderDetail | null {
  const row = asRecord(data)

  if (row === null) {
    return null
  }

  const orderId = toText(row.order_id)

  if (orderId === "") {
    return null
  }

  const refundRow = asRecord(row.refund_request)
  let refundRequest: RefundRequestSummary | null = null

  if (refundRow !== null && toText(refundRow.status) !== "") {
    refundRequest = {
      status: toText(refundRow.status),
      autoApproved: toBoolean(refundRow.auto_approved),
    }
  }

  return {
    orderId,
    number: toText(row.number),
    status: orderStatus(toText(row.status)),
    currency: toText(row.currency) === "" ? "NGN" : toText(row.currency),
    subtotalKobo: toInteger(row.subtotal_kobo),
    taxKobo: toInteger(row.tax_kobo),
    taxIncluded: toBoolean(row.tax_included),
    totalKobo: toInteger(row.total_kobo),
    channel: toTextOrNull(row.channel),
    paidAt: toTextOrNull(row.paid_at),
    createdAt: toText(row.created_at),
    refundWindowEndsAt: toTextOrNull(row.refund_window_ends_at),
    items: asArray(row.items)
      .map(toItemLine)
      .filter((item): item is OrderItemLine => item !== null),
    taxLines: asArray(row.tax_lines)
      .map(toTaxLine)
      .filter((line): line is TaxLine => line !== null),
    refundRequest,
    entitlements: asArray(row.entitlements)
      .map(toEntitlement)
      .filter((entitlement): entitlement is EntitlementRow => entitlement !== null),
  }
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/**
 * One page of the buyer's own purchases.
 *
 * Guest orders bought with this account's address are claimed first, so a person
 * who bought before signing up finds those purchases here. The claim is best
 * effort: if it fails the list is still read, because the purchases that already
 * belong to the account are not affected by it.
 */
export async function getMyOrdersAction(input: unknown): Promise<ActionResult<Page<OrderSummary>>> {
  const guard = await requireActor("area:account")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(ordersSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("account-read", guard.actor.userId, READ_BUDGET, "allow"))) {
    return { ok: false, error: accountErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: accountErrorMessage("invalid_cursor") }
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("claim_guest_orders", {
      p_user: guard.actor.userId,
    })

    if (error) {
      // Not fatal: the list below is still the buyer's own.
      logger.warn("guest_order_claim_failed", { code: rpcError(error).message.slice(0, 40) })
    }
  } catch (error) {
    logger.warn("guest_order_claim_failed", { reason: error })
  }

  const result = await callRpc("account_orders", {
    p_user: guard.actor.userId,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: OrderSummary[] = []

  for (const raw of asArray(page?.items)) {
    const summary = toOrderSummary(raw)

    if (summary !== null) {
      items.push(summary)
    }
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

/** One purchase the buyer owns, with its files and its refund state. */
export async function getMyOrderAction(input: unknown): Promise<ActionResult<OrderDetail>> {
  const guard = await requireActor("area:account")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(orderSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("account-read", guard.actor.userId, READ_BUDGET, "allow"))) {
    return { ok: false, error: accountErrorMessage("rate_limited") }
  }

  const result = await callRpc("account_order_detail", {
    p_user: guard.actor.userId,
    p_order: parsed.data.orderId,
  })

  if (!result.ok) {
    return result
  }

  const detail = toDetail(result.data)

  if (detail === null) {
    return { ok: false, error: accountErrorMessage("invalid_order") }
  }

  return { ok: true, data: detail }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

const CLAIM_MESSAGES: Readonly<Record<string, string>> = {
  not_found: "This file is not part of this purchase.",
  forbidden: DOWNLOAD_MESSAGES.forbidden,
  revoked: DOWNLOAD_MESSAGES.revoked,
  expired: DOWNLOAD_MESSAGES.expired,
  download_limit: DOWNLOAD_MESSAGES.download_limit,
  file_not_clean: DOWNLOAD_MESSAGES.file_not_clean,
  order_not_paid: DOWNLOAD_MESSAGES.order_not_paid,
}

/**
 * Hand one file of one purchase to its owner.
 *
 * The database decides: claim_download() checks that the entitlement belongs to
 * this user id, that the order is paid, that the file passed its security scan
 * and that a download is left, and counts it. This action only turns the answer
 * into a five minute URL, or into a sentence.
 *
 * The URL is never logged.
 */
export async function downloadMyFileAction(input: unknown): Promise<DownloadResult> {
  const guard = await requireActor("area:account")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(downloadSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("account-download", guard.actor.userId, DOWNLOAD_BUDGET, "deny"))) {
    return { ok: false, error: accountErrorMessage("rate_limited") }
  }

  // The file has to be one of this order's files, not merely one of this user's.
  const detailResult = await callRpc("account_order_detail", {
    p_user: guard.actor.userId,
    p_order: parsed.data.orderId,
  })

  if (!detailResult.ok) {
    return detailResult
  }

  const detail = toDetail(detailResult.data)
  const entitlement =
    detail === null
      ? undefined
      : detail.entitlements.find((entry) => entry.entitlementId === parsed.data.entitlementId)

  if (entitlement === undefined) {
    return { ok: false, error: CLAIM_MESSAGES.not_found ?? DOWNLOAD_MESSAGES.unavailable }
  }

  const requestHeaders = await headers()
  const ipHash = hashDownloadIp(clientIpFromHeaders(requestHeaders))

  let storageKey: string
  let filename: string

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("claim_download", {
      p_entitlement: parsed.data.entitlementId,
      p_buyer_user: guard.actor.userId,
      p_buyer_email: null,
      p_ip_hash: ipHash,
    })

    if (error) {
      const code = rpcError(error).message

      logger.warn("account_download_refused", { code: code.slice(0, 40) })

      return { ok: false, error: CLAIM_MESSAGES[code] ?? accountErrorMessage(error) }
    }

    const row = Array.isArray(data) ? data[0] : data
    const record = asRecord(row)

    if (
      record === null ||
      typeof record.storage_key !== "string" ||
      typeof record.filename !== "string"
    ) {
      return { ok: false, error: DOWNLOAD_MESSAGES.unavailable }
    }

    storageKey = record.storage_key
    filename = record.filename
  } catch (error) {
    logger.error("account_download_failed", { reason: error })

    return { ok: false, error: DOWNLOAD_MESSAGES.unavailable }
  }

  try {
    const url = await getR2Storage().presignGetUrl({
      key: storageKey,
      filename,
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    })

    // Deliberately no key, no filename and no URL in this line.
    logger.info("account_download_issued")

    return { ok: true, url }
  } catch (error) {
    logger.warn("account_download_presign_failed", { reason: error })

    return { ok: false, error: DOWNLOAD_MESSAGES.unavailable }
  }
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Ask for a refund on one of the buyer's own paid orders.
 *
 * The decision (inside the window or not) is the database's: this only checks
 * the shape of the request and passes the authenticated id through the existing
 * commerce action.
 */
export async function requestMyRefundAction(input: unknown): Promise<ActionResult<{ requestId: string; autoApproved: boolean }>> {
  const guard = await requireActor("area:account")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(
    z
      .object({
        orderId: z.string().uuid(),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict(),
    input,
  )

  if (!parsed.ok) {
    return parsed
  }

  const result = await requestRefundAction({
    orderId: parsed.data.orderId,
    reason: parsed.data.reason,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return { ok: true, data: { requestId: result.requestId, autoApproved: result.autoApproved } }
}
