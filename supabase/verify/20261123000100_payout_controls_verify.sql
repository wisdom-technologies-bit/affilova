-- Verify 20261123000100_payout_controls. Every row must be true.

SELECT 'payout_controls is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1 FROM public.app_migrations
          WHERE version = '20261123000100' AND name = 'payout_controls'
       ) AS ok
UNION ALL
SELECT 'step_up_codes has row level security enabled',
       (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.step_up_codes'::regclass)
UNION ALL
SELECT 'clients have no privileges on step_up_codes',
       NOT has_table_privilege('anon', 'public.step_up_codes', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.step_up_codes', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.step_up_codes', 'INSERT')
UNION ALL
SELECT 'all six functions exist',
       (SELECT count(*) = 6
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('create_step_up_code', 'verify_step_up_code', 'update_setting',
                             'list_blackout_dates', 'get_payout_screen_data', 'admin_withdrawal_queue'))
UNION ALL
SELECT 'every function is security definer with an empty search_path',
       (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('create_step_up_code', 'verify_step_up_code', 'update_setting',
                             'list_blackout_dates', 'get_payout_screen_data', 'admin_withdrawal_queue'))
UNION ALL
SELECT 'only service_role may execute them',
       (SELECT bool_and(
                 has_function_privilege('service_role', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('create_step_up_code', 'verify_step_up_code', 'update_setting',
                             'list_blackout_dates', 'get_payout_screen_data', 'admin_withdrawal_queue'))
UNION ALL
SELECT 'the purpose column is constrained',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.step_up_codes'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%bank_change%'
            AND pg_get_constraintdef(oid) LIKE '%withdrawal%'
       )
UNION ALL
SELECT 'email_log can hold a withdrawal notice: one subject, unique per recipient',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'email_log' AND column_name = 'withdrawal_id')
       AND EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.email_log'::regclass AND conname = 'email_log_one_subject')
       AND EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public' AND indexname = 'email_log_withdrawal_one_per_recipient');
