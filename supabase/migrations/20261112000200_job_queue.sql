-- ============================================================================
-- Migration 20261112000200_job_queue
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  background job queue (jobs) and cron run heartbeats (cron_heartbeats).
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql: public.app_migrations,
-- public.set_updated_at() and public.is_staff(uuid).
--
-- How jobs run: an external scheduler (cron-job.org) calls a secured app
-- endpoint once a minute. Each call is capped at 30 seconds, so a run claims a
-- small batch, processes what fits in its budget, and answers quickly. Every
-- function below is for server code only: clients never touch the queue.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.jobs
-- One row per unit of background work.
--   status  queued    waiting to be claimed
--           running   claimed by a worker, locked until locked_at + lock timeout
--           done      finished successfully
--           failed    reserved for a terminal failure that is not a retry
--           dead      out of attempts, will not be picked up again
-- attempts counts claims, so it is already incremented when a job runs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'queued',
  attempts     int         NOT NULL DEFAULT 0,
  max_attempts int         NOT NULL DEFAULT 8,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead'))
);

-- Claim path: only queued jobs are scanned, ordered by run_at.
CREATE INDEX IF NOT EXISTS jobs_queued_run_at_idx
  ON public.jobs (run_at)
  WHERE status = 'queued';

-- At most one live job per dedupe key. A partial unique index (rather than a
-- constraint) because most jobs carry no dedupe key at all.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_key_idx
  ON public.jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Monitoring path: "which jobs are stuck or old" filters on status, sorts on
-- updated_at.
CREATE INDEX IF NOT EXISTS jobs_status_updated_at_idx
  ON public.jobs (status, updated_at);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON public.jobs;
CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. public.cron_heartbeats
-- One row per scheduled endpoint, written on every run so a missing or stale
-- row means the schedule stopped. The alerting task reads this later.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job              text        PRIMARY KEY,
  last_run_at      timestamptz NOT NULL,
  last_status      text,
  last_duration_ms int,
  last_error       text
);

-- ----------------------------------------------------------------------------
-- 3. Queue functions
-- All are SECURITY DEFINER with an empty search_path, so every name inside is
-- schema qualified and a caller cannot redirect them by setting search_path.
-- EXECUTE is revoked from every client role and granted to service_role only.
-- ----------------------------------------------------------------------------

-- Insert a job, or return the existing job when the dedupe key is already used.
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_type         text,
  p_payload      jsonb       DEFAULT '{}',
  p_run_at       timestamptz DEFAULT now(),
  p_dedupe_key   text        DEFAULT NULL,
  p_max_attempts int         DEFAULT 8
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_type IS NULL OR p_type = '' THEN
    RAISE EXCEPTION 'enqueue_job: p_type must not be empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_dedupe_key IS NOT NULL THEN
    SELECT j.id INTO v_id
    FROM public.jobs j
    WHERE j.dedupe_key = p_dedupe_key;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.jobs (type, payload, run_at, dedupe_key, max_attempts)
    VALUES (
      p_type,
      COALESCE(p_payload, '{}'::jsonb),
      COALESCE(p_run_at, now()),
      p_dedupe_key,
      COALESCE(p_max_attempts, 8)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
  EXCEPTION
    -- Two callers raced with the same dedupe key: the loser returns the winner.
    WHEN unique_violation THEN
      IF p_dedupe_key IS NULL THEN
        RAISE;
      END IF;

      SELECT j.id INTO v_id
      FROM public.jobs j
      WHERE j.dedupe_key = p_dedupe_key;

      IF v_id IS NULL THEN
        RAISE;
      END IF;

      RETURN v_id;
  END;
END;
$$;

-- Claim up to p_batch jobs (never more than 50) for this worker.
-- 1. A job left 'running' past the lock timeout belonged to a worker that died
--    (or ran out of time), so it goes back to the queue.
-- 2. The batch is taken with FOR UPDATE SKIP LOCKED, so two workers calling at
--    the same moment never receive the same row.
CREATE OR REPLACE FUNCTION public.claim_jobs(
  p_batch        int,
  p_lock_timeout interval DEFAULT '5 minutes'
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.jobs j
     SET status    = 'queued',
         locked_at = NULL
   WHERE j.status = 'running'
     AND j.locked_at IS NOT NULL
     AND j.locked_at < now() - COALESCE(p_lock_timeout, interval '5 minutes');

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.status = 'queued'
      AND j.run_at <= now()
    ORDER BY j.run_at, j.created_at, j.id
    LIMIT GREATEST(LEAST(COALESCE(p_batch, 0), 50), 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs j
     SET status    = 'running',
         attempts  = j.attempts + 1,
         locked_at = now()
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

-- A claimed job finished successfully.
CREATE OR REPLACE FUNCTION public.complete_job(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.jobs j
     SET status    = 'done',
         locked_at = NULL
   WHERE j.id = p_id;
$$;

-- A claimed job threw, timed out or had no handler.
-- Attempts below max_attempts: back to the queue with exponential backoff
-- of 2, 4, 8, ... minutes, capped at 1440 (one day). At or past max_attempts:
-- 'dead', so it is never picked up again.
CREATE OR REPLACE FUNCTION public.fail_job(p_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.jobs j
     SET last_error = left(COALESCE(p_error, ''), 1000),
         status     = CASE
                        WHEN j.attempts >= j.max_attempts THEN 'dead'
                        ELSE 'queued'
                      END,
         -- Left untouched once a job is dead. The inner LEAST keeps
         -- power(2, attempts) inside int range; it changes no result because
         -- anything past 2^20 is already above the one day cap.
         run_at     = CASE
                        WHEN j.attempts >= j.max_attempts THEN j.run_at
                        ELSE now() + make_interval(
                          mins => LEAST(power(2, LEAST(j.attempts, 20))::int, 1440)
                        )
                      END,
         locked_at  = NULL
   WHERE j.id = p_id;
$$;

-- A claimed job that was never processed (no time budget left, or the worker is
-- shutting down). The claim is undone, including its attempts increment, and the
-- job returns to the queue for the next run.
CREATE OR REPLACE FUNCTION public.release_job(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.jobs j
     SET status    = 'queued',
         attempts  = GREATEST(j.attempts - 1, 0),
         locked_at = NULL
   WHERE j.id = p_id
     AND j.status = 'running';
$$;

-- Record that a scheduled endpoint ran. Upsert: one row per endpoint name.
CREATE OR REPLACE FUNCTION public.record_heartbeat(
  p_job         text,
  p_status      text,
  p_duration_ms int,
  p_error       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.cron_heartbeats (
    job, last_run_at, last_status, last_duration_ms, last_error
  )
  VALUES (p_job, now(), p_status, p_duration_ms, left(p_error, 1000))
  ON CONFLICT (job) DO UPDATE
    SET last_run_at      = now(),
        last_status      = excluded.last_status,
        last_duration_ms = excluded.last_duration_ms,
        last_error       = excluded.last_error;
END;
$$;

-- Nothing but the server role may call these.
REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, timestamptz, text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_jobs(int, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_job(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_job(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_heartbeat(text, text, int, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, timestamptz, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_jobs(int, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_heartbeat(text, text, int, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Row level security on both tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Privileges and policies
-- Pattern from the foundation migration: revoke everything from clients, then
-- grant only what is listed. Policies use (select auth.uid()) so the lookup is
-- evaluated once per query.
-- ----------------------------------------------------------------------------

-- jobs: staff may look at the queue. Only the service role writes it, through
-- the functions above; there is no client INSERT, UPDATE or DELETE at all.
REVOKE ALL ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobs TO authenticated;

DROP POLICY IF EXISTS jobs_select_staff ON public.jobs;
CREATE POLICY jobs_select_staff
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- cron_heartbeats: same rule, read only for staff.
REVOKE ALL ON TABLE public.cron_heartbeats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cron_heartbeats TO authenticated;

DROP POLICY IF EXISTS cron_heartbeats_select_staff ON public.cron_heartbeats;
CREATE POLICY cron_heartbeats_select_staff
  ON public.cron_heartbeats
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- ----------------------------------------------------------------------------
-- 6. Server role (service_role) privileges
-- Explicit, so they do not depend on Supabase's default privileges.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON TABLE
  public.jobs,
  public.cron_heartbeats
TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261112000200', 'job_queue')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops both tables and every job and heartbeat row in them.
-- Everything else from 20261112000100_foundation.sql, including the shared
-- public.set_updated_at() function, is left in place.
-- ============================================================================
--
-- Functions are dropped before the tables, because claim_jobs returns
-- SETOF public.jobs and the tables cannot be dropped while it still exists.
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS jobs_select_staff ON public.jobs;
-- DROP POLICY IF EXISTS cron_heartbeats_select_staff ON public.cron_heartbeats;
--
-- DROP FUNCTION IF EXISTS public.record_heartbeat(text, text, int, text);
-- DROP FUNCTION IF EXISTS public.release_job(uuid);
-- DROP FUNCTION IF EXISTS public.fail_job(uuid, text);
-- DROP FUNCTION IF EXISTS public.complete_job(uuid);
-- DROP FUNCTION IF EXISTS public.claim_jobs(int, interval);
-- DROP FUNCTION IF EXISTS public.enqueue_job(text, jsonb, timestamptz, text, int);
--
-- DROP TABLE IF EXISTS public.jobs;
-- DROP TABLE IF EXISTS public.cron_heartbeats;
--
-- DELETE FROM public.app_migrations WHERE version = '20261112000200';
--
-- COMMIT;
