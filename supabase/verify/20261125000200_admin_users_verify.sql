-- Verify 20261125000200_admin_users. Every row must be true.

SELECT 'admin_users is recorded in app_migrations' AS check,
       EXISTS (
         SELECT 1
         FROM public.app_migrations
         WHERE version = '20261125000200'
           AND name = 'admin_users'
       ) AS ok
UNION ALL
SELECT 'admin_list_users exists with expected signature',
       to_regprocedure('public.admin_list_users(text, public.account_status, public.app_role, integer, integer)') IS NOT NULL
UNION ALL
SELECT 'admin_get_user exists with expected signature',
       to_regprocedure('public.admin_get_user(uuid)') IS NOT NULL
UNION ALL
SELECT 'admin_grant_staff_role exists with expected signature',
       to_regprocedure('public.admin_grant_staff_role(uuid, public.app_role, uuid)') IS NOT NULL
UNION ALL
SELECT 'admin_revoke_staff_role exists with expected signature',
       to_regprocedure('public.admin_revoke_staff_role(uuid, public.app_role, uuid)') IS NOT NULL
UNION ALL
SELECT 'admin_set_user_status exists with expected signature',
       to_regprocedure('public.admin_set_user_status(uuid, public.account_status, uuid)') IS NOT NULL
UNION ALL
SELECT 'admin_set_verification_level exists with expected signature',
       to_regprocedure('public.admin_set_verification_level(uuid, public.verification_level, uuid)') IS NOT NULL
UNION ALL
SELECT 'every admin function is SECURITY DEFINER with an empty search_path',
       NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'is_staff_role',
             'admin_list_users',
             'admin_get_user',
             'assert_admin_actor',
             'assert_not_last_admin',
             'admin_grant_staff_role',
             'admin_revoke_staff_role',
             'admin_set_user_status',
             'admin_set_verification_level'
           )
           AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[])
       )
UNION ALL
SELECT 'PUBLIC, anon and authenticated cannot execute any admin function',
       NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'admin_list_users',
             'admin_get_user',
             'admin_grant_staff_role',
             'admin_revoke_staff_role',
             'admin_set_user_status',
             'admin_set_verification_level'
           )
           AND (
             has_function_privilege('public', p.oid, 'EXECUTE')
             OR has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
           )
       )
UNION ALL
SELECT 'service_role can execute every admin function',
       has_function_privilege('service_role', 'public.admin_list_users(text, public.account_status, public.app_role, integer, integer)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.admin_get_user(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.admin_grant_staff_role(uuid, public.app_role, uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.admin_revoke_staff_role(uuid, public.app_role, uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.admin_set_user_status(uuid, public.account_status, uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.admin_set_verification_level(uuid, public.verification_level, uuid)', 'EXECUTE')
UNION ALL
SELECT 'the active staff role index exists',
       to_regclass('public.user_roles_active_role_idx') IS NOT NULL
UNION ALL
SELECT 'the active staff role index is partial on status = active',
       EXISTS (
         SELECT 1
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.oid = to_regclass('public.user_roles_active_role_idx')
           AND pg_get_expr(i.indpred, i.indrelid) LIKE '%status%'
       );
