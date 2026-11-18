-- ============================================================================
-- Verification for migration 20261116000100_ops_overview
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000200_job_queue.sql and
-- 20261115000100_malware_scanning.sql and 20261116000100_ops_overview.sql have
-- been applied to the same project. Every statement returns a check_name and a
-- boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The three functions exist with the expected signatures.
SELECT
  'functions_exist' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        (p.proname = 'scan_overview' AND p.pronargs = 0)
        OR (p.proname = 'job_overview' AND p.pronargs = 0)
        OR (p.proname = 'list_recent_scan_events' AND p.pronargs = 1)
      )
  ) AS passed;

-- 2. All three are SECURITY DEFINER. A caller without table privileges must
--    still be able to read through them, and a caller must not be able to
--    substitute their own search_path.
SELECT
  'functions_security_definer' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('scan_overview', 'job_overview', 'list_recent_scan_events')
      AND p.prosecdef
  ) AS passed;

-- 3. All three pin search_path to the empty string, so every name inside them
--    is schema qualified and nothing can be shadowed.
SELECT
  'functions_empty_search_path' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('scan_overview', 'job_overview', 'list_recent_scan_events')
      AND EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
        WHERE setting IN ('search_path=', 'search_path=""')
      )
  ) AS passed;

-- 4. No client role may execute them: not PUBLIC, not anon, not authenticated.
SELECT
  'functions_not_executable_by_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS client(role_name)
    WHERE n.nspname = 'public'
      AND p.proname IN ('scan_overview', 'job_overview', 'list_recent_scan_events')
      AND has_function_privilege(client.role_name, p.oid, 'EXECUTE')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('scan_overview', 'job_overview', 'list_recent_scan_events')
      AND EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
  ) AS passed;

-- 5. service_role may execute all three: the admin page reads them through the
--    service role client.
SELECT
  'functions_executable_by_service_role' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('scan_overview', 'job_overview', 'list_recent_scan_events')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 6. scan_overview() answers with the four keys the page reads, and counts
--    carries all eight scan statuses even when the table is empty.
SELECT
  'scan_overview_shape' AS check_name,
  (
    SELECT (o ? 'counts')
       AND (o ? 'oldest_queued_minutes')
       AND (o ? 'scans_last_24h')
       AND (o ? 'infected_last_30d')
       AND (SELECT count(*) = 8 FROM jsonb_object_keys(o -> 'counts'))
       AND (o -> 'counts') ? 'not_scanned'
       AND (o -> 'counts') ? 'needs_review'
    FROM (SELECT public.scan_overview() AS o) AS answer
  ) AS passed;

-- 7. job_overview() answers with the four keys the page reads, counts carries
--    all five job statuses, and heartbeats is always an array.
SELECT
  'job_overview_shape' AS check_name,
  (
    SELECT (o ? 'counts')
       AND (o ? 'oldest_queued_minutes')
       AND (o ? 'dead_count')
       AND (o ? 'heartbeats')
       AND (SELECT count(*) = 5 FROM jsonb_object_keys(o -> 'counts'))
       AND (o -> 'counts') ? 'dead'
       AND jsonb_typeof(o -> 'heartbeats') = 'array'
    FROM (SELECT public.job_overview() AS o) AS answer
  ) AS passed;

-- 8. Each heartbeat row carries the five fields the page renders, and never a
--    free-form error message.
SELECT
  'heartbeats_shape' AS check_name,
  (
    SELECT COALESCE(bool_and(
             (beat ? 'job')
         AND (beat ? 'last_run_at')
         AND (beat ? 'last_status')
         AND (beat ? 'last_duration_ms')
         AND (beat ? 'age_seconds')
         AND NOT (beat ? 'last_error')
           ), true)
    FROM public.job_overview() AS o
    CROSS JOIN LATERAL jsonb_array_elements(o -> 'heartbeats') AS beat
  ) AS passed;

-- 9. list_recent_scan_events() returns exactly the five columns the page reads
--    and no file or vendor identity: a caller cannot learn whose file was
--    scanned. The names are read from the function itself, because a set of OUT
--    parameters is not a table and does not appear in information_schema.
SELECT
  'scan_events_columns' AS check_name,
  (
    SELECT array_agg(arg.name ORDER BY arg.position)
           = ARRAY['verdict', 'detail', 'engine', 'signature_version', 'created_at']
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY
      AS arg(name, mode, position)
    WHERE n.nspname = 'public'
      AND p.proname = 'list_recent_scan_events'
      AND p.pronargs = 1
      -- 't' marks a table column; the p_limit input argument is not one.
      AND arg.mode = 't'
  ) AS passed;

-- 10. The default limit is 20 and the clamp holds: 0 becomes 1, a huge number
--     becomes 100. Read-only, so it is safe to call here.
SELECT
  'scan_events_limit_clamped' AS check_name,
  (
    (SELECT count(*) <= 1 FROM public.list_recent_scan_events(0))
    AND (SELECT count(*) <= 100 FROM public.list_recent_scan_events(1000000))
    AND (SELECT count(*) <= 20 FROM public.list_recent_scan_events())
  ) AS passed;

-- 11. The migration recorded itself.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261116000100'
      AND name = 'ops_overview'
  ) AS passed;
