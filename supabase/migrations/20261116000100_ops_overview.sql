-- ============================================================================
-- Migration 20261116000100_ops_overview
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  three read-only functions for the admin Security page: the scan
--         pipeline overview, the background job overview and the recent scan
--         event log.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000200_job_queue.sql (jobs, cron_heartbeats) and
-- 20261115000100_malware_scanning.sql (product_files scan columns,
-- file_scan_events).
--
-- These functions only read. They exist so the page does not have to count rows
-- in the browser or hold a service role query of its own, and so the definition
-- of "oldest queued" and "dead job" lives in one place.
--
-- Rules that hold everywhere below:
--   * every function is SECURITY DEFINER with an empty search_path, so every
--     name inside is schema qualified;
--   * EXECUTE is revoked from PUBLIC, anon and authenticated and granted to
--     service_role only, so no client can call them;
--   * no function returns a file name, an email address or a vendor identity.
--     The log is for operators counting verdicts, not for reading who uploaded
--     what: file ids and vendor ids stay out of the answer.
--   * a missing table is not possible here (both dependencies are earlier
--     migrations), but an empty table is: every function answers with zeros or
--     nulls rather than no row, so the page never has to handle a null result.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.scan_overview()
--    How the scan pipeline looks right now.
--
--    counts:               one key per scan_status, always all eight, zeros
--                          included, so the page renders a stable list.
--    oldest_queued_minutes: how long the oldest queued or scanning file has
--                          been waiting. null when nothing is waiting.
--    scans_last_24h:       scan answers received in the last day.
--    infected_last_30d:    infected verdicts in the last thirty days.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH statuses (scan_status) AS (
    VALUES
      ('not_scanned'), ('queued'), ('scanning'), ('clean'),
      ('infected'), ('rejected'), ('needs_review'), ('error')
  ),
  counted AS (
    SELECT pf.scan_status, pg_catalog.count(*)::int AS n
    FROM public.product_files pf
    GROUP BY pf.scan_status
  )
  SELECT pg_catalog.jsonb_build_object(
    'counts',
    (
      SELECT pg_catalog.jsonb_object_agg(s.scan_status, COALESCE(c.n, 0))
      FROM statuses s
      LEFT JOIN counted c ON c.scan_status = s.scan_status
    ),
    'oldest_queued_minutes',
    (
      SELECT pg_catalog.round(
               extract(EPOCH FROM (pg_catalog.now() - pg_catalog.min(
                 COALESCE(pf.scan_requested_at, pf.created_at)
               ))) / 60.0,
               1
             )
      FROM public.product_files pf
      WHERE pf.scan_status IN ('queued', 'scanning')
    ),
    'scans_last_24h',
    (
      SELECT pg_catalog.count(*)::int
      FROM public.file_scan_events e
      WHERE e.created_at > pg_catalog.now() - INTERVAL '24 hours'
    ),
    'infected_last_30d',
    (
      SELECT pg_catalog.count(*)::int
      FROM public.file_scan_events e
      WHERE e.verdict = 'infected'
        AND e.created_at > pg_catalog.now() - INTERVAL '30 days'
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. public.job_overview()
--    The background queue, plus one heartbeat row per cron job.
--
--    counts:               one key per job status, zeros included.
--    oldest_queued_minutes: age of the oldest job still queued.
--    dead_count:           jobs that gave up. Not zero is a call to look.
--    heartbeats:           one row per job that has ever recorded a run, with
--                          its age in seconds, so the page can say which
--                          schedule is late without trusting the browser clock.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH statuses (job_status) AS (
    VALUES ('queued'), ('running'), ('done'), ('failed'), ('dead')
  ),
  counted AS (
    SELECT j.status, pg_catalog.count(*)::int AS n
    FROM public.jobs j
    GROUP BY j.status
  )
  SELECT pg_catalog.jsonb_build_object(
    'counts',
    (
      SELECT pg_catalog.jsonb_object_agg(s.job_status, COALESCE(c.n, 0))
      FROM statuses s
      LEFT JOIN counted c ON c.status = s.job_status
    ),
    'oldest_queued_minutes',
    (
      SELECT pg_catalog.round(
               extract(EPOCH FROM (pg_catalog.now() - pg_catalog.min(j.run_at))) / 60.0,
               1
             )
      FROM public.jobs j
      WHERE j.status = 'queued'
    ),
    'dead_count',
    (
      SELECT pg_catalog.count(*)::int
      FROM public.jobs j
      WHERE j.status = 'dead'
    ),
    'heartbeats',
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'job', h.job,
                   'last_run_at', h.last_run_at,
                   'last_status', h.last_status,
                   'last_duration_ms', h.last_duration_ms,
                   'age_seconds', pg_catalog.round(extract(EPOCH FROM (pg_catalog.now() - h.last_run_at)))::int
                 )
                 ORDER BY h.job
               )
        FROM public.cron_heartbeats h
      ),
      '[]'::jsonb
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. public.list_recent_scan_events(p_limit int default 20)
--    The latest scanner answers, newest first.
--
--    Deliberately no file_id and no vendor: an operator needs to know that a
--    verdict arrived and what it said, not whose file it was. p_limit is
--    clamped to 1..100 so a caller cannot ask for the whole log.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recent_scan_events(p_limit integer DEFAULT 20)
RETURNS TABLE (
  verdict           text,
  detail            text,
  engine            text,
  signature_version text,
  created_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    e.verdict,
    e.detail,
    e.engine,
    e.signature_version,
    e.created_at
  FROM public.file_scan_events e
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

-- ----------------------------------------------------------------------------
-- 4. Privileges
--    Functions are executable by PUBLIC by default, so PUBLIC has to be named
--    explicitly. Nothing here is for a client: the page calls these through the
--    server action, which uses the service role.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.scan_overview() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_overview() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_recent_scan_events(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.scan_overview() TO service_role;
GRANT EXECUTE ON FUNCTION public.job_overview() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_recent_scan_events(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261116000100', 'ops_overview')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- The three functions are read-only and nothing else depends on them, so the
-- rollback is a drop and nothing else. Dropping them cannot lose data: they
-- own no table and write nothing. The admin Security page would then show its
-- "could not read the overview" state until the migration is applied again.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.list_recent_scan_events(integer);
-- DROP FUNCTION IF EXISTS public.job_overview();
-- DROP FUNCTION IF EXISTS public.scan_overview();
--
-- DELETE FROM public.app_migrations WHERE version = '20261116000100';
--
-- COMMIT;
-- ============================================================================
