import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { hashAccessEmail, verifyAccessToken, type AccessTokenResult } from "./access-token"

// What an access link may show.
//
// The token is checked first, then the order it names. A token is only honoured
// when the email hash it carries matches the order's buyer email, so a link
// cannot be re-pointed at another order. The order must be paid: a refunded or
// disputed order keeps its records but hands out nothing.

export interface AccessFile {
  entitlementId: string
  displayName: string
  sizeBytes: number
  downloadsUsed: number
  maxDownloads: number
}

export interface AccessItem {
  title: string
  files: AccessFile[]
}

export interface AccessOrder {
  orderId: string
  number: string
  paidAt: string | null
  refundWindowHours: number
  /** ISO instant the refund window closes, or null when it cannot be computed. */
  refundWindowEndsAt: string | null
  /** True while a refund may still be asked for. */
  refundOpen: boolean
  /** The state of an existing refund request, when there is one. */
  refundStatus: string | null
  items: AccessItem[]
}

export type AccessGrant =
  | { kind: "invalid"; reason: "malformed" | "invalid_signature" | "expired" }
  | { kind: "not_paid" }
  | { kind: "ok"; order: AccessOrder }

export interface AccessDeps {
  verify: (token: string) => AccessTokenResult
  /** One order row with its items, entitlements and files. */
  loadOrder: (orderId: string) => Promise<unknown | null>
  now?: () => Date
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) {
    return null
  }

  const value = source[key]

  return typeof value === "string" && value !== "" ? value : null
}

function integer(source: Record<string, unknown> | null, key: string, fallback: number): number {
  if (source === null) {
    return fallback
  }

  const value = source[key]

  return typeof value === "number" && Number.isInteger(value) ? value : fallback
}

function list(source: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  if (source === null) {
    return []
  }

  const value = source[key]

  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
}

/** The instant the refund window closes: paidAt plus the window, or null. */
export function refundWindowEnd(paidAt: string | null, hours: number): Date | null {
  if (paidAt === null || hours <= 0) {
    return null
  }

  const start = new Date(paidAt)

  if (Number.isNaN(start.getTime())) {
    return null
  }

  return new Date(start.getTime() + hours * 60 * 60 * 1000)
}

export type RefundState = "open" | "closed" | "requested" | "processed"

const OPEN_REFUNDS = ["requested", "approved"]

/** Whether the refund form is offered, from the window and any existing request. */
export function refundState(input: {
  paidAt: string | null
  hours: number
  requestStatus: string | null
  now: Date
}): RefundState {
  if (input.requestStatus !== null) {
    return input.requestStatus === "processed" ? "processed" : "requested"
  }

  const end = refundWindowEnd(input.paidAt, input.hours)

  if (end === null) {
    return "closed"
  }

  return input.now.getTime() < end.getTime() ? "open" : "closed"
}

/** Read an access order out of the joined row, or null when it cannot be shown. */
export function toAccessOrder(row: unknown, now: Date): AccessOrder | null {
  const record = asRecord(row)

  if (record === null) {
    return null
  }

  const orderId = text(record, "id")
  const number = text(record, "number")

  if (orderId === null || number === null) {
    return null
  }

  const paidAt = text(record, "paid_at")
  const refundRequest = asRecord(record.refund_requests)
  const requestStatus = text(refundRequest, "status")

  const items = list(record, "order_items").map((item): AccessItem => {
    const files = list(item, "entitlements")
      .filter((entitlement) => entitlement.revoked_at === null || entitlement.revoked_at === undefined)
      .map((entitlement): AccessFile | null => {
        const entitlementId = text(entitlement, "id")
        const file = asRecord(entitlement.product_files)

        if (entitlementId === null || file === null) {
          return null
        }

        return {
          entitlementId,
          displayName: text(file, "original_name") ?? "File",
          sizeBytes: integer(file, "size_bytes", 0),
          downloadsUsed: integer(entitlement, "downloads_used", 0),
          maxDownloads: integer(entitlement, "max_downloads", 0),
        }
      })
      .filter((file): file is AccessFile => file !== null)

    return {
      title: text(item, "title_snapshot") ?? "Product",
      files,
    }
  })

  const windowHours = integer(list(record, "order_items")[0] ?? null, "refund_window_hours", 0)
  const end = refundWindowEnd(paidAt, windowHours)

  return {
    orderId,
    number,
    paidAt,
    refundWindowHours: windowHours,
    refundWindowEndsAt: end === null ? null : end.toISOString(),
    refundOpen:
      refundState({ paidAt, hours: windowHours, requestStatus, now }) === "open",
    refundStatus: requestStatus,
    items,
  }
}

const SELECT = [
  "id",
  "number",
  "status",
  "buyer_email",
  "paid_at",
  "order_items(title_snapshot,refund_window_hours,entitlements(id,downloads_used,max_downloads,revoked_at,product_files(original_name,size_bytes)))",
  "refund_requests(status,created_at)",
].join(",")

async function loadOrderRow(orderId: string): Promise<unknown | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("orders")
    .select(SELECT)
    .eq("id", orderId)
    .eq("status", "paid")
    .order("created_at", { referencedTable: "refund_requests", ascending: false })
    .limit(1, { referencedTable: "refund_requests" })
    .maybeSingle()

  if (error !== null) {
    return null
  }

  return data
}

/**
 * Verify a token and load what it grants.
 *
 * A token that verifies but names an order that is not paid answers "not_paid":
 * the page then says the purchase is not active rather than pretending the link
 * is broken.
 */
export async function loadAccessGrant(token: string, deps?: AccessDeps): Promise<AccessGrant> {
  const now = deps?.now === undefined ? new Date() : deps.now()
  const verified = (deps?.verify ?? verifyAccessToken)(token)

  if (!verified.ok) {
    return { kind: "invalid", reason: verified.reason }
  }

  let row: unknown

  try {
    row = await (deps?.loadOrder ?? loadOrderRow)(verified.claims.orderId)
  } catch {
    return { kind: "not_paid" }
  }

  const record = asRecord(row)

  if (record === null) {
    return { kind: "not_paid" }
  }

  const buyerEmail = text(record, "buyer_email")

  if (buyerEmail === null || hashAccessEmail(buyerEmail) !== verified.claims.emailHash) {
    return { kind: "invalid", reason: "invalid_signature" }
  }

  const order = toAccessOrder(record, now)

  return order === null ? { kind: "not_paid" } : { kind: "ok", order }
}
