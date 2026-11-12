-- ============================================================================
-- Verification for migration 20261112000200_job_queue
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql and
-- 20261112000200_job_queue.sql have been applied to the same project. Every
-- statement returns a check_name and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. Both tables exist in public.
SELECT
  'tables_exist' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('jobs', 'cron_heartbeats')
  ) AS passed;

-- 2. Row level security is enabled on both tables.
SELECT
  'rls_enabled_every_table' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('jobs', 'cron_heartbeats')
      AND c.relrowsecurity
  ) AS passed;

-- 3. The jobs status constraint exists and allows exactly the five statuses.
SELECT
  'jobs_status_check' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'jobs'
      AND c.conname = 'jobs_status_check'
      AND c.contype = 'c'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['queued', 'running', 'done', 'failed', 'dead']) AS s(label)
        WHERE pg_get_constraintdef(c.oid) NOT LIKE '%' || quote_literal(s.label) || '%'
      )
  ) AS passed;

-- 4. The partial index used by the claim query exists.
SELECT
  'jobs_queued_run_at_index' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'jobs'
      AND indexname = 'jobs_queued_run_at_idx'
      AND indexdef LIKE '%(run_at)%'
      AND indexdef LIKE '%WHERE%queued%'
  ) AS passed;

-- 5. dedupe_key is unique among non-null values.
SELECT
  'jobs_dedupe_key_unique_index' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'jobs'
      AND indexname = 'jobs_dedupe_key_idx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      AND indexdef LIKE '%WHERE%dedupe_key IS NOT NULL%'
  ) AS passed;

-- 6. The monitoring index on (status, updated_at) exists.
SELECT
  'jobs_status_updated_at_index' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'jobs'
      AND indexname = 'jobs_status_updated_at_idx'
      AND indexdef LIKE '%(status, updated_at)%'
  ) AS passed;

-- 7. jobs.updated_at is maintained by the shared trigger.
SELECT
  'jobs_updated_at_trigger' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'jobs'
      AND NOT tg.tgisinternal
      AND tg.tgname = 'jobs_set_updated_at'
  ) AS passed;

-- 8. cron_heartbeats is keyed by the job name.
SELECT
  'cron_heartbeats_primary_key' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'cron_heartbeats'
      AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (job)'
  ) AS passed;

-- 9. All six queue functions exist, are SECURITY DEFINER and pin search_path
--    to an empty string (so every name inside must be schema qualified).
SELECT
  'queue_functions_security_definer' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'enqueue_job', 'claim_jobs', 'complete_job',
        'fail_job', 'release_job', 'record_heartbeat'
      )
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 10. The service role can call all six functions.
SELECT
  'queue_functions_service_role_can_execute' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'enqueue_job', 'claim_jobs', 'complete_job',
        'fail_job', 'release_job', 'record_heartbeat'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 11. No client role can call any of them.
SELECT
  'queue_functions_closed_to_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'enqueue_job', 'claim_jobs', 'complete_job',
        'fail_job', 'release_job', 'record_heartbeat'
      )
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) AS passed;

-- 12. The service role holds full table privileges on both tables.
SELECT
  'service_role_full_table_privileges' AS check_name,
  (
    SELECT bool_and(has_table_privilege('service_role', format('public.%I', t.tbl), p.priv))
    FROM (VALUES ('jobs'), ('cron_heartbeats')) AS t(tbl)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  ) AS passed;

-- 13. authenticated may only read, and only on both tables.
SELECT
  'authenticated_read_only' AS check_name,
  has_table_privilege('authenticated', 'public.jobs', 'SELECT')
  AND has_table_privilege('authenticated', 'public.cron_heartbeats', 'SELECT')
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES ('jobs'), ('cron_heartbeats')) AS t(tbl)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
    WHERE has_table_privilege('authenticated', format('public.%I', t.tbl), p.priv)
  ) AS passed;

-- 14. anon has no table or column privileges at all.
SELECT
  'anon_has_no_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('jobs'), ('cron_heartbeats')) AS t(tbl)
    CROSS JOIN (VALUES
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS p(priv)
    WHERE has_table_privilege('anon', format('public.%I', t.tbl), p.priv)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.column_privileges cp
    WHERE cp.grantee = 'anon'
      AND cp.table_schema = 'public'
      AND cp.table_name IN ('jobs', 'cron_heartbeats')
  ) AS passed;

-- 15. Exactly one policy per table, SELECT only, staff only.
SELECT
  'staff_read_policies_only' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('jobs', 'cron_heartbeats')
      AND policyname IN ('jobs_select_staff', 'cron_heartbeats_select_staff')
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%is_staff%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('jobs', 'cron_heartbeats')
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) AS passed;

-- 16. The migration is recorded in the ledger.
SELECT
  'app_migrations_has_version' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261112000200' AND name = 'job_queue'
  ) AS passed;
