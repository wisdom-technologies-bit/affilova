/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

"use server"

import { headers } from "next/headers"

import { DOWNLOAD_MESSAGES, DOWNLOAD_URL_SECONDS, hashDownloadIp, type DownloadFailure } from "@/lib/commerce/download"
import { getAuthUser } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { getR2Storage } from "@/lib/storage/r2"

export interface AccountActionResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Claim guest orders and list account orders */
export async function getMyOrdersAction(input?: {
  limit?: number
  cursor?: unknown
}): Promise<AccountActionResult<{ items: any[]; next_cursor: any }>> {
  const user = await getAuthUser()
  if (!user) {
    return { ok: false, error: "Not authenticated" }
  }

  const allowed = await rateLimit({
    key: rateLimitKey(["account-read", user.id]),
    limit: 120,
    windowSeconds: 60,
    onError: "allow",
  })
  if (!allowed.allowed) {
    return { ok: false, error: "Too many requests. Please slow down." }
  }

  const admin = getSupabaseAdminClient()

  // 1. Claim guest orders
  await admin.rpc("claim_guest_orders", { p_user: user.id })

  // 2. Fetch orders
  const { data, error } = await admin.rpc("account_orders", {
    p_user: user.id,
    p_limit: input?.limit ?? 20,
    p_cursor: input?.cursor ?? null,
  })

  if (error) {
    logger.error("account_orders_failed", { error: error.message, userId: user.id })
    return { ok: false, error: "Could not load purchases." }
  }

  return { ok: true, data: data ?? { items: [], next_cursor: null } }
}

/** Get order detail */
export async function getMyOrderAction(input: { orderId: string }): Promise<AccountActionResult<any>> {
  const user = await getAuthUser()
  if (!user) {
    return { ok: false, error: "Not authenticated" }
  }

  const allowed = await rateLimit({
    key: rateLimitKey(["account-read", user.id]),
    limit: 120,
    windowSeconds: 60,
    onError: "allow",
  })
  if (!allowed.allowed) {
    return { ok: false, error: "Too many requests. Please slow down." }
  }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("account_order_detail", {
    p_user: user.id,
    p_order: input.orderId,
  })

  if (error || !data) {
    return { ok: false, error: "Order not found." }
  }

  return { ok: true, data }
}

/** Download file */
export async function downloadMyFileAction(input: {
  orderId: string
  entitlementId: string
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getAuthUser()
  if (!user) {
    return { ok: false, error: "Not authenticated" }
  }

  const allowed = await rateLimit({
    key: rateLimitKey(["account-download", user.id]),
    limit: 30,
    windowSeconds: 3600,
    onError: "allow",
  })
  if (!allowed.allowed) {
    return { ok: false, error: "Download rate limit reached. Try again later." }
  }

  const requestHeaders = await headers()
  const ip = clientIpFromHeaders(requestHeaders)
  const ipHash = hashDownloadIp(ip)

  const admin = getSupabaseAdminClient()

  // Verify order ownership
  const { data: orderData } = await admin.from("orders").select("id, status, buyer_user_id").eq("id", input.orderId).single()
  if (!orderData || orderData.buyer_user_id !== user.id || orderData.status !== "paid") {
    return { ok: false, error: DOWNLOAD_MESSAGES.not_paid }
  }

  const { data: claimData, error: claimError } = await admin.rpc("claim_download", {
    p_entitlement: input.entitlementId,
    p_buyer_user: user.id,
    p_buyer_email: null,
    p_ip_hash: ipHash,
  })

  if (claimError !== null) {
    const code = (claimError.message || "unavailable") as DownloadFailure
    return { ok: false, error: DOWNLOAD_MESSAGES[code] || DOWNLOAD_MESSAGES.unavailable }
  }

  const row = Array.isArray(claimData) ? claimData[0] : claimData
  const record = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null

  if (record === null || typeof record.storage_key !== "string" || typeof record.filename !== "string") {
    return { ok: false, error: DOWNLOAD_MESSAGES.unavailable }
  }

  try {
    const r2 = getR2Storage()
    const url = await r2.presignGetUrl({
      key: record.storage_key,
      filename: record.filename,
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    })
    return { ok: true, url }
  } catch (err) {
    logger.error("account_presign_failed", { error: err })
    return { ok: false, error: DOWNLOAD_MESSAGES.unavailable }
  }
}

/** Request refund */
export async function requestMyRefundAction(input: {
  orderId: string
  reason: string
}): Promise<{ ok: boolean; message?: string; autoApproved?: boolean }> {
  const user = await getAuthUser()
  if (!user) {
    return { ok: false, error: "Not authenticated" }
  }

  try {
    const { requestRefund } = await import("@/lib/commerce/db")
    const res = await requestRefund({
      actorId: user.id,
      orderId: input.orderId,
      reason: input.reason,
    })
    return { ok: true, autoApproved: res.autoApproved }
  } catch (err: any) {
    return { ok: false, message: err?.message || "Could not submit refund request." }
  }
}
