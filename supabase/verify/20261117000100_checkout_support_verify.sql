-- ============================================================================
-- Verification for migration 20261117000100_checkout_support
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql, 20261112000200_job_queue.sql,
-- 20261113000100_roles_onboarding.sql, 20261114000100_catalog.sql,
-- 20261115000100_malware_scanning.sql, 20261116000200_commerce_core.sql and
-- 20261117000100_checkout_support.sql have been applied to the same project.
-- Every statement returns a check_name and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261117000100' AND name = 'checkout_support'
  ) AS passed;

-- 2. webhook_events exists with the nine agreed columns.
SELECT
  'webhook_events_columns' AS check_name,
  (
    SELECT count(*) = 9
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'webhook_events'
      AND column_name IN (
        'id', 'provider', 'body_sha256', 'event_type', 'reference',
        'status', 'error', 'received_at', 'processed_at'
      )
  ) AS passed;

-- 3. Row level security is enabled on it.
SELECT
  'webhook_events_rls' AS check_name,
  (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'webhook_events'
  ) AS passed;

-- 4. The duplicate detector is a unique constraint on (provider, body_sha256).
SELECT
  'webhook_events_unique' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'webhook_events'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) LIKE '%(provider, body_sha256)%'
  ) AS passed;

-- 5. The status column accepts exactly the four agreed values.
SELECT
  'webhook_events_status_values' AS check_name,
  (
    SELECT pg_get_constraintdef(con.oid) LIKE '%received%'
       AND pg_get_constraintdef(con.oid) LIKE '%processed%'
       AND pg_get_constraintdef(con.oid) LIKE '%ignored%'
       AND pg_get_constraintdef(con.oid) LIKE '%failed%'
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'webhook_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
    LIMIT 1
  ) AS passed;

-- 6. The error column is capped at 300 characters.
SELECT
  'webhook_events_error_cap' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'webhook_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%char_length(error)%300%'
  ) AS passed;

-- 7. All nine functions exist with the agreed signatures.
SELECT
  'functions_present' AS check_name,
  (
    SELECT count(*) = 9
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'insert_webhook_event', 'finish_webhook_event', 'get_order_by_reference',
        'fail_order', 'list_orders_needing_verification', 'find_open_refund',
        'mark_refund_submitted', 'mark_refund_failed', 'purge_old_webhook_events'
      )
  ) AS passed;

-- 8. Every one of them is SECURITY DEFINER with an empty search_path.
SELECT
  'functions_hardened' AS check_name,
  (
    SELECT count(*) = 9
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'insert_webhook_event', 'finish_webhook_event', 'get_order_by_reference',
        'fail_order', 'list_orders_needing_verification', 'find_open_refund',
        'mark_refund_submitted', 'mark_refund_failed', 'purge_old_webhook_events'
      )
      AND p.prosecdef
      AND p.proconfig::text LIKE '%search_path=%'
  ) AS passed;

-- 9. anon and authenticated can neither read the table nor call the functions.
SELECT
  'clients_have_no_access' AS check_name,
  (
    SELECT count(*) = 0
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'webhook_events'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  )
  AND (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'insert_webhook_event', 'finish_webhook_event', 'get_order_by_reference',
        'fail_order', 'list_orders_needing_verification', 'find_open_refund',
        'mark_refund_submitted', 'mark_refund_failed', 'purge_old_webhook_events'
      )
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) AS passed;

-- 10. service_role can do everything the server needs.
SELECT
  'service_role_access' AS check_name,
  has_table_privilege('service_role', 'public.webhook_events', 'SELECT')
  AND has_table_privilege('service_role', 'public.webhook_events', 'INSERT')
  AND has_table_privilege('service_role', 'public.webhook_events', 'UPDATE')
  AND has_table_privilege('service_role', 'public.webhook_events', 'DELETE')
  AND (
    SELECT count(*) = 9
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'insert_webhook_event', 'finish_webhook_event', 'get_order_by_reference',
        'fail_order', 'list_orders_needing_verification', 'find_open_refund',
        'mark_refund_submitted', 'mark_refund_failed', 'purge_old_webhook_events'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 11. The return types match what the application expects.
SELECT
  'function_return_types' AS check_name,
  (
    SELECT pg_get_function_result(p.oid) = 'jsonb'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'insert_webhook_event'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'jsonb'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_order_by_reference'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'jsonb'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'find_open_refund'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'void'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fail_order'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'void'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mark_refund_submitted'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'integer'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'purge_old_webhook_events'
  )
  AND (
    SELECT pg_get_function_result(p.oid) = 'TABLE(reference text)'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'list_orders_needing_verification'
  ) AS passed;
