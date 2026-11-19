"use server"

import { webhookEventCounts } from "@/lib/commerce/db"
import { getPaystackEnv, type PaystackMode } from "@/lib/env"
import { logger } from "@/lib/logger"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { catalogErrorMessage, GENERIC_ERROR } from "@/lib/catalog/errors"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import {
  getScannerHealth,
  runScannerSelfTest,
} from "@/lib/ops/scanner-selftest"
import type { ScannerHealth, SelfTestRow } from "@/lib/ops/scanner-selftest"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The two actions behind the admin Security page.
//
// Both read through the service role and neither accepts an argument that names
// a row: the page shows counts and verdicts, so there is nothing to point at.
//
//   getSecurityOverviewAction  admin or moderator. Reads the scanner's health and
//                              the three overview functions.
//   runScannerSelfTestAction   admin only, five an hour, audited. Uploads four
//                              known files, asks the scanner about them, deletes
//                              them and reports the four verdicts.

// A "use server" module may only export async functions, so these lists stay
// private and the page keeps its own labels. They are the order the pipeline
// moves through, which is the order the page renders.

/** The scan statuses, in the order the pipeline moves through them. */
const SCAN_STATUSES = [
  "not_scanned",
  "queued",
  "scanning",
  "clean",
  "infected",
  "rejected",
  "needs_review",
  "error",
] as const

/** The job statuses the queue can hold. */
const JOB_STATUSES = ["queued", "running", "done", "failed", "dead"] as const

export interface ScanOverview {
  /** One count per scan status. Every status is present, zeros included. */
  counts: Readonly<Record<string, number>>
  oldestQueuedMinutes: number | null
  scansLast24h: number
  infectedLast30d: number
}

export interface JobHeartbeat {
  job: string
  lastRunAt: string
  lastStatus: string | null
  lastDurationMs: number | null
  ageSeconds: number
}

export interface JobOverview {
  counts: Readonly<Record<string, number>>
  oldestQueuedMinutes: number | null
  deadCount: number
  heartbeats: readonly JobHeartbeat[]
}

export interface ScanEventRow {
  verdict: string
  detail: string | null
  engine: string | null
  signatureVersion: string | null
  createdAt: string
}

export interface PaymentOverview {
  /** test, live, invalid, or unconfigured when no secret key is set at all. */
  mode: PaystackMode | "unconfigured"
  /** Webhook deliveries in the last 24 hours, one count per status. */
  webhookEvents: Readonly<Record<string, number>>
  windowHours: number
}

export interface SecurityOverview {
  scanner: ScannerHealth
  scan: ScanOverview
  jobs: JobOverview
  events: readonly ScanEventRow[]
  payments: PaymentOverview
  /** The server's clock, so the page can say how old a heartbeat is. */
  fetchedAt: string
}

export type SecurityOverviewResult =
  | { ok: true; overview: SecurityOverview }
  | { ok: false; error: string }

export type SelfTestActionResult =
  | {
      ok: true
      rows: readonly SelfTestRow[]
      health: ScannerHealth
      passedCount: number
      failedCount: number
    }
  | { ok: false; error: string }

/** Five self-tests an hour per person: enough to prove it works, not enough to load the service. */
const SELF_TEST_HOURLY_LIMIT = 5

const SELF_TEST_WINDOW_SECONDS = 60 * 60

// ---------------------------------------------------------------------------
// Reading the database answers
//
// The RPC results arrive as unknown: they cross the network and come from an
// untyped call. Every field is checked before it is used, and a missing or
// malformed field becomes a zero or a null rather than a crash. The page can
// then still render the parts that did work.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function readCounts(value: unknown, keys: readonly string[]): Record<string, number> {
  const source = isRecord(value) ? value : {}
  const counts: Record<string, number> = {}

  for (const key of keys) {
    counts[key] = readCount(source[key])
  }

  return counts
}

function toScanOverview(value: unknown): ScanOverview {
  const source = isRecord(value) ? value : {}

  return {
    counts: readCounts(source.counts, SCAN_STATUSES),
    oldestQueuedMinutes: readNumberOrNull(source.oldest_queued_minutes),
    scansLast24h: readCount(source.scans_last_24h),
    infectedLast30d: readCount(source.infected_last_30d),
  }
}

function toHeartbeat(value: unknown): JobHeartbeat | null {
  if (!isRecord(value)) {
    return null
  }

  const job = readString(value.job)
  const lastRunAt = readString(value.last_run_at)

  if (job === null || lastRunAt === null) {
    return null
  }

  return {
    job,
    lastRunAt,
    lastStatus: readString(value.last_status),
    lastDurationMs: readNumberOrNull(value.last_duration_ms),
    ageSeconds: readCount(value.age_seconds),
  }
}

function toJobOverview(value: unknown): JobOverview {
  const source = isRecord(value) ? value : {}
  const rawHeartbeats = Array.isArray(source.heartbeats) ? source.heartbeats : []
  const heartbeats = rawHeartbeats
    .map(toHeartbeat)
    .filter((entry): entry is JobHeartbeat => entry !== null)

  return {
    counts: readCounts(source.counts, JOB_STATUSES),
    oldestQueuedMinutes: readNumberOrNull(source.oldest_queued_minutes),
    deadCount: readCount(source.dead_count),
    heartbeats,
  }
}

function toScanEvent(value: unknown): ScanEventRow | null {
  if (!isRecord(value)) {
    return null
  }

  const verdict = readString(value.verdict)
  const createdAt = readString(value.created_at)

  if (verdict === null || createdAt === null) {
    return null
  }

  return {
    verdict,
    detail: readString(value.detail),
    engine: readString(value.engine),
    signatureVersion: readString(value.signature_version),
    createdAt,
  }
}

function toScanEvents(value: unknown): ScanEventRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(toScanEvent)
    .filter((entry): entry is ScanEventRow => entry !== null)
}

// ---------------------------------------------------------------------------
// Who is calling
// ---------------------------------------------------------------------------

type OpsActor = { userId: string; roles: AppRole[] }

type OpsGuard = { ok: true; actor: OpsActor } | { ok: false; error: string }

/**
 * The signed-in user, if they hold `action`.
 *
 * On top of the permission table this also insists on one of `onlyRoles`, which
 * is how the page keeps finance and support out: they hold area:admin so they can
 * see the admin shell, but the scanner controls are not theirs.
 */
async function requireOpsActor(action: "area:admin" | "roles:grant", onlyRoles?: readonly AppRole[]): Promise<OpsGuard> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: catalogErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: catalogErrorMessage("forbidden") }
  }

  if (onlyRoles !== undefined && !roles.some((role) => onlyRoles.includes(role))) {
    return { ok: false, error: catalogErrorMessage("forbidden") }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const WEBHOOK_STATUSES = ["received", "processed", "ignored", "failed"] as const

const WEBHOOK_WINDOW_HOURS = 24

/** The mode the deployment is in, or "unconfigured" when there is no key. */
function paystackMode(): PaystackMode | "unconfigured" {
  try {
    return getPaystackEnv().mode
  } catch {
    return "unconfigured"
  }
}

/**
 * The Paystack half of the page: which mode this deployment is pointed at, and
 * how the webhook deliveries of the last day ended.
 *
 * A missing key is a state, not an error: the page still renders, and it says so.
 * A missing webhook_events table (the migration not applied yet) reads as zeros.
 */
async function paymentOverview(): Promise<PaymentOverview> {
  const since = new Date(Date.now() - WEBHOOK_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  let counts: Record<string, number> = {}

  try {
    const answer = await webhookEventCounts(since)
    counts = answer
  } catch {
    logger.error("ops_webhook_counts_failed", {})
  }

  const webhookEvents: Record<string, number> = {}

  for (const status of WEBHOOK_STATUSES) {
    webhookEvents[status] = readCount(counts[status])
  }

  return {
    mode: paystackMode(),
    webhookEvents,
    windowHours: WEBHOOK_WINDOW_HOURS,
  }
}

// ---------------------------------------------------------------------------
// getSecurityOverviewAction
// ---------------------------------------------------------------------------

/**
 * Everything the Security page shows above the button: the scanner's health, the
 * scan pipeline, the background queue and the latest verdicts.
 *
 * The scanner is asked first and its failure is not fatal: a page that says
 * "scanner unreachable" next to the queue counts is more useful than an error
 * page, and the two halves fail independently.
 */
export async function getSecurityOverviewAction(): Promise<SecurityOverviewResult> {
  const guard = await requireOpsActor("area:admin", ["admin", "moderator"])

  if (!guard.ok) {
    return guard
  }

  try {
    const supabase = getSupabaseAdminClient()

    const [health, scanAnswer, jobAnswer, eventAnswer, payments] = await Promise.all([
      getScannerHealth(),
      supabase.rpc("scan_overview"),
      supabase.rpc("job_overview"),
      supabase.rpc("list_recent_scan_events", { p_limit: 20 }),
      paymentOverview(),
    ])

    if (scanAnswer.error !== null || jobAnswer.error !== null || eventAnswer.error !== null) {
      logger.error("ops_overview_read_failed", {
        scan: scanAnswer.error !== null,
        jobs: jobAnswer.error !== null,
        events: eventAnswer.error !== null,
      })

      return { ok: false, error: GENERIC_ERROR }
    }

    return {
      ok: true,
      overview: {
        scanner: health,
        scan: toScanOverview(scanAnswer.data),
        jobs: toJobOverview(jobAnswer.data),
        events: toScanEvents(eventAnswer.data),
        payments,
        fetchedAt: new Date().toISOString(),
      },
    }
  } catch (error) {
    logger.error("ops_overview_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    })

    return { ok: false, error: GENERIC_ERROR }
  }
}

// ---------------------------------------------------------------------------
// runScannerSelfTestAction
// ---------------------------------------------------------------------------

/**
 * Run the self-test: four files through the real pipeline, and the verdicts.
 *
 * Admin only, because it writes to the bucket and calls the scanner. Five an
 * hour, counted in Postgres so every instance shares the count, and the limiter
 * denies rather than allows when it cannot count: this is the expensive route.
 *
 * The audit row records the counts and nothing else. No sample names, no
 * verdicts per file, no URLs: the run is over in a second and the page shows the
 * detail anyway.
 */
export async function runScannerSelfTestAction(): Promise<SelfTestActionResult> {
  const guard = await requireOpsActor("roles:grant", ["admin"])

  if (!guard.ok) {
    return guard
  }

  const limit = await rateLimit({
    key: rateLimitKey(["ops", "scanner-selftest", guard.actor.userId]),
    limit: SELF_TEST_HOURLY_LIMIT,
    windowSeconds: SELF_TEST_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!limit.allowed) {
    return { ok: false, error: catalogErrorMessage("rate_limited") }
  }

  try {
    const result = await runScannerSelfTest()

    // The audit row is written after the run, so it records what happened rather
    // than what was attempted. A failure to write it is logged and does not hide
    // the result: the operator asked for the verdicts, and they are real.
    const { error } = await getSupabaseAdminClient()
      .from("audit_log")
      .insert({
        actor_id: guard.actor.userId,
        action: "ops.scanner_selftest",
        entity_type: "scanner",
        entity_id: "selftest",
        after: {
          passed: result.passedCount,
          failed: result.failedCount,
          total: result.rows.length,
        },
      })

    if (error !== null) {
      logger.error("ops_selftest_audit_failed", { reason: error.code ?? "unknown" })
    }

    return {
      ok: true,
      rows: result.rows,
      health: result.health,
      passedCount: result.passedCount,
      failedCount: result.failedCount,
    }
  } catch (error) {
    logger.error("ops_selftest_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    })

    return { ok: false, error: GENERIC_ERROR }
  }
}
