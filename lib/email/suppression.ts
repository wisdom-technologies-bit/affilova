import "server-only"

import { createHash } from "node:crypto"

import {
  EMAIL_SUPPRESSION_REASONS,
  isEmailSuppressionReason,
  type EmailSuppressionReason,
} from "@/lib/email/reasons"
import { getEmailHashPepper } from "@/lib/env"
import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The list of addresses we must not write to again.
//
// Brevo tells us when a message hard bounces, is blocked or is marked as spam.
// Writing to that address again is the fastest way to damage the sending domain:
// the complaint rate is what providers judge a sender on, and one address that
// keeps complaining is enough to move a new domain into the spam folder. So the
// address goes on a list and every send asks the list first.
//
// What is stored is never the address. It is SHA-256 of the lowercased address
// with a server-side pepper (EMAIL_HASH_PEPPER), so the same address always
// produces the same row and the table cannot be read back into a list of
// addresses by anyone who takes a copy of it. The pepper is required and at
// least 32 characters: an unpeppered hash of an address is a hash anyone can
// reproduce from a list of guesses.
//
// The format is exactly this, and the only place that computes it is here:
//
//   sha256( "<pepper>" + ":" + lower(trim(address)) )  as 64 lower-case hex
//
// Nothing in this file logs an address. A log line is a leak that outlives the
// request, so the only fields written are the reason and the source.

/**
 * The five words the table accepts. The list itself lives in
 * lib/email/reasons.ts, which a client component may import.
 */
export const SUPPRESSION_REASONS = EMAIL_SUPPRESSION_REASONS

export type SuppressionReason = EmailSuppressionReason

/** Where a suppression came from, cut to the column's length. */
export const MAX_SUPPRESSION_SOURCE_LENGTH = 60

export const isSuppressionReason = isEmailSuppressionReason

/**
 * The hash of an address: SHA-256 of the pepper, a colon, and the address in
 * lower case with its surrounding whitespace removed.
 *
 * The pepper may be passed in so a test does not need the environment. The
 * production path always reads it from EMAIL_HASH_PEPPER, and throws when it is
 * missing or shorter than 32 characters, because a hash made without it is not
 * private.
 */
export function hashRecipient(address: string, pepper?: string): string {
  const key = pepper ?? getEmailHashPepper()

  if (key.length < 32) {
    throw new Error("EMAIL_HASH_PEPPER must be at least 32 characters")
  }

  return createHash("sha256").update(`${key}:${address.trim().toLowerCase()}`, "utf8").digest("hex")
}

/** The slice of the admin client this module needs, so a test can stand in for it. */
export interface SuppressionStore {
  isSuppressed(hash: string): Promise<boolean>
  add(hash: string, reason: SuppressionReason, source: string): Promise<number>
}

/**
 * The production store: the two SECURITY DEFINER functions, through the service
 * role. Imported lazily nowhere, because this module is already server-only and
 * is only reached from a send or a webhook.
 */
export function supabaseSuppressionStore(): SuppressionStore {
  return {
    async isSuppressed(hash: string): Promise<boolean> {
      const { data, error } = await getSupabaseAdminClient().rpc("is_email_suppressed", {
        p_hash: hash,
      })

      if (error !== null) {
        throw new Error("Could not read the email suppression list")
      }

      return data === true
    },

    async add(hash: string, reason: SuppressionReason, source: string): Promise<number> {
      const { data, error } = await getSupabaseAdminClient().rpc("add_email_suppression", {
        p_hash: hash,
        p_reason: reason,
        p_source: source,
      })

      if (error !== null) {
        throw new Error("Could not write the email suppression list")
      }

      return typeof data === "number" ? data : 1
    },
  }
}

/** One second: a suppression check must never hold up a send for long. */
export const SUPPRESSION_LOOKUP_TIMEOUT_MS = 1_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms)
    }),
  ]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  })
}

/**
 * Whether this address must not be written to.
 *
 * Fails OPEN. A database blip that stopped every message the product sends would
 * be worse than a message to one address that bounced last month: the buyer
 * waiting for a download link cannot tell the difference between "we chose not
 * to send" and "we are broken", and the second one costs more. The error is
 * logged, without the address, and the send goes ahead.
 *
 * A missing or short pepper is a different matter: that is a configuration
 * error, it is loud in the log, and it also fails open, because the alternative
 * is not sending anything at all.
 */
export async function isSuppressed(
  address: string,
  store: SuppressionStore = supabaseSuppressionStore(),
): Promise<boolean> {
  let hash: string

  try {
    hash = hashRecipient(address)
  } catch (error) {
    logger.error("email_suppression_check_failed", {
      reason: "hash_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    })

    return false
  }

  try {
    return await withTimeout(store.isSuppressed(hash), SUPPRESSION_LOOKUP_TIMEOUT_MS)
  } catch (error) {
    logger.error("email_suppression_check_failed", {
      reason: "lookup_failed",
      detail: error instanceof Error ? error.message : "unknown",
    })

    return false
  }
}

export interface AddSuppressionResult {
  ok: boolean
  /** How many times this address has now been suppressed, when the write worked. */
  events: number | null
}

/**
 * Put an address on the list.
 *
 * Never throws: the caller is a webhook that must answer 200 whatever happens,
 * because a 5xx makes Brevo retry the event, and a retry of "this address
 * complained" does not become truer the second time. A failed write is logged
 * without the address and reported in the result.
 */
export async function addSuppression(
  address: string,
  reason: SuppressionReason,
  source: string,
  store: SuppressionStore = supabaseSuppressionStore(),
): Promise<AddSuppressionResult> {
  let hash: string

  try {
    hash = hashRecipient(address)
  } catch (error) {
    logger.error("email_suppression_write_failed", {
      reason,
      detail: error instanceof Error ? error.message : "unknown",
    })

    return { ok: false, events: null }
  }

  // The column is 60 characters; the cut is here rather than in the store so it
  // holds for every store, including a test's.
  const trimmedSource = source.trim().slice(0, MAX_SUPPRESSION_SOURCE_LENGTH)

  try {
    const events = await store.add(hash, reason, trimmedSource)

    logger.warn("email_suppressed", { reason, source: trimmedSource, events })

    return { ok: true, events }
  } catch (error) {
    logger.error("email_suppression_write_failed", {
      reason,
      detail: error instanceof Error ? error.message : "unknown",
    })

    return { ok: false, events: null }
  }
}

// ---------------------------------------------------------------------------
// Reading the overview
//
// email_suppression_overview() answers with jsonb: { total, by_reason, recent }.
// The answer crosses the network, so every field is checked before it is used
// and a malformed one becomes a zero rather than a crash. There is no address in
// the payload, by construction: the table has no address column.
// ---------------------------------------------------------------------------

export interface EmailSuppressionSummary {
  /** One count per reason, zeros included, in the order of SUPPRESSION_REASONS. */
  byReason: Readonly<Record<SuppressionReason, number>>
  total: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

/** The counts the Security page shows, from the function that owns the rules. */
export async function getEmailSuppressionSummary(actorId: string): Promise<EmailSuppressionSummary> {
  const { data, error } = await getSupabaseAdminClient().rpc("email_suppression_overview", {
    p_actor: actorId,
  })

  if (error !== null) {
    throw new Error("Could not read the email suppression list")
  }

  const source = isRecord(data) ? data : {}
  const raw = isRecord(source.by_reason) ? source.by_reason : {}

  const byReason = Object.fromEntries(
    SUPPRESSION_REASONS.map((reason) => [reason, readCount(raw[reason])]),
  ) as Record<SuppressionReason, number>

  return { total: readCount(source.total), byReason }
}
