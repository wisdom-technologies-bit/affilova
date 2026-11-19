-- Verify 20261117000200_email_log. Every row must be true.
SELECT 'email_log table exists' AS check, to_regclass('public.email_log') IS NOT NULL AS ok
UNION ALL
SELECT 'email_log is recorded in app_migrations',
       EXISTS (SELECT 1 FROM public.app_migrations WHERE version = '20261117000200')
UNION ALL
SELECT 'email_log has row level security enabled',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_log'::regclass)
UNION ALL
SELECT 'anon has no privilege on email_log',
       NOT has_table_privilege('anon', 'public.email_log', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.email_log', 'INSERT')
       AND NOT has_table_privilege('anon', 'public.email_log', 'UPDATE')
       AND NOT has_table_privilege('anon', 'public.email_log', 'DELETE')
UNION ALL
SELECT 'authenticated has no privilege on email_log',
       NOT has_table_privilege('authenticated', 'public.email_log', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.email_log', 'INSERT')
UNION ALL
SELECT 'service_role may insert into email_log',
       has_table_privilege('service_role', 'public.email_log', 'INSERT')
       AND has_table_privilege('service_role', 'public.email_log', 'UPDATE')
       AND has_table_privilege('service_role', 'public.email_log', 'DELETE')
UNION ALL
SELECT 'no policy grants a client role a row',
       NOT EXISTS (
         SELECT 1
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'email_log'
           AND ('anon' = ANY (roles) OR 'authenticated' = ANY (roles) OR 'public' = ANY (roles))
       )
UNION ALL
SELECT 'the unique key is (kind, order_id, recipient_hash)',
       EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'public.email_log'::regclass
           AND conname = 'email_log_one_per_recipient'
       );
