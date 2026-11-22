-- ============================================================================
-- Verification for migration 20261121000200_account_vendor_read_models
-- Read-only. No writes, no DDL.
-- ============================================================================

SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261121000200' AND name = 'account_vendor_read_models'
  ) AS passed;

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
