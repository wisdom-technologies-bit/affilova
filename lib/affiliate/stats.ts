import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The three scheduled affiliate jobs.
//
// Each one is a single database call, so a run is bounded by one statement and
// finishes well inside the endpoint's 20 second budget. The answers are read
// defensively: a shape that is not a number is zero, not an error.

function readCount(data: unknown): number {
  if (typeof data === "number" && Number.isFinite(data)) {
    return data
  }

  if (Array.isArray(data)) {
    const [value]: unknown[] = data

    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }

  return 0
}

/**
 * A Lagos calendar day as YYYY-MM-DD.
 *
 * Lagos is UTC+1 with no daylight saving, but the conversion goes through the
 * time zone name rather than a fixed offset: a rule change would then be a
 * data change, not a code change.
 */
export function lagosDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** The Lagos day before the given one, as YYYY-MM-DD. */
export function previousLagosDay(date: Date): string {
  const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1000)

  return lagosDay(yesterday)
}

/** Rebuild the daily statistics for a range of Lagos days. Idempotent. */
export async function rollupAffiliateStats(from: string, to: string): Promise<number> {
  const { data, error } = await getSupabaseAdminClient().rpc("rollup_affiliate_stats", {
    p_from: from,
    p_to: to,
  })

  if (error) {
    throw new Error("rollup_affiliate_stats_failed")
  }

  return readCount(data)
}

/** Look for click bursts and click farms, and return how many flags were added. */
export async function scanClickAnomalies(): Promise<number> {
  const { data, error } = await getSupabaseAdminClient().rpc("scan_click_anomalies")

  if (error) {
    throw new Error("scan_click_anomalies_failed")
  }

  return readCount(data)
}

/** Forget clicks older than the retention window. */
export async function purgeOldClicks(months: number): Promise<number> {
  const { data, error } = await getSupabaseAdminClient().rpc("purge_old_clicks", {
    p_months: months,
  })

  if (error) {
    throw new Error("purge_old_clicks_failed")
  }

  return readCount(data)
}
