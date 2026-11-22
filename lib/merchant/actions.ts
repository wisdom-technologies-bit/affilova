/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

"use server"

import { decideRefund } from "@/lib/commerce/db"
import { getAuthUser } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

export async function getVendorOverviewAction(input?: { from?: string; to?: string }) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("vendor_overview", {
    p_vendor: user.id,
    p_from: input?.from ? new Date(input.from).toISOString() : null,
    p_to: input?.to ? new Date(input.to).toISOString() : null,
  })

  if (error) {
    return { ok: false, error: "Could not load vendor overview." }
  }

  return { ok: true, data }
}

export async function getVendorDailySeriesAction(input?: { from?: string; to?: string }) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("vendor_daily_series", {
    p_vendor: user.id,
    p_from: input?.from || null,
    p_to: input?.to || null,
  })

  if (error) {
    return { ok: false, error: "Could not load daily series." }
  }

  return { ok: true, data: data ?? [] }
}

export async function getVendorSalesAction(input?: { status?: string; limit?: number; cursor?: unknown }) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("vendor_sales_list", {
    p_vendor: user.id,
    p_status: input?.status || "all",
    p_limit: input?.limit || 20,
    p_cursor: input?.cursor || null,
  })

  if (error) {
    return { ok: false, error: "Could not load sales list." }
  }

  return { ok: true, data: data ?? { items: [], next_cursor: null } }
}

export async function getVendorRefundRequestsAction(input?: { status?: string; limit?: number; cursor?: unknown }) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("vendor_refund_requests", {
    p_vendor: user.id,
    p_status: input?.status || "all",
    p_limit: input?.limit || 20,
    p_cursor: input?.cursor || null,
  })

  if (error) {
    return { ok: false, error: "Could not load refund requests." }
  }

  return { ok: true, data: data ?? { items: [], next_cursor: null } }
}

export async function getVendorTopProductsAction(input?: { from?: string; to?: string }) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc("vendor_top_products", {
    p_vendor: user.id,
    p_from: input?.from || null,
    p_to: input?.to || null,
  })

  if (error) {
    return { ok: false, error: "Could not load top products." }
  }

  return { ok: true, data: data ?? [] }
}

export async function decideVendorRefundAction(input: {
  requestId: string
  decision: "approve" | "reject"
  note: string
}) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  if (input.decision === "reject" && (!input.note || input.note.trim().length < 10)) {
    return { ok: false, error: "Rejection note must be at least 10 characters." }
  }

  try {
    await decideRefund({
      actorId: user.id,
      requestId: input.requestId,
      decision: input.decision,
      note: input.note,
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not process refund decision." }
  }
}
