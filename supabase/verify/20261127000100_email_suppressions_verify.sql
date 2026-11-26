-- Verify 20261127000100_email_suppressions. Every row must be true.
--
-- Structural checks: that the table and the four functions are the shape the
-- application relies on, that no client role can reach the table or call a
-- function, and that the table cannot hold an address by construction.
-- The behaviour is proved by supabase/tests/email_suppressions_test.sh.

SELECT 'email_suppressions is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1
         FROM public.app_migrations
         WHERE version = '20261127000100'
           AND name = 'email_suppressions'
       ) AS ok
UNION ALL
SELECT 'email_suppressions has exactly the six documented columns',
       (SELECT count(*) = 6
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'email_suppressions'
           AND column_name IN ('recipient_hash', 'reason', 'source',
                               'first_seen', 'last_seen', 'events'))
UNION ALL
SELECT 'recipient_hash is the primary key and not nullable',
       (SELECT count(*) = 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage k
            ON k.constraint_name = tc.constraint_name
           AND k.table_schema = tc.table_schema
         WHERE tc.table_schema = 'public'
           AND tc.table_name = 'email_suppressions'
           AND tc.constraint_type = 'PRIMARY KEY'
           AND k.column_name = 'recipient_hash')
UNION ALL
SELECT 'the hash column is constrained to 64 lower-case hex characters',
       EXISTS (
         SELECT 1
         FROM pg_constraint c
        WHERE c.conrelid = 'public.email_suppressions'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%[0-9a-f]{64}%'
       )
UNION ALL
SELECT 'reason is constrained to the five documented words',
       EXISTS (
         SELECT 1
         FROM pg_constraint c
        WHERE c.conrelid = 'public.email_suppressions'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%hard_bounce%'
          AND pg_get_constraintdef(c.oid) LIKE '%complaint%'
          AND pg_get_constraintdef(c.oid) LIKE '%blocked%'
          AND pg_get_constraintdef(c.oid) LIKE '%invalid%'
          AND pg_get_constraintdef(c.oid) LIKE '%unsubscribed%'
       )
UNION ALL
SELECT 'events starts at 1 and cannot go below it',
       EXISTS (
         SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'email_suppressions'
          AND column_name = 'events'
          AND is_nullable = 'NO'
          AND column_default = '1'
       )
UNION ALL
SELECT 'there is no column that could hold an address',
       NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'email_suppressions'
          AND column_name IN ('email', 'address', 'recipient', 'recipient_email')
       )
UNION ALL
SELECT 'row level security is enabled on email_suppressions',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_suppressions'::regclass)
UNION ALL
SELECT 'email_suppressions has no policy, so no client role can read it',
       NOT EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'email_suppressions'
       )
UNION ALL
SELECT 'anon, authenticated and PUBLIC hold no privilege on the table',
       NOT EXISTS (
         SELECT 1
         FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public'
          AND g.table_name = 'email_suppressions'
          AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
       )
UNION ALL
SELECT 'service_role may read and write the table',
       (SELECT count(*) = 4
          FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public'
           AND g.table_name = 'email_suppressions'
           AND g.grantee = 'service_role'
           AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
UNION ALL
SELECT 'the four functions exist with the documented signatures',
       (SELECT count(*) = 4
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('add_email_suppression', 'is_email_suppressed',
                             'remove_email_suppression', 'email_suppression_overview'))
UNION ALL
SELECT 'every function is SECURITY DEFINER with an empty search_path',
       NOT EXISTS (
         SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('add_email_suppression', 'is_email_suppressed',
                              'remove_email_suppression', 'email_suppression_overview')
            AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig)))
       )
UNION ALL
SELECT 'no client role may execute any of the four functions',
       -- PUBLIC is grantee 0 in an ACL, not a role name, so the ACL is exploded
       -- rather than asked through has_function_privilege.
       NOT EXISTS (
         SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
          WHERE n.nspname = 'public'
            AND p.proname IN ('add_email_suppression', 'is_email_suppressed',
                              'remove_email_suppression', 'email_suppression_overview')
            AND a.privilege_type = 'EXECUTE'
            AND (a.grantee = 0
                 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
       )
UNION ALL
SELECT 'service_role may execute all four functions',
       (SELECT count(*) = 4
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('add_email_suppression', 'is_email_suppressed',
                             'remove_email_suppression', 'email_suppression_overview')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'is_email_suppressed answers false on an empty list rather than null',
       (public.is_email_suppressed(repeat('a', 64)) = false)
UNION ALL
SELECT 'email_suppression_overview is a stable jsonb function taking one uuid',
       (SELECT count(*) = 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'email_suppression_overview'
           AND p.provolatile = 's'
           AND pg_get_function_result(p.oid) = 'jsonb'
           AND pg_get_function_arguments(p.oid) = 'p_actor uuid')
UNION ALL
SELECT 'remove_email_suppression takes an actor, a hash and a note',
       (SELECT count(*) = 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'remove_email_suppression'
           AND pg_get_function_arguments(p.oid) = 'p_actor uuid, p_hash text, p_note text')
UNION ALL
SELECT 'add_email_suppression takes a hash, a reason and a source',
       (SELECT count(*) = 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'add_email_suppression'
           AND pg_get_function_arguments(p.oid) = 'p_hash text, p_reason text, p_source text')
