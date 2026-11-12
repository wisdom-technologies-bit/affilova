import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/env"
import { isValidCronSecret } from "@/lib/jobs/cron-auth"
import { getHandler } from "@/lib/jobs/handlers"
import {
  claimJobs,
  completeJob,
  failJob,
  recordHeartbeat,
  releaseJob,
} from "@/lib/jobs/queue"
import { runProcessQueue } from "@/lib/jobs/runner"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// Called by an external scheduler, never by a browser: no caching, and the
// function answers inside the 30 second limit of the caller.
export const dynamic = "force-dynamic"
export const maxDuration = 25

const PROCESS_QUEUE_JOB = "process-queue"
const HEARTBEAT_CHECK_JOB = "heartbeat-check"

// The endpoint only accepts these names, and these are the schedules whose
// heartbeats are watched.
const EXPECTED_JOBS = [PROCESS_QUEUE_JOB, HEARTBEAT_CHECK_JOB]

// process-queue runs every minute; anything older than this is overdue.
const STALE_AFTER_MS = 5 * 60 * 1000

const MAX_HEARTBEAT_ERROR_LENGTH = 200

type RouteContext = { params: Promise<{ job: string }> }

type HeartbeatRow = { job: string; last_run_at: string }

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function shortMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim().slice(0, MAX_HEARTBEAT_ERROR_LENGTH)
  }

  return "unexpected error"
}

// A heartbeat write must never replace the real answer, so a failure here is
// swallowed: the response is already being built.
async function recordHeartbeatSafely(
  job: string,
  status: string,
  startedAt: number,
  errorText?: string,
): Promise<void> {
  try {
    await recordHeartbeat(job, status, Date.now() - startedAt, errorText ?? null)
  } catch {
    // Nothing useful left to do.
  }
}

// The schedules that have not reported in for more than five minutes, including
// the ones that have never reported at all.
async function staleJobs(): Promise<string[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("cron_heartbeats")
    .select("job, last_run_at")

  if (error) {
    throw new Error("Could not read cron heartbeats")
  }

  const rows = (data ?? []) as HeartbeatRow[]
  const now = Date.now()

  return EXPECTED_JOBS.filter((name) => {
    const row = rows.find((candidate) => candidate.job === name)

    if (!row) {
      return true
    }

    const lastRunAt = Date.parse(row.last_run_at)

    if (Number.isNaN(lastRunAt)) {
      return true
    }

    return now - lastRunAt > STALE_AFTER_MS
  })
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  // 1. The secret is checked before anything else, and a failure says nothing
  //    beyond "unauthorized".
  let expectedSecret: string

  try {
    expectedSecret = getServerEnv().CRON_SECRET
  } catch {
    return json({ error: "unauthorized" }, 401)
  }

  if (!isValidCronSecret(request.headers.get("authorization"), expectedSecret)) {
    return json({ error: "unauthorized" }, 401)
  }

  // 2. Only the two scheduled jobs exist.
  const { job } = await context.params

  if (job !== PROCESS_QUEUE_JOB && job !== HEARTBEAT_CHECK_JOB) {
    return json({ error: "not_found" }, 404)
  }

  const startedAt = Date.now()

  if (job === PROCESS_QUEUE_JOB) {
    try {
      // Per-job failures are counted by the runner, not thrown: a failed job is
      // still a successful run.
      const counts = await runProcessQueue({
        queue: { claimJobs, completeJob, failJob, releaseJob },
        handlers: { get: getHandler },
      })

      await recordHeartbeatSafely(PROCESS_QUEUE_JOB, "ok", startedAt)

      return json({ ok: true, ...counts }, 200)
    } catch (error) {
      await recordHeartbeatSafely(PROCESS_QUEUE_JOB, "error", startedAt, shortMessage(error))

      return json({ ok: false }, 500)
    }
  }

  try {
    const stale = await staleJobs()

    await recordHeartbeatSafely(HEARTBEAT_CHECK_JOB, "ok", startedAt)

    return json({ ok: true, stale }, 200)
  } catch (error) {
    await recordHeartbeatSafely(HEARTBEAT_CHECK_JOB, "error", startedAt, shortMessage(error))

    return json({ ok: false }, 500)
  }
}
