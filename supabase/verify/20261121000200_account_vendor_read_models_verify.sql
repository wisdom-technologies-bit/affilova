-- ============================================================================
-- Verification for migration 20261121000200_account_vendor_read_models
-- Read-only. No writes, no DDL.
--
-- Run this AFTER every earlier migration and
-- 20261121000200_account_vendor_read_models.sql have been applied to the same
-- project. Every statement returns a check_name and a boolean passed. The
-- migration is only considered applied when every `passed` is true.
--
-- The behaviour (guest claiming, the maths, cursor pagination, ownership
-- isolation in both directions and the rollback) is covered by
-- supabase/tests/account_vendor_read_models_test.sh, which needs a throwaway
-- database.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261121000200' AND name = 'account_vendor_read_models'
  ) AS passed;

-- 2. All eight functions exist with their exact signatures.
SELECT
  'functions_exist' AS check_name,
  (
    SELECT count(*) = 8
    FROM (VALUES
      ('claim_guest_orders', 'uuid'),
      ('account_orders', 'uuid, integer, jsonb'),
      ('account_order_detail', 'uuid, uuid'),
      ('vendor_overview', 'uuid, timestamp with time zone, timestamp with time zone'),
      ('vendor_daily_series', 'uuid, date, date'),
      ('vendor_sales_list', 'uuid, text, integer, jsonb'),
      ('vendor_refund_requests', 'uuid, text, integer, jsonb'),
      ('vendor_top_products', 'uuid, date, date')
    ) AS f(name, args)
    WHERE to_regprocedure('public.' || f.name || '(' || f.args || ')') IS NOT NULL
  ) AS passed;

-- 3. Every function is SECURITY DEFINER.
SELECT
  'security_definer' AS check_name,
  (
    SELECT count(*) = 8
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_guest_orders', 'account_orders', 'account_order_detail',
        'vendor_overview', 'vendor_daily_series', 'vendor_sales_list',
        'vendor_refund_requests', 'vendor_top_products'
      )
      AND p.prosecdef
  ) AS passed;

-- 4. Every function pins an empty search_path.
SELECT
  'empty_search_path' AS check_name,
  (
    SELECT count(*) = 8
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_guest_orders', 'account_orders', 'account_order_detail',
        'vendor_overview', 'vendor_daily_series', 'vendor_sales_list',
        'vendor_refund_requests', 'vendor_top_products'
      )
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) AS passed;

-- 5. The seven read models are STABLE; the claim is the one VOLATILE function.
SELECT
  'volatility' AS check_name,
  (
    (SELECT count(*) = 7
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'account_orders', 'account_order_detail', 'vendor_overview',
         'vendor_daily_series', 'vendor_sales_list', 'vendor_refund_requests',
         'vendor_top_products'
       )
       AND p.provolatile = 's')
    AND
    (SELECT count(*) = 1
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_guest_orders'
       AND p.provolatile = 'v')
  ) AS passed;

-- 6. The read models contain no INSERT, UPDATE or DELETE; the claim does write.
SELECT
  'read_models_are_reads' AS check_name,
  (
    SELECT count(*) = 7
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'account_orders', 'account_order_detail', 'vendor_overview',
        'vendor_daily_series', 'vendor_sales_list', 'vendor_refund_requests',
        'vendor_top_products'
      )
      AND p.prosrc !~* '\m(insert|update|delete)\M'
  ) AS passed;

SELECT
  'claim_writes_orders_and_entitlements' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_guest_orders'
      AND p.prosrc ~* 'UPDATE public\.orders'
      AND p.prosrc ~* 'UPDATE public\.entitlements'
      AND p.prosrc ~* 'INSERT INTO public\.audit_log'
  ) AS passed;

-- 7. Nobody but the service role may execute any of them.
SELECT
  'no_browser_execute' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('claim_guest_orders', 'uuid'),
      ('account_orders', 'uuid, integer, jsonb'),
      ('account_order_detail', 'uuid, uuid'),
      ('vendor_overview', 'uuid, timestamp with time zone, timestamp with time zone'),
      ('vendor_daily_series', 'uuid, date, date'),
      ('vendor_sales_list', 'uuid, text, integer, jsonb'),
      ('vendor_refund_requests', 'uuid, text, integer, jsonb'),
      ('vendor_top_products', 'uuid, date, date')
    ) AS f(name, args)
    WHERE has_function_privilege('public', 'public.' || f.name || '(' || f.args || ')', 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || f.name || '(' || f.args || ')', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || f.name || '(' || f.args || ')', 'EXECUTE')
  ) AS passed;

SELECT
  'service_role_execute' AS check_name,
  (
    SELECT count(*) = 8
    FROM (VALUES
      ('claim_guest_orders', 'uuid'),
      ('account_orders', 'uuid, integer, jsonb'),
      ('account_order_detail', 'uuid, uuid'),
      ('vendor_overview', 'uuid, timestamp with time zone, timestamp with time zone'),
      ('vendor_daily_series', 'uuid, date, date'),
      ('vendor_sales_list', 'uuid, text, integer, jsonb'),
      ('vendor_refund_requests', 'uuid, text, integer, jsonb'),
      ('vendor_top_products', 'uuid, date, date')
    ) AS f(name, args)
    WHERE has_function_privilege('service_role', 'public.' || f.name || '(' || f.args || ')', 'EXECUTE')
  ) AS passed;

-- 8. Row level security is on for every table the read models touch.
SELECT
  'rls_enabled' AS check_name,
  (
    SELECT count(*) = 10
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'profiles', 'vendor_profiles', 'products', 'product_files',
        'product_images', 'orders', 'order_items', 'order_tax_lines',
        'entitlements', 'refund_requests'
      )
      AND c.relrowsecurity
  ) AS passed;

-- 9. The no-storage-key rule holds in the source of the two account functions.
SELECT
  'no_storage_keys_in_account_reads' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('account_orders', 'account_order_detail')
      AND p.prosrc !~* 'storage_key'
  ) AS passed;
