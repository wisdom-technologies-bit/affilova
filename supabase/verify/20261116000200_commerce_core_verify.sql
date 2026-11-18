-- ============================================================================
-- Verification for migration 20261116000200_commerce_core
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql, 20261112000200_job_queue.sql,
-- 20261113000100_roles_onboarding.sql, 20261114000100_catalog.sql,
-- 20261115000100_malware_scanning.sql and 20261116000200_commerce_core.sql
-- have been applied to the same project. Every statement returns a check_name
-- and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261116000200' AND name = 'commerce_core'
  ) AS passed;

-- 2. All thirteen tables exist in public.
SELECT
  'tables_present' AS check_name,
  (
    SELECT count(*) = 13
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'orders', 'order_items', 'order_tax_lines', 'entitlements', 'download_log',
        'ledger_accounts', 'ledger_transactions', 'ledger_entries',
        'refund_requests', 'order_disputes', 'payout_blackout_dates',
        'vat_periods', 'vat_adjustments'
      )
  ) AS passed;

-- 3. Row level security is enabled on every one of them.
SELECT
  'rls_enabled_everywhere' AS check_name,
  (
    SELECT count(*) = 13
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname IN (
        'orders', 'order_items', 'order_tax_lines', 'entitlements', 'download_log',
        'ledger_accounts', 'ledger_transactions', 'ledger_entries',
        'refund_requests', 'order_disputes', 'payout_blackout_dates',
        'vat_periods', 'vat_adjustments'
      )
  ) AS passed;

-- 4. The nine settings rows are seeded at the agreed values.
SELECT
  'settings_seeded' AS check_name,
  (
    SELECT count(*) = 9
    FROM public.settings
    WHERE (key = 'withdrawal_fee_bps'      AND value = '200'::jsonb)
       OR (key = 'withdrawal_fee_min_kobo' AND value = '5000'::jsonb)
       OR (key = 'withdrawal_fee_cap_kobo' AND value = '200000'::jsonb)
       OR (key = 'processor_fee_bearer'    AND value = '"platform"'::jsonb)
       OR (key = 'auto_payout_default'     AND value = 'true'::jsonb)
       OR (key = 'payout_weekdays'         AND value = '[1,2,3,4,5]'::jsonb)
       OR (key = 'payout_run_hour_lagos'   AND value = '10'::jsonb)
       OR (key = 'order_expiry_hours'      AND value = '24'::jsonb)
       OR (key = 'guest_checkout_enabled'  AND value = 'true'::jsonb)
  ) AS passed;

-- 5. order_status has the six states.
SELECT
  'order_status_enum' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'order_status'
      AND e.enumlabel IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'disputed')
  ) AS passed;

-- 6. The chart of accounts is seeded with the eight accounts and their kinds.
SELECT
  'ledger_accounts_seeded' AS check_name,
  (
    SELECT count(*) = 8
    FROM public.ledger_accounts
    WHERE (code = 'paystack_balance'       AND kind = 'asset')
       OR (code = 'processor_fees'         AND kind = 'expense')
       OR (code = 'vendor_payable'         AND kind = 'liability')
       OR (code = 'affiliate_payable'      AND kind = 'liability')
       OR (code = 'platform_revenue'       AND kind = 'revenue')
       OR (code = 'withdrawal_fee_revenue' AND kind = 'revenue')
       OR (code = 'vat_payable'            AND kind = 'liability')
       OR (code = 'payouts_in_transit'     AND kind = 'liability')
  ) AS passed;

-- 7. The order number sequence exists.
SELECT
  'order_number_sequence' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = 'order_number_seq'
  ) AS passed;

-- 8. Every function this migration creates exists, is SECURITY DEFINER and has
--    an empty search_path.
SELECT
  'functions_definer_and_empty_path' AS check_name,
  (
    SELECT count(*) = 27
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND p.proname IN (
        'commerce_setting', 'commerce_setting_int', 'commerce_setting_bigint',
        'commerce_setting_bool', 'commerce_setting_text', 'commerce_round_half_up',
        'compute_split', 'compute_withdrawal_fee', 'is_payout_day',
        'next_order_number', 'commerce_order_math', 'create_order',
        'attach_paystack_init', 'process_paid_order', 'expire_pending_orders',
        'vat_period_summary', 'set_vat_period_status', 'add_vat_adjustment',
        'request_refund', 'decide_refund', 'process_refund', 'open_dispute',
        'resolve_dispute', 'claim_download', 'get_party_balance',
        'add_payout_blackout', 'remove_payout_blackout'
      )
  ) AS passed;

-- 9. No commerce function is executable by a client role.
SELECT
  'no_client_execute' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'commerce_setting', 'commerce_setting_int', 'commerce_setting_bigint',
        'commerce_setting_bool', 'commerce_setting_text', 'commerce_round_half_up',
        'compute_split', 'compute_withdrawal_fee', 'is_payout_day',
        'next_order_number', 'commerce_order_math', 'create_order',
        'attach_paystack_init', 'process_paid_order', 'expire_pending_orders',
        'vat_period_summary', 'set_vat_period_status', 'add_vat_adjustment',
        'request_refund', 'decide_refund', 'process_refund', 'open_dispute',
        'resolve_dispute', 'claim_download', 'get_party_balance',
        'add_payout_blackout', 'remove_payout_blackout',
        'ledger_entries_block_mutation', 'ledger_check_balanced'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) AS passed;

-- 10. anon holds no privilege at all on any commerce table.
SELECT
  'anon_has_nothing' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v')
      AND c.relname IN (
        'orders', 'order_items', 'order_tax_lines', 'entitlements', 'download_log',
        'ledger_accounts', 'ledger_transactions', 'ledger_entries',
        'refund_requests', 'order_disputes', 'payout_blackout_dates',
        'vat_periods', 'vat_adjustments', 'vendor_sales', 'affiliate_commissions'
      )
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
      )
  ) AS passed;

-- 11. No client role may write any commerce table.
SELECT
  'no_client_writes' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'orders', 'order_items', 'order_tax_lines', 'entitlements', 'download_log',
        'ledger_accounts', 'ledger_transactions', 'ledger_entries',
        'refund_requests', 'order_disputes', 'payout_blackout_dates',
        'vat_periods', 'vat_adjustments'
      )
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')
      )
  ) AS passed;

-- 12. The ledger is append-only for the server too.
SELECT
  'ledger_append_only_privileges' AS check_name,
  (
    NOT has_table_privilege('service_role', 'public.ledger_entries', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.ledger_entries', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.ledger_entries', 'TRUNCATE')
    AND NOT has_table_privilege('service_role', 'public.ledger_transactions', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.ledger_transactions', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.ledger_transactions', 'TRUNCATE')
  ) AS passed;

-- 13. The three ledger guards are in place: row update/delete, truncate, and the
--     deferred balance constraint trigger.
SELECT
  'ledger_triggers' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ledger_entries'
      AND NOT tg.tgisinternal
      AND tg.tgname IN (
        'ledger_entries_no_update_or_delete',
        'ledger_entries_no_truncate',
        'ledger_entries_balanced'
      )
  ) AS passed;

-- 14. The balance trigger is a deferrable, initially deferred constraint
--     trigger.
SELECT
  'balance_trigger_deferred' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ledger_entries'
      AND tg.tgname = 'ledger_entries_balanced'
      AND tg.tgconstraint <> 0
      AND tg.tgdeferrable
      AND tg.tginitdeferred
  ) AS passed;

-- 15. A ledger entry may be a debit or a credit, never both and never neither.
SELECT
  'ledger_entry_single_side' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ledger_entries'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%debit_kobo > 0%credit_kobo > 0%'
  ) AS passed;

-- 16. Only one open refund request per order can exist.
SELECT
  'refund_one_open_per_order' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'refund_requests_one_open_idx'
      AND i.indisunique
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%requested%approved%'
  ) AS passed;

-- 17. One entitlement per order item and file.
SELECT
  'entitlement_unique_per_file' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'entitlements'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) = 'UNIQUE (order_item_id, file_id)'
  ) AS passed;

-- 18. The orders arithmetic checks and the paid_at check are present.
SELECT
  'orders_checks' AS check_name,
  (
    SELECT count(*) = 4
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'orders'
      AND con.contype = 'c'
      AND con.conname IN (
        'orders_total_at_least_subtotal',
        'orders_total_with_exclusive_tax',
        'orders_total_with_inclusive_tax',
        'orders_paid_at_required'
      )
  ) AS passed;

-- 19. The item split check is present.
SELECT
  'order_items_split_check' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'order_items'
      AND con.contype = 'c'
      AND con.conname = 'order_items_split_balances'
  ) AS passed;

-- 20. Both read-model views exist and expose no buyer email or buyer name.
SELECT
  'views_without_buyer_identity' AS check_name,
  (
    SELECT count(*) = 2
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name IN ('vendor_sales', 'affiliate_commissions')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('vendor_sales', 'affiliate_commissions')
      AND column_name IN ('buyer_email', 'buyer_name')
  ) AS passed;

-- 21. The vendor and affiliate views are readable by authenticated only.
SELECT
  'views_granted' AS check_name,
  (
    has_table_privilege('authenticated', 'public.vendor_sales', 'SELECT')
    AND has_table_privilege('authenticated', 'public.affiliate_commissions', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.vendor_sales', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.affiliate_commissions', 'SELECT')
  ) AS passed;

-- 22. Every policy on the new tables is SELECT-only.
SELECT
  'policies_select_only' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'orders', 'order_items', 'order_tax_lines', 'entitlements', 'download_log',
        'ledger_accounts', 'ledger_transactions', 'ledger_entries',
        'refund_requests', 'order_disputes', 'payout_blackout_dates',
        'vat_periods', 'vat_adjustments'
      )
      AND cmd <> 'SELECT'
  ) AS passed;

-- 23. The order number format helper returns the AFV shape.
SELECT
  'order_number_format' AS check_name,
  public.next_order_number() ~ '^AFV-[0-9]{4}-[0-9]{6}$' AS passed;

-- 24. compute_split agrees with the worked example from the specification.
SELECT
  'compute_split_example' AS check_name,
  (
    SELECT platform_fee_kobo = 100000
       AND affiliate_commission_kobo = 300000
       AND vendor_net_kobo = 600000
    FROM public.compute_split(1000000::bigint, 3000, 1000, true)
  ) AS passed;
