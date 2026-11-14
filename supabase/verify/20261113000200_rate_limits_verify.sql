-- ============================================================================
-- Verification for migration 20261113000200_rate_limits
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql and
-- 20261113000200_rate_limits.sql have been applied to the same project. Every
-- statement returns a check_name and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The table exists in public.
SELECT
  'table_exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'rate_limits'
  ) AS passed;

-- 2. The three columns exist, with the documented types and nullability, and
--    hits defaults to 0.
SELECT
  'columns_exact' AS check_name,
  (
    SELECT count(*) = 3
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rate_limits'
      AND (
        (column_name = 'key'
          AND data_type = 'text'
          AND is_nullable = 'NO'
          AND column_default IS NULL)
        OR (column_name = 'window_start'
          AND data_type = 'timestamp with time zone'
          AND is_nullable = 'NO'
          AND column_default IS NULL)
        OR (column_name = 'hits'
          AND data_type = 'integer'
          AND is_nullable = 'NO'
          AND column_default = '0')
      )
  ) AS passed;

-- 3. The primary key is exactly (key, window_start), which is also the upsert
--    conflict target the function relies on.
SELECT
  'primary_key' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'rate_limits'
      AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (key, window_start)'
  ) AS passed;

-- 4. A counter can never go negative.
SELECT
  'hits_non_negative_check' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'rate_limits'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%hits >= 0%'
  ) AS passed;

-- 5. The cleanup index on window_start exists.
SELECT
  'cleanup_index' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'rate_limits'
      AND indexname = 'rate_limits_window_start_idx'
      AND indexdef LIKE '%(window_start)%'
  ) AS passed;

-- 6. Row level security is enabled.
SELECT
  'rls_enabled' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'rate_limits'
      AND c.relrowsecurity
  ) AS passed;

-- 7. There is not a single policy on the table, so RLS denies everyone who is
--    not the owner or the service role.
SELECT
  'no_policies' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rate_limits'
  ) AS passed;

-- 8. Both functions exist, are SECURITY DEFINER and pin search_path to an empty
--    string, so every name inside them is schema qualified.
SELECT
  'functions_security_definer' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rate_limit_hit', 'cleanup_rate_limits')
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 9. rate_limit_hit returns exactly (allowed, remaining, reset_at) with the
--    documented types.
SELECT
  'rate_limit_hit_signature' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rate_limit_hit'
      AND p.pronargs = 3
      AND pg_get_function_result(p.oid) =
        'TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)'
  ) AS passed;

-- 10. cleanup_rate_limits takes no argument and returns int.
SELECT
  'cleanup_signature' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cleanup_rate_limits'
      AND p.pronargs = 0
      AND pg_get_function_result(p.oid) = 'integer'
  ) AS passed;

-- 11. The service role can call both functions.
SELECT
  'functions_service_role_can_execute' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rate_limit_hit', 'cleanup_rate_limits')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 12. No client role can call either function.
SELECT
  'functions_closed_to_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname IN ('rate_limit_hit', 'cleanup_rate_limits')
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) AS passed;

-- 13. The service role holds full table privileges.
SELECT
  'service_role_full_table_privileges' AS check_name,
  (
    SELECT bool_and(has_table_privilege('service_role', 'public.rate_limits', p.priv))
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  ) AS passed;

-- 14. Neither client role holds any table privilege.
SELECT
  'clients_have_no_table_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS r(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE has_table_privilege(r.role_name, 'public.rate_limits', p.priv)
  ) AS passed;

-- 15. The migration recorded itself.
SELECT
  'app_migrations_row' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261113000200'
      AND name = 'rate_limits'
  ) AS passed;
