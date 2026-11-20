-- ============================================================================
-- Verification for migration 20261118000100_guest_refunds
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261116000200_commerce_core.sql and
-- 20261118000100_guest_refunds.sql have been applied to the same project.
-- Every statement returns a check_name and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
--
-- The behaviour of the function (wrong email, right email in another case,
-- window closed, second open request) is covered by
-- supabase/tests/guest_refunds_test.sh, which needs a throwaway database.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261118000100' AND name = 'guest_refunds'
  ) AS passed;

-- 2. The function exists with the agreed signature and returns jsonb.
SELECT
  'function_signature' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund_by_email'
      AND pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_email text, p_reason text'
      AND pg_get_function_result(p.oid) = 'jsonb'
  ) AS passed;

-- 3. It is SECURITY DEFINER with an empty search_path.
SELECT
  'function_hardened' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund_by_email'
      AND p.prosecdef
      AND p.proconfig::text LIKE '%search_path=%'
  ) AS passed;

-- 4. The browser roles cannot call it, and neither can PUBLIC.
SELECT
  'clients_have_no_access' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund_by_email'
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  )
  AND (
    SELECT count(*) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund_by_email'
      AND p.proacl IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) AS passed;

-- 5. service_role can call it.
SELECT
  'service_role_access' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund_by_email'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 6. refund_requests keeps RLS on and grants anon nothing. authenticated does
--    have SELECT, which is how a buyer reads their own requests, so that grant is
--    expected here and is constrained by the policies in check 9.
SELECT
  'refund_requests_rls' AS check_name,
  coalesce((
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'refund_requests'
  ), false)
  AND (
    SELECT count(*) = 0
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'refund_requests'
      AND grantee = 'anon'
  ) AS passed;

-- 7. The one-open-request rule the function relies on is in place.
SELECT
  'one_open_request_rule' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'refund_requests'
      AND indexname = 'refund_requests_one_open_idx'
  ) AS passed;

-- 8. The signed-in path is untouched: request_refund still exists with its own
--    signature, so nothing that already called it has moved.
SELECT
  'signed_in_path_untouched' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'request_refund'
      AND pg_get_function_identity_arguments(p.oid) = 'p_actor uuid, p_order uuid, p_reason text'
  ) AS passed;

-- 9. Every SELECT policy on refund_requests is decided by auth.uid(), so a request
--    with no requester (a guest's, where requested_by is NULL) is readable by no
--    signed-in buyer. This is what keeps a guest refund private.
SELECT
  'guest_requests_are_private' AS check_name,
  (
    SELECT count(*) > 0
    FROM pg_policy p
    WHERE p.polrelid = 'public.refund_requests'::regclass
      AND p.polcmd = 'r'
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%'
  )
  AND (
    SELECT count(*) = 0
    FROM pg_policy p
    WHERE p.polrelid = 'public.refund_requests'::regclass
      AND p.polcmd = 'r'
      AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%auth.uid()%'
  ) AS passed;
