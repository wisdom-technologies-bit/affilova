import "server-only"

import { createHash } from "node:crypto"

import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// Postgres-backed fixed window rate limiting.
//
// The counter lives in public.rate_limits and is incremented by the
// rate_limit_hit() function in one atomic upsert (see
// supabase/migrations/20261113000200_rate_limits.sql), so every server instance
// shares the same count and two concurrent requests cannot both slip past.
//
// Nothing here may be imported from a client component: the call goes through
// the service role client, which bypasses row level security.

export type RateLimitErrorPolicy = "allow" | "deny"

export interface RateLimitOptions {
  /** Already hashed by rateLimitKey() in the callers. Never a raw IP or email. */
  key: string
  /** Hits allowed per window. A limit of 5 allows hits 1 to 5. */
  limit: number
  windowSeconds: number
  /**
   * What to answer when the database call fails. Auth flows use "allow": a
   * database hiccup must not lock everyone out of their account. A limiter
   * guarding an expensive resource would use "deny".
   */
  onError?: RateLimitErrorPolicy
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

const MAX_LOG_LENGTH = 200

// Supabase answers with a plain object (PostgrestError), not an Error, so both
// shapes are read before giving up.
function shortMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim().slice(0, MAX_LOG_LENGTH)
  }

  if (typeof error === "object" && error !== null) {
    const message: unknown = (error as { message?: unknown }).message

    if (typeof message === "string" && message.trim() !== "") {
      return message.trim().slice(0, MAX_LOG_LENGTH)
    }
  }

  return "unexpected error"
}

/**
 * Join the parts with ":" and hash the result with SHA-256.
 *
 * The raw value never reaches the database or a log line: the table holds
 * opaque keys, so an IP address or an email address cannot be read back out of
 * it. Callers pass a namespace first, for example ["sign-in", "ip", ip].
 */
export function rateLimitKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex")
}

/**
 * The caller's address, as the proxy chain reports it.
 *
 * x-forwarded-for is a comma separated list ("client, proxy1, proxy2") and only
 * the first entry is the client. An empty header, or no header at all, falls
 * back to x-real-ip and finally to the literal "unknown", which buckets all
 * unattributable traffic together rather than disabling the limit.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")

  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim() ?? ""

    if (first !== "") {
      return first
    }
  }

  const realIp = headers.get("x-real-ip")?.trim() ?? ""

  return realIp !== "" ? realIp : "unknown"
}

type RpcRow = { allowed: boolean; remaining: number; reset_at: string }

// The RPC answer is `unknown` on purpose: it comes from the network and from an
// untyped RPC call, so every field is checked before it is trusted.
function firstRow(data: unknown): RpcRow | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  const row: unknown = data[0]

  if (typeof row !== "object" || row === null) {
    return null
  }

  const candidate = row as Record<string, unknown>

  if (
    typeof candidate.allowed !== "boolean" ||
    typeof candidate.remaining !== "number" ||
    typeof candidate.reset_at !== "string"
  ) {
    return null
  }

  return {
    allowed: candidate.allowed,
    remaining: candidate.remaining,
    reset_at: candidate.reset_at,
  }
}

/**
 * Count one hit for `key` and report whether it is allowed.
 *
 * Never throws: a failure is logged once and answered according to `onError`,
 * so a caller can await this without its own try/catch.
 */
export async function rateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowSeconds, onError = "allow" } = options

  const fallback = (): RateLimitResult => ({
    allowed: onError === "allow",
    remaining: onError === "allow" ? limit : 0,
    resetAt: new Date(Date.now() + windowSeconds * 1000),
  })

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })

    if (error) {
      logger.error("rate_limit_lookup_failed", {
        policy: onError,
        reason: shortMessage(error),
      })

      return fallback()
    }

    const row = firstRow(data)

    if (row === null) {
      logger.error("rate_limit_unexpected_answer", { policy: onError })

      return fallback()
    }

    const resetAt = new Date(row.reset_at)

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      resetAt: Number.isNaN(resetAt.getTime())
        ? new Date(Date.now() + windowSeconds * 1000)
        : resetAt,
    }
  } catch (error) {
    logger.error("rate_limit_lookup_failed", {
      policy: onError,
      reason: shortMessage(error),
    })

    return fallback()
  }
}
