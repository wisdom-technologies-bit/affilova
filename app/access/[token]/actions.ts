"use server"

import { headers } from "next/headers"

import { verifyAccessToken } from "@/lib/commerce/access-token"
import { requestRefundByEmail, readOrderBuyerEmail } from "@/lib/commerce/db"
import { defaultDownloadDeps, downloadFile } from "@/lib/commerce/download"
import { requestGuestRefund } from "@/lib/commerce/guest-refund"
import { enqueueRefundSubmit } from "@/lib/commerce/refund-submit"
import { getAuthUser } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"

// The two things the access page can do.
//
// Both take the token: the order is whatever the token names, so a caller cannot
// act on an order they were not given a link to. The refund action also takes the
// order id the form is showing, and refuses it unless the token names that same
// order. Both verify the token themselves, because a page render is not an
// authorisation.

export interface DownloadActionResult {
  ok: boolean
  url?: string
  error?: string
}

/** Claim one download and return a short-lived URL for it. */
export async function downloadFileAction(input: {
  token: string
  entitlementId: string
}): Promise<DownloadActionResult> {
  const requestHeaders = await headers()

  let userId: string | null = null

  try {
    const user = await getAuthUser()

    userId = user === null ? null : user.id
  } catch {
    userId = null
  }

  const outcome = await downloadFile(
    {
      token: typeof input?.token === "string" ? input.token : "",
      entitlementId: typeof input?.entitlementId === "string" ? input.entitlementId : "",
      ip: clientIpFromHeaders(requestHeaders),
      userId,
    },
    defaultDownloadDeps(),
  )

  return outcome.ok ? { ok: true, url: outcome.url } : { ok: false, error: outcome.error }
}

export interface RefundActionResult {
  ok: boolean
  message?: string
  autoApproved?: boolean
}

/**
 * Ask for a refund on the order the link names.
 *
 * This is the only refund path on the access page, signed in or not: the link is
 * the credential, and the database proves ownership by comparing the address the
 * order was bought with. The order id is checked against the token, so a form
 * cannot point the link at another order.
 */
export async function requestRefundWithTokenAction(input: {
  token: string
  orderId: string
  reason: string
}): Promise<RefundActionResult> {
  const requestHeaders = await headers()

  const outcome = await requestGuestRefund(
    {
      token: typeof input?.token === "string" ? input.token : "",
      orderId: typeof input?.orderId === "string" ? input.orderId : "",
      reason: typeof input?.reason === "string" ? input.reason : "",
      ip: clientIpFromHeaders(requestHeaders),
    },
    {
      verifyToken: verifyAccessToken,
      rateLimit,
      rateLimitKey,
      readBuyerEmail: readOrderBuyerEmail,
      requestRefund: requestRefundByEmail,
      enqueueSubmit: enqueueRefundSubmit,
      logError: (event, fields) => logger.error(event, fields),
    },
  )

  if (!outcome.ok) {
    return { ok: false, message: outcome.error }
  }

  return {
    ok: true,
    autoApproved: outcome.autoApproved,
    message: outcome.autoApproved
      ? "Your refund was approved and is being processed."
      : "Your refund request was sent to the vendor for a decision.",
  }
}
