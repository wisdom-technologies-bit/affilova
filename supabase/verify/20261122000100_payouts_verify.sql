-- Verify 20261122000100_payouts. Every row must be true.

SELECT 'payouts is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1
         FROM public.app_migrations
         WHERE version = '20261122000100'
           AND name = 'payouts'
       ) AS ok
UNION ALL
SELECT 'every payout table has row level security enabled',
       (SELECT bool_and(c.relrowsecurity)
          FROM pg_class c
         WHERE c.oid IN (
           'public.payout_accounts'::regclass,
           'public.payout_preferences'::regclass,
           'public.withdrawals'::regclass,
           'public.withdrawal_approvals'::regclass
         ))
UNION ALL
SELECT 'the payout settings are seeded',
       (SELECT count(*) = 8
          FROM public.settings
         WHERE key IN (
           'payout_auto_approve_max_kobo', 'payout_dual_approval_kobo',
           'payout_first_requires_approval', 'payout_account_min_age_days',
           'withdrawal_daily_limit_kobo', 'payout_bank_change_freeze_hours',
           'payout_processing_hours_lagos', 'paystack_transfer_fee_bands'
         ))
UNION ALL
SELECT 'the fee bands are the documented three',
       (SELECT value FROM public.settings WHERE key = 'paystack_transfer_fee_bands')
         = '[{"up_to_kobo":500000,"fee_kobo":1000},{"up_to_kobo":5000000,"fee_kobo":2500},{"up_to_kobo":null,"fee_kobo":5000}]'::jsonb
UNION ALL
SELECT 'only one active payout account per user is allowed',
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'payout_accounts_one_active_idx'
       )
UNION ALL
SELECT 'the full account number has no column to live in',
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'payout_accounts'
            AND column_name IN ('account_number', 'account_no', 'nuban')
       )
UNION ALL
SELECT 'account_last4 only accepts four digits',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.payout_accounts'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%account_last4%[0-9]{4}%'
       )
UNION ALL
SELECT 'gross = fee + net is a table constraint',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.withdrawals'::regclass
            AND conname = 'withdrawals_amounts_balance'
       )
UNION ALL
SELECT 'withdrawal status is constrained to the eight states',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.withdrawals'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%reversed%'
            AND pg_get_constraintdef(oid) LIKE '%cancelled%'
       )
UNION ALL
SELECT 'withdrawal reference is unique and pattern-checked',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.withdrawals'::regclass
            AND contype = 'u'
       )
       AND EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.withdrawals'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%a-z0-9_-%'
       )
UNION ALL
SELECT 'payout_accounts_safe exists and hides recipient_code',
       to_regclass('public.payout_accounts_safe') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'payout_accounts_safe'
            AND column_name = 'recipient_code'
       )
UNION ALL
SELECT 'payout_accounts_safe runs with the caller rights',
       (SELECT reloptions FROM pg_class WHERE oid = 'public.payout_accounts_safe'::regclass)
         @> ARRAY['security_invoker=true']::text[]
UNION ALL
SELECT 'anon has no privilege on any payout table',
       NOT has_table_privilege('anon', 'public.payout_accounts', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.payout_preferences', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.withdrawals', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.withdrawal_approvals', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.payout_accounts_safe', 'SELECT')
UNION ALL
SELECT 'no client role may write a payout table',
       NOT has_table_privilege('authenticated', 'public.payout_accounts', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.payout_accounts', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'public.payout_accounts', 'DELETE')
       AND NOT has_table_privilege('authenticated', 'public.withdrawals', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.withdrawals', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'public.withdrawals', 'DELETE')
       AND NOT has_table_privilege('authenticated', 'public.payout_preferences', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.withdrawal_approvals', 'INSERT')
UNION ALL
SELECT 'a signed-in user may only read their own withdrawals',
       EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'withdrawals'
            AND policyname = 'withdrawals_select_owner'
            AND cmd = 'SELECT'
       )
UNION ALL
SELECT 'only admin and finance read withdrawal approvals',
       EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'withdrawal_approvals'
            AND policyname = 'withdrawal_approvals_select_admin_finance'
       )
UNION ALL
SELECT 'every payout function is SECURITY DEFINER with an empty search_path',
       (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[])
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'payout_now', 'payout_transfer_fee', 'payout_processing_window',
             'payout_next_day', 'payout_available_by_account', 'payout_needs_approval',
             'payout_evaluate', 'payout_debit_split', 'payout_post_request',
             'payout_post_paid', 'payout_post_return', 'set_payout_account',
             'set_auto_payout', 'withdrawal_preview', 'request_withdrawal',
             'approve_withdrawal', 'reject_withdrawal', 'cancel_withdrawal',
             'claim_withdrawals_for_transfer', 'release_claimed_withdrawals',
             'mark_transfer_submitted', 'record_transfer_result',
             'list_auto_payout_candidates', 'list_stuck_withdrawals',
             'get_withdrawal_for_approval', 'admin_withdrawals', 'payout_overview'
           ))
UNION ALL
SELECT 'PUBLIC, anon and authenticated cannot execute any payout function',
       (SELECT bool_and(
                 NOT has_function_privilege('public', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
               )
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'payout_now', 'payout_transfer_fee', 'payout_processing_window',
             'payout_next_day', 'payout_available_by_account', 'payout_needs_approval',
             'payout_evaluate', 'payout_debit_split', 'payout_post_request',
             'payout_post_paid', 'payout_post_return', 'set_payout_account',
             'set_auto_payout', 'withdrawal_preview', 'request_withdrawal',
             'approve_withdrawal', 'reject_withdrawal', 'cancel_withdrawal',
             'claim_withdrawals_for_transfer', 'release_claimed_withdrawals',
             'mark_transfer_submitted', 'record_transfer_result',
             'list_auto_payout_candidates', 'list_stuck_withdrawals',
             'get_withdrawal_for_approval', 'admin_withdrawals', 'payout_overview'
           ))
UNION ALL
SELECT 'service_role can execute every payout function',
       (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'payout_now', 'payout_transfer_fee', 'payout_processing_window',
             'payout_next_day', 'payout_available_by_account', 'payout_needs_approval',
             'payout_evaluate', 'payout_debit_split', 'payout_post_request',
             'payout_post_paid', 'payout_post_return', 'set_payout_account',
             'set_auto_payout', 'withdrawal_preview', 'request_withdrawal',
             'approve_withdrawal', 'reject_withdrawal', 'cancel_withdrawal',
             'claim_withdrawals_for_transfer', 'release_claimed_withdrawals',
             'mark_transfer_submitted', 'record_transfer_result',
             'list_auto_payout_candidates', 'list_stuck_withdrawals',
             'get_withdrawal_for_approval', 'admin_withdrawals', 'payout_overview'
           ))
UNION ALL
SELECT 'the ledger is still append-only',
       EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.ledger_entries'::regclass
            AND tgname = 'ledger_entries_no_update_or_delete'
            AND NOT tgisinternal
       )
       AND EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.ledger_entries'::regclass
            AND tgname = 'ledger_entries_balanced'
       )
UNION ALL
SELECT 'the payout clock reads the override setting',
       position('payout_clock_override_iso' IN pg_get_functiondef('public.payout_now()'::regprocedure)) > 0
UNION ALL
SELECT 'release_claimed_withdrawals exists for the low balance path',
       to_regprocedure('public.release_claimed_withdrawals(uuid[])') IS NOT NULL
UNION ALL
SELECT 'record_transfer_result accepts the reported fee',
       to_regprocedure('public.record_transfer_result(text, text, text, text, bigint)') IS NOT NULL;
