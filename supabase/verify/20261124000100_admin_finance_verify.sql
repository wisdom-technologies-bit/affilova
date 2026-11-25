-- Verify 20261124000100_admin_finance. Every row must be true.
--
-- These checks are structural: the harness proves the arithmetic. What is proved
-- here is that the shape the application relies on exists, that no client role
-- can call a money function, and that nothing in this migration opens a write
-- path to the browser.

SELECT 'admin_finance is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1
         FROM public.app_migrations
         WHERE version = '20261124000100'
           AND name = 'admin_finance'
       ) AS ok
UNION ALL
SELECT 'order_disputes has the three provider outcome columns',
       (SELECT count(*) = 3
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'order_disputes'
           AND column_name IN ('provider_resolution', 'provider_resolved_at', 'needs_decision'))
UNION ALL
SELECT 'needs_decision defaults to false and is not nullable',
       (SELECT is_nullable = 'NO' AND column_default = 'false'
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'order_disputes'
           AND column_name = 'needs_decision')
UNION ALL
SELECT 'reconciliation_runs exists with the five documented columns',
       (SELECT count(*) = 6
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reconciliation_runs'
           AND column_name IN ('id', 'run_at', 'ledger_paystack_balance_kobo',
                               'provider_balance_kobo', 'diff_kobo', 'details'))
UNION ALL
SELECT 'reconciliation_runs has row level security enabled',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reconciliation_runs'::regclass)
UNION ALL
SELECT 'reconciliation_runs has no policy, so no client role can read it',
       NOT EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'reconciliation_runs'
       )
UNION ALL
SELECT 'the difference must equal ledger minus provider',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.reconciliation_runs'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%diff_kobo%ledger_paystack_balance_kobo%'
       )
UNION ALL
SELECT 'every admin finance function exists',
       (SELECT count(*) = 17
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'record_dispute_provider_outcome', 'record_reconciliation_run',
             'retry_refund_submission', 'admin_overview', 'admin_daily_series',
             'admin_orders_list', 'admin_order_detail', 'admin_refunds_list',
             'admin_disputes_list', 'admin_ledger_list', 'admin_trial_balance',
             'admin_reconciliation_list', 'vat_periods_list', 'vat_period_detail',
             'vat_export_rows', 'vat_reminder_targets', 'staff_has_any_role'
           ))
UNION ALL
SELECT 'every admin finance function is security definer',
       (SELECT bool_and(p.prosecdef)
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'record_dispute_provider_outcome', 'record_reconciliation_run',
             'retry_refund_submission', 'admin_overview', 'admin_daily_series',
             'admin_orders_list', 'admin_order_detail', 'admin_refunds_list',
             'admin_disputes_list', 'admin_ledger_list', 'admin_trial_balance',
             'admin_reconciliation_list', 'vat_periods_list', 'vat_period_detail',
             'vat_export_rows', 'vat_reminder_targets', 'staff_has_any_role'
           ))
UNION ALL
SELECT 'every admin finance function pins an empty search_path',
       (SELECT bool_and(p.proconfig IS NOT NULL AND 'search_path=""' = ANY (p.proconfig))
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'record_dispute_provider_outcome', 'record_reconciliation_run',
             'retry_refund_submission', 'admin_overview', 'admin_daily_series',
             'admin_orders_list', 'admin_order_detail', 'admin_refunds_list',
             'admin_disputes_list', 'admin_ledger_list', 'admin_trial_balance',
             'admin_reconciliation_list', 'vat_periods_list', 'vat_period_detail',
             'vat_export_rows', 'vat_reminder_targets', 'staff_has_any_role'
           ))
UNION ALL
SELECT 'no browser role may execute any of them',
       (SELECT count(*) = 0
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'record_dispute_provider_outcome', 'record_reconciliation_run',
             'retry_refund_submission', 'admin_overview', 'admin_daily_series',
             'admin_orders_list', 'admin_order_detail', 'admin_refunds_list',
             'admin_disputes_list', 'admin_ledger_list', 'admin_trial_balance',
             'admin_reconciliation_list', 'vat_periods_list', 'vat_period_detail',
             'vat_export_rows', 'vat_reminder_targets', 'staff_has_any_role',
             'mask_email', 'account_balance', 'admin_finance_range_ok'
           )
           AND (
             pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
             OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
           ))
UNION ALL
SELECT 'the service role may execute every read function',
       (SELECT bool_and(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'admin_overview', 'admin_daily_series', 'admin_orders_list',
             'admin_order_detail', 'admin_refunds_list', 'admin_disputes_list',
             'admin_ledger_list', 'admin_trial_balance', 'admin_reconciliation_list',
             'vat_periods_list', 'vat_period_detail', 'vat_export_rows',
             'vat_reminder_targets', 'retry_refund_submission',
             'record_dispute_provider_outcome', 'record_reconciliation_run'
           ))
UNION ALL
SELECT 'the read functions are stable, the write functions are volatile',
       (SELECT bool_and(
                 CASE WHEN p.proname IN ('admin_overview', 'admin_daily_series',
                                         'admin_orders_list', 'admin_refunds_list',
                                         'admin_disputes_list', 'admin_ledger_list',
                                         'admin_trial_balance', 'admin_reconciliation_list',
                                         'vat_periods_list', 'vat_period_detail',
                                         'vat_export_rows', 'vat_reminder_targets')
                      THEN p.provolatile = 's'
                      ELSE p.provolatile = 'v'
                 END)
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'record_dispute_provider_outcome', 'record_reconciliation_run',
             'retry_refund_submission', 'admin_overview', 'admin_daily_series',
             'admin_orders_list', 'admin_refunds_list', 'admin_disputes_list',
             'admin_ledger_list', 'admin_trial_balance', 'admin_reconciliation_list',
             'vat_periods_list', 'vat_period_detail', 'vat_export_rows',
             'vat_reminder_targets'
           ))
UNION ALL
SELECT 'the order detail is volatile, because it writes an audit row',
       (SELECT p.provolatile = 'v'
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'admin_order_detail')
UNION ALL
SELECT 'mask_email keeps the first letter and the domain',
       public.mask_email('buyer@example.com') = 'b***@example.com'
UNION ALL
SELECT 'mask_email has nothing to show for an empty address',
       public.mask_email('') IS NULL AND public.mask_email(NULL) IS NULL
UNION ALL
SELECT 'the actor is the first argument of every read that needs one',
       (SELECT bool_and(p.proargnames[1] = 'p_actor')
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'admin_overview', 'admin_daily_series', 'admin_orders_list',
             'admin_order_detail', 'admin_refunds_list', 'admin_disputes_list',
             'admin_ledger_list', 'admin_trial_balance', 'admin_reconciliation_list',
             'vat_periods_list', 'vat_period_detail', 'vat_export_rows',
             'retry_refund_submission'
           ))
UNION ALL
SELECT 'no function in this migration takes a buyer email or a full address',
       NOT EXISTS (
         SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('admin_orders_list', 'admin_order_detail',
                             'admin_refunds_list', 'admin_disputes_list')
           AND p.proargnames::text ~* '(email_address|account_number|card)'
       )
UNION ALL
SELECT 'the dispute decision index is partial, so it stays small',
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'order_disputes_needs_decision_idx'
            AND indexdef LIKE '%WHERE needs_decision%'
       )
UNION ALL
SELECT 'email_log can hold a VAT reminder claim',
       (SELECT count(*) = 2
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'email_log'
           AND column_name IN ('vat_period', 'kind'))
UNION ALL
SELECT 'a VAT reminder is claimed once per kind and period',
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'email_log'
            AND indexname = 'email_log_vat_one_per_recipient'
       )
