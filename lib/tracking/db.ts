import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import type { RecordClickInput, RecordClickResult } from "@/lib/tracking/click"

// The two functions the click route calls.
//
// Both answers are treated as claims, not promises: the SQL is ours, but a
// shape that does not match what the route needs is reported as "no click"
// rather than trusted. Nothing here logs a hash, an address or a user agent.

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const [row]: unknown[] = data

    return asRecord(row)
  }

  return asRecord(data)
}

/**
 * Store one click and learn which product it belongs to.
 *
 * A refusal (an unknown code, an archived link, an affiliate who may no longer
 * promote the product) is an answer, not an error: ok is false and the route
 * sends the visitor home.
 */
export async function recordClick(input: RecordClickInput): Promise<RecordClickResult> {
  const { data, error } = await getSupabaseAdminClient().rpc("record_click", {
    p_click: input.clickId,
    p_code: input.code,
    p_ip_hash: input.ipHash,
    p_ua_hash: input.uaHash,
    p_referrer_host: input.referrerHost,
    p_country: input.country,
    p_device: input.device,
    p_sub1: input.sub1,
    p_sub2: input.sub2,
    p_sub3: input.sub3,
    p_utm_source: input.utmSource,
    p_utm_medium: input.utmMedium,
    p_utm_campaign: input.utmCampaign,
  })

  if (error) {
    throw new Error("record_click_failed")
  }

  const row = firstRow(data)

  if (row === null || row.ok !== true) {
    return { ok: false, productSlug: null, productId: null }
  }

  const slug = row.product_slug
  const productId = row.product_id

  if (typeof slug !== "string" || slug === "" || typeof productId !== "string" || productId === "") {
    return { ok: false, productSlug: null, productId: null }
  }

  return { ok: true, productSlug: slug, productId }
}

/**
 * The product slug behind an active link, for a bot or a link preview.
 *
 * Read only: no click row, no cookie, no affiliate.
 */
export async function getLinkTarget(code: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_link_target", {
    p_code: code,
  })

  if (error) {
    throw new Error("get_link_target_failed")
  }

  if (typeof data === "string") {
    return data === "" ? null : data
  }

  if (Array.isArray(data)) {
    const [value]: unknown[] = data

    return typeof value === "string" && value !== "" ? value : null
  }

  return null
}
