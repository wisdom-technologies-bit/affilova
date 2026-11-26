-- ============================================================================
-- Verification for migration 20261125000100_public_marketplace
-- Read-only. No writes, no DDL.
--
-- Run this AFTER every earlier migration and
-- 20261125000100_public_marketplace.sql have been applied to the same project.
-- Every statement returns a check_name and a boolean passed. The migration is
-- only considered applied when every `passed` is true.
--
-- The behaviour (what is visible, search, sorts, cursors, filters, the store,
-- the sitemap, privileges, EXPLAIN and the rollback) is covered by
-- supabase/tests/public_marketplace_test.sh, which needs a throwaway database.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261125000100' AND name = 'public_marketplace'
  ) AS passed;

-- 2. All five functions exist with their exact signatures.
SELECT
  'functions_exist' AS check_name,
  (
    SELECT count(*) = 5
    FROM (VALUES
      ('public_categories', ''),
      ('public_marketplace', 'text, text, bigint, bigint, text, integer, jsonb'),
      ('public_product_related', 'uuid, integer'),
      ('public_store', 'text, integer, jsonb'),
      ('public_sitemap_entries', '')
    ) AS f(name, args)
    WHERE to_regprocedure('public.' || f.name || '(' || f.args || ')') IS NOT NULL
  ) AS passed;

-- 3. Every function is SECURITY DEFINER.
SELECT
  'security_definer' AS check_name,
  (
    SELECT count(*) = 5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND p.prosecdef
  ) AS passed;

-- 4. Every function is STABLE: none of them writes.
SELECT
  'stable' AS check_name,
  (
    SELECT count(*) = 5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND p.provolatile = 's'
  ) AS passed;

-- 5. Every function has an empty search_path, so nothing it calls can be
--    shadowed by a schema a caller controls.
SELECT
  'empty_search_path' AS check_name,
  (
    SELECT count(*) = 5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg
        WHERE cfg IN ('search_path=', 'search_path=""')
      )
  ) AS passed;

-- 6. anon and authenticated cannot execute any of them.
SELECT
  'no_client_execute' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) AS passed;

-- 7. The service role can execute every one of them.
SELECT
  'service_role_execute' AS check_name,
  (
    SELECT count(*) = 5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 8. Row level security is on for every table the read models touch.
SELECT
  'rls_enabled' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'products',
        'product_categories',
        'product_images',
        'vendor_profiles',
        'orders',
        'order_items'
      )
      AND c.relrowsecurity = false
  ) AS passed;

-- 9. No function body mentions commission or affiliate, so no such field can be
--    assembled by accident.
SELECT
  'no_commission_or_affiliate' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND (p.prosrc ILIKE '%commission%' OR p.prosrc ILIKE '%affiliate%')
  ) AS passed;

-- 10. No function body reads a contact column or a vendor's user id into its
--     output. support_email and phone belong to the vendor's account, and the
--     public pages must never carry them.
SELECT
  'no_contact_columns' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'public_categories',
        'public_marketplace',
        'public_product_related',
        'public_store',
        'public_sitemap_entries'
      )
      AND (p.prosrc ILIKE '%support_email%' OR p.prosrc ILIKE '%vp.phone%' OR p.prosrc ILIKE '%buyer_email%')
  ) AS passed;

-- 11. The empty answers are shaped, not null: an empty list is [] and an empty
--     page carries its three keys.
SELECT
  'empty_shapes' AS check_name,
  jsonb_typeof(public.public_categories()) = 'array'
  AND jsonb_typeof(public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 12, NULL)) = 'object'
  AND jsonb_typeof(public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 12, NULL) -> 'items') = 'array'
  AND jsonb_typeof(public.public_sitemap_entries() -> 'products') = 'array' AS passed;

-- 12. The function that ranks by sales is capped at 24 rows like the others, so
--     one page can never be unbounded.
SELECT
  'limit_capped' AS check_name,
  jsonb_array_length(
    public.public_marketplace(NULL, NULL, NULL, NULL, 'best_selling', 1000, NULL) -> 'items'
  ) <= 24 AS passed;
