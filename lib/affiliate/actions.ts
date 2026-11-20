"use server"

import { z } from "zod"

import { affiliateErrorMessage, AFFILIATE_GENERIC_ERROR } from "@/lib/affiliate/errors"
import { hashInviteToken, newInviteToken } from "@/lib/affiliate/token"
import { decodeCursor, encodeCursor } from "@/lib/catalog/cursor"
import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The affiliate server actions.
//
// Every action follows the same order:
//
//   1. who is calling, from the session and never from the input;
//   2. may they (an area action from the permission matrix);
//   3. is the input well formed;
//   4. have they used up their allowance;
//   5. the database function, with p_actor or p_affiliate set to the real user.
//
// Nothing throws to the client: each action answers { ok: true, ... } or
// { ok: false, error } with a sentence that never carries database text. The
// database re-checks every rule, so an action that is wrong about a permission
// still cannot do the thing.

const LINK_COLUMNS = "id, product_id, code, alias, label, status, created_at"

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

const BUDGETS = {
  // Creating a link is a write, and a runaway script should not fill the table.
  createLink: { limit: 30, windowSeconds: 60 * 60 },
  // Asking for access is cheap, but it is a write too.
  requestAccess: { limit: 30, windowSeconds: 60 * 60 },
  // An invitation is a secret: creating them in bulk is not a normal thing to do.
  createInvite: { limit: 20, windowSeconds: 60 * 60 },
  acceptInvite: { limit: 20, windowSeconds: 60 * 60 },
  // A decision is a write on somebody else's row.
  decide: { limit: 120, windowSeconds: 60 * 60 },
  // Reading is limited only so a broken loop cannot hammer the database.
  read: { limit: 120, windowSeconds: 60 },
} as const

type BudgetName = keyof typeof BUDGETS

async function withinBudget(bucket: BudgetName, userId: string): Promise<boolean> {
  const budget = BUDGETS[bucket]

  const result = await rateLimit({
    key: rateLimitKey(["affiliate", bucket, userId]),
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
    onError: "allow",
  })

  return result.allowed
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input)

  if (!result.success) {
    return { ok: false, error: affiliateErrorMessage("invalid_input") }
  }

  return { ok: true, data: result.data }
}

function failed(error: unknown): { ok: false; error: string } {
  const code = error instanceof Error ? error.message.trim() : ""

  // Only a known code is worth logging; the sentence the person sees is mapped.
  if (code !== "" && code.length <= 40 && /^[a-z_]+$/.test(code)) {
    logger.warn("affiliate_action_failed", { code })
  } else {
    logger.error("affiliate_action_failed", { reason: error })
  }

  return { ok: false, error: affiliateErrorMessage(error) }
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

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const createLinkSchema = z.object({
  productId: z.string().uuid(),
  label: z.string().trim().max(60).optional(),
  alias: z.string().trim().max(40).optional(),
})

export type CreateLinkResult =
  | { ok: true; linkId: string; code: string; alias: string | null }
  | { ok: false; error: string }

/**
 * Create a tracked link for one product. The affiliate is the signed-in user,
 * always: there is no field for it.
 */
export async function createLinkAction(input: unknown): Promise<CreateLinkResult> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(createLinkSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("createLink", guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("create_affiliate_link", {
      p_affiliate: guard.actor.userId,
      p_product: parsed.data.productId,
      p_label: parsed.data.label === undefined || parsed.data.label === "" ? null : parsed.data.label,
      p_alias: parsed.data.alias === undefined || parsed.data.alias === "" ? null : parsed.data.alias,
    })

    if (error) {
      return failed(rpcError(error))
    }

    const row = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null
    const linkId = row?.link_id
    const code = row?.code
    const alias = row?.alias

    if (typeof linkId !== "string" || typeof code !== "string") {
      return { ok: false, error: AFFILIATE_GENERIC_ERROR }
    }

    return { ok: true, linkId, code, alias: typeof alias === "string" ? alias : null }
  } catch (error) {
    return failed(error)
  }
}

const archiveLinkSchema = z.object({ linkId: z.string().uuid() })

export type ArchiveLinkResult = { ok: true } | { ok: false; error: string }

/** Archive one of the caller's own links. A link that is not theirs is not found. */
export async function archiveLinkAction(input: unknown): Promise<ArchiveLinkResult> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(archiveLinkSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("archive_affiliate_link", {
      p_affiliate: guard.actor.userId,
      p_link: parsed.data.linkId,
    })

    if (error) {
      return failed(rpcError(error))
    }

    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

const listLinksSchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional()

export interface AffiliateLinkSummary {
  id: string
  productId: string
  code: string
  alias: string | null
  label: string | null
  status: string
  createdAt: string
}

export type ListLinksResult =
  | { ok: true; items: AffiliateLinkSummary[]; nextCursor: string | null }
  | { ok: false; error: string }

/** The caller's own links, newest first, one page at a time. */
export async function listMyLinksAction(input: unknown): Promise<ListLinksResult> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(listLinksSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("read", guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const limit = parsed.data?.limit ?? 20
  const cursor = decodeCursor(parsed.data?.cursor)

  try {
    let query = getSupabaseAdminClient()
      .from("affiliate_links")
      .select(LINK_COLUMNS)
      .eq("affiliate_id", guard.actor.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)

    if (cursor !== null) {
      // Keyset pagination on (created_at, id), so a page does not shift when a
      // link is created while somebody is scrolling.
      query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`)
    }

    const { data, error } = await query

    if (error) {
      return failed(rpcError(error))
    }

    const rows = Array.isArray(data) ? data : []
    const items: AffiliateLinkSummary[] = []

    for (const row of rows) {
      if (typeof row !== "object" || row === null) {
        continue
      }

      const record = row as Record<string, unknown>
      const id = record.id
      const productId = record.product_id
      const code = record.code
      const createdAt = record.created_at

      if (typeof id !== "string" || typeof productId !== "string" || typeof code !== "string" || typeof createdAt !== "string") {
        continue
      }

      items.push({
        id,
        productId,
        code,
        alias: typeof record.alias === "string" ? record.alias : null,
        label: typeof record.label === "string" ? record.label : null,
        status: typeof record.status === "string" ? record.status : "active",
        createdAt,
      })
    }

    const page = items.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor =
      items.length > limit && last !== undefined ? encodeCursor({ at: last.createdAt, id: last.id }) : null

    return { ok: true, items: page, nextCursor }
  } catch (error) {
    return failed(error)
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const requestAccessSchema = z.object({
  productId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
})

export type RequestAccessResult = { ok: true; status: string } | { ok: false; error: string }

/** Ask a vendor for permission to promote an approval-only product. */
export async function requestAccessAction(input: unknown): Promise<RequestAccessResult> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(requestAccessSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("requestAccess", guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("request_product_access", {
      p_affiliate: guard.actor.userId,
      p_product: parsed.data.productId,
      p_note: parsed.data.note === undefined || parsed.data.note === "" ? null : parsed.data.note,
    })

    if (error) {
      return failed(rpcError(error))
    }

    if (typeof data !== "string") {
      return { ok: false, error: AFFILIATE_GENERIC_ERROR }
    }

    return { ok: true, status: data }
  } catch (error) {
    return failed(error)
  }
}

const decideAccessSchema = z.object({
  affiliateId: z.string().uuid(),
  productId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "blocked"]),
  note: z.string().trim().max(500).optional(),
})

export type DecideAccessResult = { ok: true } | { ok: false; error: string }

/**
 * Decide one affiliate's access to one product.
 *
 * The vendor of the product, an admin or a moderator may decide; the database
 * enforces that, so being allowed into the merchant area is not enough on its
 * own.
 */
export async function decideAccessAction(input: unknown): Promise<DecideAccessResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: affiliateErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  // A vendor reaches this through the merchant area; staff through the admin
  // area. The database then checks the product really is theirs.
  if (!can(roles, "area:merchant") && !can(roles, "area:admin")) {
    return { ok: false, error: affiliateErrorMessage("forbidden") }
  }

  const parsed = parse(decideAccessSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("decide", user.id))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("decide_product_access", {
      p_actor: user.id,
      p_affiliate: parsed.data.affiliateId,
      p_product: parsed.data.productId,
      p_decision: parsed.data.decision,
      p_note: parsed.data.note === undefined || parsed.data.note === "" ? null : parsed.data.note,
    })

    if (error) {
      return failed(rpcError(error))
    }

    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

const createInviteSchema = z.object({
  productId: z.string().uuid(),
  maxUses: z.number().int().min(1).max(1000),
  expiresDays: z.number().int().min(1).max(365),
})

export type CreateInviteResult =
  | { ok: true; inviteId: string; token: string; joinPath: string }
  | { ok: false; error: string }

/**
 * Create an invitation to promote one product.
 *
 * The plain token is returned exactly once, in this answer. The database holds
 * its hash, so a leaked database row cannot be turned back into a working link.
 */
export async function createInviteAction(input: unknown): Promise<CreateInviteResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: affiliateErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "area:merchant") && !can(roles, "area:admin")) {
    return { ok: false, error: affiliateErrorMessage("forbidden") }
  }

  const parsed = parse(createInviteSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("createInvite", user.id))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  const token = newInviteToken()

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("create_affiliate_invite", {
      p_actor: user.id,
      p_product: parsed.data.productId,
      p_token_hash: hashInviteToken(token),
      p_max_uses: parsed.data.maxUses,
      p_expires_days: parsed.data.expiresDays,
    })

    if (error) {
      return failed(rpcError(error))
    }

    if (typeof data !== "string") {
      return { ok: false, error: AFFILIATE_GENERIC_ERROR }
    }

    return { ok: true, inviteId: data, token, joinPath: `/join/${token}` }
  } catch (error) {
    return failed(error)
  }
}

const acceptInviteSchema = z.object({
  // 32 bytes in base64url, with the length checked so an absurd value is refused
  // before it is hashed.
  token: z.string().trim().min(16).max(128),
})

export type AcceptInviteResult = { ok: true; productId: string; status: string } | { ok: false; error: string }

/** Accept an invitation. The affiliate is the signed-in user, always. */
export async function acceptInviteAction(input: unknown): Promise<AcceptInviteResult> {
  const guard = await requireActor("area:affiliate")

  if (!guard.ok) {
    return guard
  }

  const parsed = parse(acceptInviteSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("acceptInvite", guard.actor.userId))) {
    return { ok: false, error: affiliateErrorMessage("rate_limited") }
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("accept_affiliate_invite", {
      p_affiliate: guard.actor.userId,
      p_token_hash: hashInviteToken(parsed.data.token),
    })

    if (error) {
      return failed(rpcError(error))
    }

    const row = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null
    const productId = row?.product_id
    const status = row?.status

    if (typeof productId !== "string" || typeof status !== "string") {
      return { ok: false, error: AFFILIATE_GENERIC_ERROR }
    }

    return { ok: true, productId, status }
  } catch (error) {
    return failed(error)
  }
}
