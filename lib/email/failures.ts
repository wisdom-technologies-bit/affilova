import "server-only"

import type { EmailFailureRecord } from "@/lib/email/reasons"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The failures table, written and read from the server only.
//
// One row per message that was finally given up on, and nothing else: a template
// name, the provider's status, a reason from lib/email/reasons.ts and the time.
// No address, no subject, no body, no provider message. That is what makes the
// table safe to read from an admin screen and to keep for thirty days.
//
// The write goes through record_email_failure(), which is the only way in: the
// table has row level security on and the client roles have no grant at all.

/** The columns the function cuts to, mirrored here so the value is never sent whole. */
export const MAX_TEMPLATE_LENGTH = 60
export const MAX_REASON_LENGTH = 40

function cut(value: string, max: number): string {
  return value.slice(0, max)
}

/**
 * Record one final failure.
 *
 * Throws when the write fails, on purpose: the caller in lib/email/brevo.ts is
 * the one place that knows a diagnostics row must never fail a send, and it
 * swallows both a rejection and a slow answer. Keeping the throw here means a
 * test can prove that swallowing happens.
 */
export async function recordEmailFailure(failure: EmailFailureRecord): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("record_email_failure", {
    p_template: cut(failure.template, MAX_TEMPLATE_LENGTH),
    p_status: failure.status ?? 0,
    p_reason: cut(failure.reason, MAX_REASON_LENGTH),
  })

  if (error !== null) {
    throw new Error("Could not record the email failure")
  }
}

// ---------------------------------------------------------------------------
// Reading the overview
//
// email_failure_overview() answers with jsonb: { last_24h: { total, by_reason },
// recent: [ ... ] }. The answer crosses the network, so every field is checked
// before it is used and a malformed one becomes a zero or a null. The page can
// then still render the parts that did arrive.
// ---------------------------------------------------------------------------

export interface EmailFailureSummary {
  total: number
  /** One count per reason, zeros included, in the order of EMAIL_FAILURE_REASONS. */
  byReason: Readonly<Record<string, number>>
}

export interface EmailFailureRow {
  template: string
  status: number
  reason: string
  createdAt: string
}

export interface EmailFailureOverview {
  last24h: EmailFailureSummary
  /** The last ten failures, newest first. */
  recent: readonly EmailFailureRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function toRow(value: unknown): EmailFailureRow | null {
  if (!isRecord(value)) {
    return null
  }

  const template = readString(value.template)
  const reason = readString(value.reason)
  const createdAt = readString(value.created_at)

  if (template === null || reason === null || createdAt === null) {
    return null
  }

  return { template, status: readCount(value.status), reason, createdAt }
}

/** The overview for the Security page, from the function that owns the rules. */
export async function getEmailFailureOverview(
  actorId: string,
  reasons: readonly string[],
): Promise<EmailFailureOverview> {
  const { data, error } = await getSupabaseAdminClient().rpc("email_failure_overview", {
    p_actor: actorId,
  })

  if (error !== null) {
    throw new Error("Could not read the email failures")
  }

  const source = isRecord(data) ? data : {}
  const window = isRecord(source.last_24h) ? source.last_24h : {}
  const rawByReason = isRecord(window.by_reason) ? window.by_reason : {}
  const rawRecent = Array.isArray(source.recent) ? source.recent : []

  const byReason: Record<string, number> = {}

  for (const reason of reasons) {
    byReason[reason] = readCount(rawByReason[reason])
  }

  return {
    last24h: { total: readCount(window.total), byReason },
    recent: rawRecent.map(toRow).filter((row): row is EmailFailureRow => row !== null),
  }
}
