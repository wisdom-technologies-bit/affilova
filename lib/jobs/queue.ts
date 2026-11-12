import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import type { Job, JobPayload } from "./types"

// Every failure leaves this module as a short, fixed message. Callers log it and
// nothing more, so database details never reach a response body.

function queueError(operation: string): Error {
  return new Error(`Job queue request failed: ${operation}`)
}

export type EnqueueJobInput = {
  type: string
  payload?: JobPayload
  /** ISO timestamp. Omit to run as soon as possible. */
  runAt?: string
  /** Only one live job exists per key: enqueuing the same key returns the same id. */
  dedupeKey?: string
  maxAttempts?: number
}

/** Insert a job and return its id, or the id of the job that already has the key. */
export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
  const { data, error } = await getSupabaseAdminClient().rpc("enqueue_job", {
    p_type: input.type,
    p_payload: input.payload ?? {},
    p_dedupe_key: input.dedupeKey ?? null,
    ...(input.runAt === undefined ? {} : { p_run_at: input.runAt }),
    ...(input.maxAttempts === undefined ? {} : { p_max_attempts: input.maxAttempts }),
  })

  if (error) {
    throw queueError("enqueue_job")
  }

  if (typeof data !== "string" || data === "") {
    throw queueError("enqueue_job")
  }

  return data
}

/**
 * Claim up to `batch` due jobs for this worker. The database caps the batch at
 * 50 and never hands the same job to two callers at once.
 */
export async function claimJobs(batch: number, lockTimeout?: string): Promise<Job[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("claim_jobs", {
    p_batch: batch,
    ...(lockTimeout === undefined ? {} : { p_lock_timeout: lockTimeout }),
  })

  if (error) {
    throw queueError("claim_jobs")
  }

  return (data ?? []) as Job[]
}

/** Mark a claimed job as finished. */
export async function completeJob(id: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("complete_job", { p_id: id })

  if (error) {
    throw queueError("complete_job")
  }
}

/**
 * Mark a claimed job as failed. The database decides what happens next: retry
 * with backoff, or 'dead' once the job is out of attempts.
 */
export async function failJob(id: string, errorText: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("fail_job", {
    p_id: id,
    p_error: errorText,
  })

  if (error) {
    throw queueError("fail_job")
  }
}

/** Put a claimed job that was never processed back in the queue. */
export async function releaseJob(id: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("release_job", { p_id: id })

  if (error) {
    throw queueError("release_job")
  }
}

/** Record that a scheduled endpoint ran, successfully or not. */
export async function recordHeartbeat(
  job: string,
  status: string,
  durationMs: number,
  errorText?: string | null,
): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("record_heartbeat", {
    p_job: job,
    p_status: status,
    p_duration_ms: Math.round(durationMs),
    p_error: errorText ?? null,
  })

  if (error) {
    throw queueError("record_heartbeat")
  }
}
