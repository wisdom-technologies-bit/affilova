-- Verify 20261121000100_policy_acceptance_fn. Every row must be true.

SELECT 'policy_acceptance_fn is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1
         FROM public.app_migrations
         WHERE version = '20261121000100'
           AND name = 'policy_acceptance_fn'
       ) AS ok
UNION ALL
SELECT 'policy_acceptances has row level security enabled',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.policy_acceptances'::regclass)
UNION ALL
SELECT 'record_policy_acceptance exists with expected signature',
       to_regprocedure('public.record_policy_acceptance(uuid, text, text, text)') IS NOT NULL
UNION ALL
SELECT 'record_policy_acceptance is SECURITY DEFINER with empty search_path',
       EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'record_policy_acceptance'
           AND p.prosecdef
           AND p.proconfig @> ARRAY['search_path=""']::text[]
       )
UNION ALL
SELECT 'PUBLIC, anon and authenticated cannot execute record_policy_acceptance',
       NOT has_function_privilege('public', 'public.record_policy_acceptance(uuid, text, text, text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.record_policy_acceptance(uuid, text, text, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.record_policy_acceptance(uuid, text, text, text)', 'EXECUTE')
UNION ALL
SELECT 'service_role can execute record_policy_acceptance',
       has_function_privilege('service_role', 'public.record_policy_acceptance(uuid, text, text, text)', 'EXECUTE');
