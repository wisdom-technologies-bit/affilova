-- Verify 20261126000100_email_diagnostics. Every row must be true.
SELECT 'email_failures table exists' AS check, to_regclass('public.email_failures') IS NOT NULL AS ok
UNION ALL
SELECT 'email_diagnostics is recorded in app_migrations',
       EXISTS (SELECT 1 FROM public.app_migrations WHERE version = '20261126000100')
UNION ALL
SELECT 'email_failures has row level security enabled',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_failures'::regclass)
UNION ALL
SELECT 'anon has no privilege on email_failures',
       NOT has_table_privilege('anon', 'public.email_failures', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.email_failures', 'INSERT')
       AND NOT has_table_privilege('anon', 'public.email_failures', 'UPDATE')
       AND NOT has_table_privilege('anon', 'public.email_failures', 'DELETE')
UNION ALL
SELECT 'authenticated has no privilege on email_failures',
       NOT has_table_privilege('authenticated', 'public.email_failures', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.email_failures', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.email_failures', 'DELETE')
UNION ALL
SELECT 'service_role may insert into and read email_failures',
       has_table_privilege('service_role', 'public.email_failures', 'INSERT')
       AND has_table_privilege('service_role', 'public.email_failures', 'SELECT')
       AND has_table_privilege('service_role', 'public.email_failures', 'DELETE')
UNION ALL
SELECT 'no policy grants a client role a row',
       NOT EXISTS (
         SELECT 1
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'email_failures'
           AND ('anon' = ANY (roles) OR 'authenticated' = ANY (roles) OR 'public' = ANY (roles))
       )
UNION ALL
SELECT 'the template column is capped at 60 characters',
       EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'public.email_failures'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%char_length(template)%60%'
       )
UNION ALL
SELECT 'the reason column is capped at 40 characters',
       EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'public.email_failures'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%char_length(reason)%40%'
       )
UNION ALL
SELECT 'record_email_failure(text, int, text) exists and returns void',
       EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'record_email_failure'
           AND pg_get_function_identity_arguments(p.oid) = 'p_template text, p_status integer, p_reason text'
           AND pg_get_function_result(p.oid) = 'void'
       )
UNION ALL
SELECT 'email_failure_overview(uuid) exists and returns jsonb',
       EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'email_failure_overview'
           AND pg_get_function_identity_arguments(p.oid) = 'p_actor uuid'
           AND pg_get_function_result(p.oid) = 'jsonb'
       )
UNION ALL
SELECT 'purge_old_email_failures(int) exists and defaults to 30 days',
       EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'purge_old_email_failures'
           AND pg_get_function_identity_arguments(p.oid) = 'p_days integer'
           AND pg_get_function_arguments(p.oid) LIKE '%DEFAULT 30%'
       )
UNION ALL
SELECT 'the three functions are SECURITY DEFINER with an empty search_path',
       NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('record_email_failure', 'email_failure_overview', 'purge_old_email_failures')
           AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'])
       )
UNION ALL
SELECT 'no client role may execute any of the three functions',
       NOT has_function_privilege('anon', 'public.record_email_failure(text, int, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.record_email_failure(text, int, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.email_failure_overview(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.email_failure_overview(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.purge_old_email_failures(int)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.purge_old_email_failures(int)', 'EXECUTE')
UNION ALL
SELECT 'service_role may execute all three functions',
       has_function_privilege('service_role', 'public.record_email_failure(text, int, text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.email_failure_overview(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.purge_old_email_failures(int)', 'EXECUTE');
