"use server"

import { z } from "zod"

import { affiliateErrorMessage, AFFILIATE_GENERIC_ERROR } from "@/lib/affiliate/errors"
import { shortLinkUrl } from "@/lib/affiliate/links"
import { generateQrSvg } from "@/lib/affiliate/qr"
import type {
  ActionResult,
  AffiliateRequestRow,
  BreakdownDimension,
  BreakdownRow,
  CategoryOption,
  CommissionRow,
  DailyPoint,
  InviteRow,
  LinkStat,
  MarketplaceAccess,
  MarketplaceItem,
  MarketplaceSort,
  Overview,
  Page,
  VendorAffiliateRow,
} from "@/lib/affiliate/read-types"
import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The read side of the affiliate screens.
//
// Every action follows the same order as lib/affiliate/actions.ts: who is
// calling (from the session, never from the input), may they, is the input well
// formed, have they used up their allowance, and then the database function with
// the actor's real id in its first argument.
//
// Nothing throws to the client. A database error becomes a sentence from
// lib/affiliate/errors.ts, never the database's own text, and never a table or
// constraint name.

const READ_BUDGET = { limit: 120, windowSeconds: 60 } as const

type Actor = { userId: string; roles: AppRole[] }

type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

async function requireActor(action: Action): Promise<GuardResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: affiliateErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: affiliateErrorMessage("forbidden") }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

async function withinBudget(userId: string): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey(["affiliate-read", userId]),
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
    return { ok: false, error: affiliateErrorMessage("invalid_input") }
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
    logger.warn("affiliate_read_failed", { code })
  } else {
    logger.error("affiliate_read_failed", { reason: error })
  }

  return { ok: false, error: affiliateErrorMessage(error) }
}

// ---------------------------------------------------------------------------
// Reading the database's JSON without trusting it
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A whole number of kobo or a count, from a number or a numeric string. */
function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value)

    return Number.isSafeInteger(parsed) ? parsed : fallback
  }

  return fallback
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function toTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function toBoolean(value: unknown): boolean {
  return value === true
}

function toAccess(value: unknown): MarketplaceAccess {
  return value === "pending" || value === "approved" || value === "rejected" || value === "blocked"
    ? value
    : "none"
}

function toApproval(value: unknown): "open" | "approval" | "invite" {
  return value === "approval" || value === "invite" ? value : "open"
}

function toLinkStatus(value: unknown): "active" | "archived" {
  return value === "archived" ? "archived" : "active"
}

function toAccessStatus(value: unknown): "pending" | "approved" | "rejected" | "blocked" {
  return value === "approved" || value === "rejected" || value === "blocked" ? value : "pending"
}

// The page cursor is the database's JSON object, base64url encoded so a client
// passes it back exactly as it received it. A value that does not decode is
// refused rather than silently starting from the first page.
function encodeCursor(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null
  }

  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decodeCursor(cursor: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (cursor === undefined || cursor === "") {
    return { ok: true, value: null }
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) }
  } catch {
    return { ok: false }
  }
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(name, args)

    if (error) {
      return { ok: false, error: affiliateErrorMessage(rpcError(error)) }
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

const dayRangeSchema = z
  .object({
    from: daySchema,
    to: daySchema,
  })
  .strict()

const instantRangeSchema = z
  .object({
    from: z.string().min(20).max(40),
    to: z.string().min(20).max(40),
  })
  .strict()

function validInstants(input: { from: string; to: string }): boolean {
  return !Number.isNaN(Date.parse(input.from)) && !Number.isNaN(Date.parse(input.to))
}

const limitSchema = z.number().int().min(1).max(50).optional()

const cursorSchema = z.string().min(1).max(600).optional()

// ---------------------------------------------------------------------------
// Affiliate reads
// ---------------------------------------------------------------------------

const marketplaceSchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.string().trim().max(60).optional(),
    minCommissionBps: z.number().int().min(0).max(8000).optional(),
    sort: z.enum(["newest", "commission", "price_low", "price_high"]).optional(),
    limit: z.number().int().min(1).max(30).optional(),
    cursor: cursorSchema,
  })
  .strict()

/** One page of the marketplace, plus the cursor for the next. */
export async function getMarketplaceAction(
  input: unknown,
): Promise<ActionResult<Page<MarketplaceItem>>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(marketplaceSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: affiliateErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("affiliate_marketplace", {
    p_affiliate: guard.actor.userId,
    p_q: parsed.data.q === undefined || parsed.data.q === "" ? null : parsed.data.q,
    p_category:
      parsed.data.category === undefined || parsed.data.category === "" ? null : parsed.data.category,
    p_min_commission_bps: parsed.data.minCommissionBps ?? null,
    p_sort: parsed.data.sort ?? "newest",
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: MarketplaceItem[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const productId = toText(row.product_id)

    if (productId === "") {
      continue
    }

    items.push({
      productId,
      slug: toText(row.slug),
      title: toText(row.title),
      shortDescription: toText(row.short_description),
      coverPublicId: toTextOrNull(row.cover_public_id),
      vendorName: toText(row.vendor_name),
      categorySlug: toText(row.category_slug),
      priceKobo: toInteger(row.price_kobo),
      commissionBps: toInteger(row.commission_bps),
      affiliateApproval: toApproval(row.affiliate_approval),
      myAccess: toAccess(row.my_access),
      myLinkCount: toInteger(row.my_link_count),
    })
  }

  return {
    ok: true,
    data: { items, nextCursor: encodeCursor(page?.next_cursor) },
  }
}

/** The product categories, for the marketplace filter. Real rows, never a list. */
export async function getCategoriesAction(): Promise<ActionResult<CategoryOption[]>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("product_categories")
      .select("slug, name, sort")
      .order("sort", { ascending: true })

    if (error) {
      return failed(rpcError(error))
    }

    const categories: CategoryOption[] = []

    for (const raw of asArray(data)) {
      const row = asRecord(raw)
      const slug = toText(row?.slug)
      const name = toText(row?.name)

      if (slug !== "" && name !== "") {
        categories.push({ slug, name })
      }
    }

    return { ok: true, data: categories }
  } catch (error) {
    return failed(error)
  }
}

const overviewSchema = instantRangeSchema

/** The totals for a range of instants (the page resolves them from Lagos days). */
export async function getOverviewAction(input: unknown): Promise<ActionResult<Overview>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(overviewSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!validInstants(parsed.data)) {
    return { ok: false, error: affiliateErrorMessage("invalid_input") }
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const result = await callRpc("affiliate_overview", {
    p_affiliate: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  })

  if (!result.ok) {
    return result
  }

  const row = asRecord(result.data)

  if (row === null) {
    return { ok: false, error: AFFILIATE_GENERIC_ERROR }
  }

  const balance = asRecord(row.balance)

  return {
    ok: true,
    data: {
      clicks: toInteger(row.clicks),
      uniqueClicks: toInteger(row.unique_clicks),
      orders: toInteger(row.orders),
      revenueKobo: toInteger(row.revenue_kobo),
      commissionKobo: toInteger(row.commission_kobo),
      conversionBps: toInteger(row.conversion_bps),
      epcKoboPer100Clicks: toInteger(row.epc_kobo_per_100_clicks),
      balance: {
        pendingKobo: toInteger(balance?.pending_kobo),
        availableKobo: toInteger(balance?.available_kobo),
        totalKobo: toInteger(balance?.total_kobo),
        negative: toBoolean(balance?.negative),
      },
    },
  }
}

/** One point per Lagos day, zero days included. */
export async function getDailySeriesAction(input: unknown): Promise<ActionResult<DailyPoint[]>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(dayRangeSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const result = await callRpc("affiliate_daily_series", {
    p_affiliate: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  })

  if (!result.ok) {
    return result
  }

  const points: DailyPoint[] = []

  for (const raw of asArray(result.data)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    points.push({
      day: toText(row.day),
      clicks: toInteger(row.clicks),
      uniqueClicks: toInteger(row.unique_clicks),
      orders: toInteger(row.orders),
      commissionKobo: toInteger(row.commission_kobo),
    })
  }

  return { ok: true, data: points }
}

const linkStatsSchema = dayRangeSchema.extend({
  limit: limitSchema,
  cursor: cursorSchema,
})

/** The affiliate's own links, with their numbers in the range. */
export async function getLinkStatsAction(input: unknown): Promise<ActionResult<Page<LinkStat>>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(linkStatsSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: affiliateErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("affiliate_link_stats", {
    p_affiliate: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: LinkStat[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const linkId = toText(row.link_id)

    if (linkId === "") {
      continue
    }

    items.push({
      linkId,
      code: toText(row.code),
      alias: toTextOrNull(row.alias),
      label: toTextOrNull(row.label),
      productTitle: toText(row.product_title),
      status: toLinkStatus(row.status),
      clicks: toInteger(row.clicks),
      uniqueClicks: toInteger(row.unique_clicks),
      orders: toInteger(row.orders),
      commissionKobo: toInteger(row.commission_kobo),
    })
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

const breakdownSchema = dayRangeSchema.extend({
  dimension: z.enum(["sub1", "utm_source", "product"]),
})

/** The top 20 groups for one dimension. */
export async function getBreakdownAction(
  input: unknown,
): Promise<ActionResult<{ dimension: BreakdownDimension; rows: BreakdownRow[] }>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(breakdownSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const result = await callRpc("affiliate_breakdown", {
    p_affiliate: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_dim: parsed.data.dimension,
  })

  if (!result.ok) {
    return result
  }

  const rows: BreakdownRow[] = []

  for (const raw of asArray(result.data)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    rows.push({
      label: toText(row.label),
      clicks: toInteger(row.clicks),
      uniqueClicks: toInteger(row.unique_clicks),
      orders: toInteger(row.orders),
      commissionKobo: toInteger(row.commission_kobo),
    })
  }

  return { ok: true, data: { dimension: parsed.data.dimension, rows } }
}

const commissionsSchema = z
  .object({
    limit: limitSchema,
    cursor: cursorSchema,
  })
  .strict()

/** The affiliate's commissions, newest first. */
export async function getCommissionsAction(
  input: unknown,
): Promise<ActionResult<Page<CommissionRow>>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(commissionsSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: affiliateErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("affiliate_commission_list", {
    p_affiliate: guard.actor.userId,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: CommissionRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const orderNumber = toText(row.order_number)

    if (orderNumber === "") {
      continue
    }

    items.push({
      orderNumber,
      productTitle: toText(row.product_title),
      commissionKobo: toInteger(row.commission_kobo),
      status: toText(row.status),
      paidAt: toTextOrNull(row.paid_at),
      availableAt: toTextOrNull(row.available_at),
    })
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

const qrSchema = z.object({ linkId: z.string().uuid() }).strict()

/**
 * The QR code for one of the caller's own links.
 *
 * There is no public QR route: the SVG is made here, for a link the caller
 * owns, and returned as a string. The link is looked up with the affiliate's id
 * in the WHERE clause, so another affiliate's link is simply not found.
 */
export async function getLinkQrAction(input: unknown): Promise<ActionResult<{ svg: string }>> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(qrSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("affiliate_links")
      .select("code, alias")
      .eq("id", parsed.data.linkId)
      .eq("affiliate_id", guard.actor.userId)
      .maybeSingle()

    if (error) {
      return failed(rpcError(error))
    }

    const row = asRecord(data)
    const code = toText(row?.alias) === "" ? toText(row?.code) : toText(row?.alias)

    if (code === "") {
      return { ok: false, error: affiliateErrorMessage("not_found") }
    }

    const svg = await generateQrSvg(shortLinkUrl(code))

    if (svg === null) {
      return { ok: false, error: affiliateErrorMessage("qr_unavailable") }
    }

    return { ok: true, data: { svg } }
  } catch (error) {
    return failed(error)
  }
}

// ---------------------------------------------------------------------------
// Merchant reads
// ---------------------------------------------------------------------------

const requestsSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected", "blocked"]).optional(),
    productId: z.string().uuid().optional(),
    limit: limitSchema,
    cursor: cursorSchema,
  })
  .strict()

/** Access requests for the vendor's own products. */
export async function getAffiliateRequestsAction(
  input: unknown,
): Promise<ActionResult<Page<AffiliateRequestRow>>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(requestsSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: affiliateErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("vendor_affiliate_requests", {
    p_vendor: guard.actor.userId,
    p_status: parsed.data.status ?? null,
    p_product: parsed.data.productId ?? null,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: AffiliateRequestRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const affiliateId = toText(row.affiliate_id)

    if (affiliateId === "") {
      continue
    }

    items.push({
      affiliateId,
      username: toText(row.username),
      productId: toText(row.product_id),
      productTitle: toText(row.product_title),
      status: toAccessStatus(row.status),
      note: toTextOrNull(row.note),
      requestedAt: toText(row.requested_at),
    })
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

const vendorStatsSchema = dayRangeSchema.extend({
  limit: limitSchema,
  cursor: cursorSchema,
})

/** How each affiliate performed on the vendor's products. */
export async function getVendorAffiliateStatsAction(
  input: unknown,
): Promise<ActionResult<Page<VendorAffiliateRow>>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(vendorStatsSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const cursor = decodeCursor(parsed.data.cursor)

  if (!cursor.ok) {
    return { ok: false, error: affiliateErrorMessage("invalid_cursor") }
  }

  const result = await callRpc("vendor_affiliate_stats", {
    p_vendor: guard.actor.userId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_limit: parsed.data.limit ?? 20,
    p_cursor: cursor.value,
  })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: VendorAffiliateRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const affiliateId = toText(row.affiliate_id)

    if (affiliateId === "") {
      continue
    }

    items.push({
      affiliateId,
      username: toText(row.username),
      clicks: toInteger(row.clicks),
      uniqueClicks: toInteger(row.unique_clicks),
      orders: toInteger(row.orders),
      revenueKobo: toInteger(row.revenue_kobo),
      commissionKobo: toInteger(row.commission_kobo),
    })
  }

  return { ok: true, data: { items, nextCursor: encodeCursor(page?.next_cursor) } }
}

/** The vendor's invitations. Never a token, never a hash. */
export async function getInvitesAction(): Promise<ActionResult<InviteRow[]>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const result = await callRpc("vendor_invites", { p_vendor: guard.actor.userId })

  if (!result.ok) {
    return result
  }

  const page = asRecord(result.data)
  const items: InviteRow[] = []

  for (const raw of asArray(page?.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const id = toText(row.id)

    if (id === "") {
      continue
    }

    items.push({
      id,
      productTitle: toText(row.product_title),
      maxUses: toInteger(row.max_uses),
      uses: toInteger(row.uses),
      expiresAt: toText(row.expires_at),
      revokedAt: toTextOrNull(row.revoked_at),
      createdAt: toText(row.created_at),
    })
  }

  return { ok: true, data: items }
}

const revokeSchema = z.object({ inviteId: z.string().uuid() }).strict()

/** Revoke one of the vendor's invitations. */
export async function revokeInviteAction(input: unknown): Promise<ActionResult<{ revoked: true }>> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(revokeSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget(guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("revoke_affiliate_invite", {
      p_actor: guard.actor.userId,
      p_invite: parsed.data.inviteId,
    })

    if (error) {
      return failed(rpcError(error))
    }

    return { ok: true, data: { revoked: true } }
  } catch (error) {
    return failed(error)
  }
}

// ---------------------------------------------------------------------------
// Small safe reads used by the pages themselves
// ---------------------------------------------------------------------------

/**
 * How many days a commission is held, from the settings table, with the
 * database's own fallback. Never a number the page invented.
 */
export async function getCommissionHoldDays(): Promise<number> {
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "commission_hold_days")
      .maybeSingle()

    if (error) {
      return 7
    }

    const raw = asRecord(data)?.value

    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 365) {
      return raw
    }

    return 7
  } catch {
    return 7
  }
}

/** The title of a live product, for the join page's success sentence. */
export async function getLiveProductTitle(productId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return null
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("products")
      .select("title, status")
      .eq("id", productId)
      .maybeSingle()

    if (error) {
      return null
    }

    const row = asRecord(data)
    const title = toText(row?.title)

    return row?.status === "live" && title !== "" ? title : null
  } catch {
    return null
  }
}
