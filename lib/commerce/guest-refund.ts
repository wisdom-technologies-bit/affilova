import "server-only"

import type { AccessTokenResult } from "@/lib/commerce/access-token"
import { commerceErrorMessage, GENERIC_COMMERCE_ERROR } from "@/lib/commerce/errors"

// A refund asked for from the download link, by someone who may not be signed in.
//
// The link is the only credential: it carries the order id and a hash of the
// buyer's email, and the database proves ownership again by comparing the email
// the order was bought with. Nothing here trusts the browser for the order id or
// the amount, and nothing here decides whether the refund is allowed: the
// database applies the same rules as the signed-in path.
//
// The order id the browser sends must be the one the token names. It is passed
// at all so a form can say which order it is asking about, not so it can choose.

/** Five asks an hour from one address. */
export const GUEST_REFUND_IP_LIMIT = 5

/** Three asks an hour on one order. */
export const GUEST_REFUND_ORDER_LIMIT = 3

export const GUEST_REFUND_WINDOW_SECONDS = 60 * 60

export const GUEST_REFUND_MIN = 10

export const GUEST_REFUND_MAX = 1000

export const REFUND_LINK_INVALID =
  "This link is not valid, so a refund cannot be requested from it."

export const REFUND_LINK_WRONG_ORDER =
  "This link belongs to a different order, so a refund cannot be requested from it."

export const REFUND_ORDER_UNAVAILABLE = "This order cannot be refunded from this link."

export interface GuestRefundInput {
  token: string
  orderId: string
  reason: string
  /** The caller's address, already read from the request headers. */
  ip: string
}

export interface GuestRefundDeps {
  verifyToken: (token: string) => AccessTokenResult
  rateLimit: (options: {
    key: string
    limit: number
    windowSeconds: number
    onError: "allow" | "deny"
  }) => Promise<{ allowed: boolean }>
  rateLimitKey: (parts: readonly string[]) => string
  /** The address the order was bought with, or null when there is no order. */
  readBuyerEmail: (orderId: string) => Promise<string | null>
  requestRefund: (input: {
    orderId: string
    email: string
    reason: string
  }) => Promise<{ requestId: string; autoApproved: boolean }>
  /** Queue the submission when the database approved the request immediately. */
  enqueueSubmit: (requestId: string) => Promise<void>
  logError: (event: string, fields: Record<string, unknown>) => void
}

export type GuestRefundResult =
  | { ok: true; autoApproved: boolean }
  | { ok: false; error: string }

/**
 * Verify the link, count the attempt, then let the database decide.
 *
 * The two limits deny when the counter cannot be read: asking for a refund is
 * worth refusing rather than letting an outage turn into unlimited attempts.
 */
export async function requestGuestRefund(
  input: GuestRefundInput,
  deps: GuestRefundDeps,
): Promise<GuestRefundResult> {
  const token = typeof input.token === "string" ? input.token : ""
  const verified = deps.verifyToken(token)

  if (!verified.ok) {
    return { ok: false, error: REFUND_LINK_INVALID }
  }

  const orderId = typeof input.orderId === "string" ? input.orderId.trim().toLowerCase() : ""

  if (orderId === "" || orderId !== verified.claims.orderId.trim().toLowerCase()) {
    return { ok: false, error: REFUND_LINK_WRONG_ORDER }
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : ""

  if (reason.length < GUEST_REFUND_MIN || reason.length > GUEST_REFUND_MAX) {
    return { ok: false, error: commerceErrorMessage("invalid_reason") }
  }

  const ipLimit = await deps.rateLimit({
    key: deps.rateLimitKey(["refund", "ip", input.ip]),
    limit: GUEST_REFUND_IP_LIMIT,
    windowSeconds: GUEST_REFUND_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!ipLimit.allowed) {
    return { ok: false, error: commerceErrorMessage("rate_limited") }
  }

  const orderLimit = await deps.rateLimit({
    key: deps.rateLimitKey(["refund", "order", orderId]),
    limit: GUEST_REFUND_ORDER_LIMIT,
    windowSeconds: GUEST_REFUND_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!orderLimit.allowed) {
    return { ok: false, error: commerceErrorMessage("rate_limited") }
  }

  let email: string | null

  try {
    email = await deps.readBuyerEmail(orderId)
  } catch {
    deps.logError("guest_refund_lookup_failed", {})

    return { ok: false, error: GENERIC_COMMERCE_ERROR }
  }

  if (email === null || email === "") {
    return { ok: false, error: REFUND_ORDER_UNAVAILABLE }
  }

  let result: { requestId: string; autoApproved: boolean }

  try {
    result = await deps.requestRefund({ orderId, email, reason })
  } catch (error) {
    // The database's code is looked up, never shown: 'forbidden' and
    // 'not_refundable' both answer a sentence a stranger can read.
    deps.logError("guest_refund_failed", {
      code: error instanceof Error ? error.message : "unknown",
    })

    return { ok: false, error: commerceErrorMessage(error) }
  }

  if (result.autoApproved) {
    try {
      await deps.enqueueSubmit(result.requestId)
    } catch {
      // The request is approved and stands. A queue failure is logged, not
      // reported as a failure: the next decision or a retry can submit it.
      deps.logError("guest_refund_enqueue_failed", {})
    }
  }

  return { ok: true, autoApproved: result.autoApproved }
}
