// Shape of a row in public.jobs, as created by
// supabase/migrations/20261112000200_job_queue.sql.

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead"

export type JobPayload = Record<string, unknown>

export type Job = {
  id: string
  type: string
  payload: JobPayload
  status: JobStatus
  attempts: number
  max_attempts: number
  run_at: string
  locked_at: string | null
  last_error: string | null
  dedupe_key: string | null
  created_at: string
  updated_at: string
}
