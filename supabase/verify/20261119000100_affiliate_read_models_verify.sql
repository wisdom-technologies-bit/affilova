-- ============================================================================
-- Verification for migration 20261119000100_affiliate_read_models
-- Read-only. No writes, no DDL.
--
-- Run this AFTER every earlier migration and
-- 20261119000100_affiliate_read_models.sql have been applied to the same
-- project. Every statement returns a check_name and a boolean passed. The
-- migration is only considered applied when every `passed` is true.
--
-- The behaviour (ownership isolation, the maths, cursor pagination, search and
-- sort, revoke permissions and index use) is covered by
-- supabase/tests/affiliate_read_models_test.sh, which needs a throwaway
-- database.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261119000100' AND name = 'affiliate_read_models'
  ) AS passed;

-- 2. All ten functions exist with their exact signatures.
SELECT
  'functions_exist' AS check_name,
  (
    SELECT count(*) = 10
    FROM (VALUES
      ('affiliate_marketplace', 'uuid, text, text, integer, text, integer, jsonb'),
      ('affiliate_overview', 'uuid, timestamp with time zone, timestamp with time zone'),
      ('affiliate_daily_series', 'uuid, date, date'),
      ('affiliate_link_stats', 'uuid, date, date, integer, jsonb'),
      ('affiliate_breakdown', 'uuid, date, date, text'),
      ('affiliate_commission_list', 'uuid, integer, jsonb'),
      ('vendor_affiliate_requests', 'uuid, text, uuid, integer, jsonb'),
      ('vendor_affiliate_stats', 'uuid, date, date, integer, jsonb'),
      ('vendor_invites', 'uuid'),
      ('revoke_affiliate_invite', 'uuid, uuid')
    ) AS f(name, args)
    WHERE to_regprocedure('public.' || f.name || '(' || f.args || ')') IS NOT NULL
  ) AS passed;

-- 3. Every function is SECURITY DEFINER.
SELECT
  'security_definer' AS check_name,
  (
    SELECT count(*) = 10
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites',
        'revoke_affiliate_invite'
      )
      AND p.prosecdef
  ) AS passed;

-- 4. Every function pins an empty search_path.
SELECT
  'empty_search_path' AS check_name,
  (
    SELECT count(*) = 10
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites',
        'revoke_affiliate_invite'
      )
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) AS passed;

-- 5. The nine read models are STABLE; only the revoke is VOLATILE.
SELECT
  'volatility' AS check_name,
  (
    SELECT count(*) = 9
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites'
      )
      AND p.provolatile = 's'
  )
  AND (
    SELECT p.provolatile = 'v'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'revoke_affiliate_invite'
  ) AS passed;

-- 6. anon and authenticated cannot execute any of them.
SELECT
  'browser_roles_cannot_execute' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites',
        'revoke_affiliate_invite'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) AS passed;

-- 7. The service role can execute every one of them.
SELECT
  'service_role_can_execute' AS check_name,
  (
    SELECT count(*) = 10
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites',
        'revoke_affiliate_invite'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 8. The nine read models return jsonb or a table; none returns a plain scalar.
SELECT
  'read_model_return_types' AS check_name,
  (
    SELECT count(*) = 9
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites'
      )
      AND (p.proretset OR p.prorettype = 'jsonb'::regtype)
  ) AS passed;

-- 9. The read models never write: no function body contains INSERT, UPDATE or
-- DELETE, except revoke_affiliate_invite (which writes its audit row).
SELECT
  'read_models_are_read_only' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'affiliate_marketplace', 'affiliate_overview', 'affiliate_daily_series',
        'affiliate_link_stats', 'affiliate_breakdown', 'affiliate_commission_list',
        'vendor_affiliate_requests', 'vendor_affiliate_stats', 'vendor_invites'
      )
      AND (
        p.prosrc ~* '\minsert\M'
        OR p.prosrc ~* '\mupdate\M'
        OR p.prosrc ~* '\mdelete\M'
      )
  ) AS passed;

-- 10. The marketplace indexes it relies on still exist.
SELECT
  'marketplace_indexes_exist' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND c.relname IN ('products_search_idx', 'products_title_trgm_idx')
  ) AS passed;
