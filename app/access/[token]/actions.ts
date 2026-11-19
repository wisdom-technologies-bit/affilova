"use server"

import { headers } from "next/headers"

import { requestRefundAction } from "@/lib/commerce/actions"
import { verifyAccessToken } from "@/lib/commerce/access-token"
import { defaultDownloadDeps, downloadFile } from "@/lib/commerce/download"
import { getAuthUser } from "@/lib/identity/session"
import { clientIpFromHeaders } from "@/lib/rate-limit"

// The two things the access page can do.
//
// Both take the token, not an order id: the order is whatever the token names,
// so a caller cannot act on an order they were not given a link to. Both verify
// the token themselves, because a page render is not an authorisation.

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
 * Ask for a refund on the order the token names.
 *
 * The order id comes from the token, never from the browser. The parallel task's
 * action decides everything else: whether the window is open, whether a request
 * already exists, and who the buyer is.
 */
export async function requestRefundForOrderAction(input: {
  token: string
  reason: string
}): Promise<RefundActionResult> {
  const verified = verifyAccessToken(typeof input?.token === "string" ? input.token : "")

  if (!verified.ok) {
    return { ok: false, message: "This link is not valid, so a refund cannot be requested from it." }
  }

  const result = await requestRefundAction({
    orderId: verified.claims.orderId,
    reason: typeof input?.reason === "string" ? input.reason : "",
  })

  if (!result.ok) {
    return { ok: false, message: result.error }
  }

  return {
    ok: true,
    autoApproved: result.autoApproved,
    message: result.autoApproved
      ? "Your refund was approved and is being processed."
      : "Your refund request was sent to the vendor for a decision.",
  }
}
