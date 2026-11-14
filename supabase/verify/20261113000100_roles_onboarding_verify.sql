-- ============================================================================
-- Verification for migration 20261113000100_roles_onboarding
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261113000100_roles_onboarding.sql has been applied to the
-- same project. Every statement returns a check_name and a boolean passed. The
-- migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The migration is recorded in the ledger.
SELECT
  'app_migrations_has_version' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261113000100' AND name = 'roles_onboarding'
  ) AS passed;

-- 2. is_reserved_handle is IMMUTABLE and has its search_path pinned to an empty
--    string, so every name inside it has to be schema qualified.
SELECT
  'is_reserved_handle_immutable_and_search_path' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_reserved_handle'
      AND p.provolatile = 'i'
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 3. The function actually answers: reserved words are caught in any case and
--    with surrounding spaces, a normal handle is not, and NULL is not reserved.
SELECT
  'is_reserved_handle_behaviour' AS check_name,
  public.is_reserved_handle('admin')
  AND public.is_reserved_handle('ADMIN')
  AND public.is_reserved_handle('  Support ')
  AND public.is_reserved_handle('sign-in')
  AND public.is_reserved_handle('sign-up')
  AND public.is_reserved_handle('undefined')
  AND NOT public.is_reserved_handle('shop-one')
  AND NOT public.is_reserved_handle(NULL) AS passed;

-- 4. The full reserved list is present in the function body. There are 36 words.
SELECT
  'is_reserved_handle_covers_the_list' AS check_name,
  (
    SELECT count(*) = 36
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL regexp_matches(
      pg_get_functiondef(p.oid),
      '''(admin|administrator|support|help|affilova|api|www|app|dashboard|merchant|account|login|signin|sign-in|signup|sign-up|register|auth|root|system|billing|payments|security|staff|moderator|finance|store|shop|blog|about|contact|terms|privacy|status|null|undefined)''',
      'g'
    ) AS m
    WHERE n.nspname = 'public' AND p.proname = 'is_reserved_handle'
  ) AS passed;

-- 5. public.policy_acceptances has the expected shape.
SELECT
  'policy_acceptances_shape' AS check_name,
  (
    SELECT count(*) = 6
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'policy_acceptances'
      AND column_name IN ('id', 'user_id', 'policy', 'version', 'accepted_at', 'ip_hash')
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.policy_acceptances'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(user_id, policy, version)%'
  ) AS passed;

-- 6. public.vendor_profiles has the expected shape.
SELECT
  'vendor_profiles_shape' AS check_name,
  (
    SELECT count(*) = 9
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendor_profiles'
      AND column_name IN (
        'user_id', 'business_name', 'slug', 'support_email', 'phone',
        'country', 'status', 'created_at', 'updated_at'
      )
  )
  AND (SELECT udt_name = 'citext' AND udt_schema = 'extensions'
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vendor_profiles'
         AND column_name = 'slug') AS passed;

-- 7. public.affiliate_profiles has the expected shape.
SELECT
  'affiliate_profiles_shape' AS check_name,
  (
    SELECT count(*) = 7
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_profiles'
      AND column_name IN (
        'user_id', 'username', 'promotion_channels', 'country', 'status',
        'created_at', 'updated_at'
      )
  )
  AND (SELECT udt_name = 'citext' AND udt_schema = 'extensions'
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'affiliate_profiles'
         AND column_name = 'username') AS passed;

-- 8. Row level security is on for all three tables.
SELECT
  'rls_enabled_on_all_three_tables' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('policy_acceptances', 'vendor_profiles', 'affiliate_profiles')
      AND c.relrowsecurity
  ) AS passed;

-- 9. anon holds no privilege on any of the three tables.
SELECT
  'anon_has_no_table_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('policy_acceptances', 'vendor_profiles', 'affiliate_profiles')
      AND grantee = 'anon'
  ) AS passed;

-- 10. A signed-in user cannot insert or delete rows in any of them.
SELECT
  'authenticated_has_no_insert_or_delete' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('policy_acceptances', 'vendor_profiles', 'affiliate_profiles')
      AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'DELETE')
  ) AS passed;

-- 11. A vendor owner may update exactly business_name, support_email and phone.
SELECT
  'vendor_owner_update_columns' AS check_name,
  (
    SELECT array_agg(column_name::text ORDER BY column_name::text)
           = ARRAY['business_name', 'phone', 'support_email']::text[]
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'vendor_profiles'
      AND grantee = 'authenticated'
      AND privilege_type = 'UPDATE'
  ) AS passed;

-- 12. An affiliate owner may update promotion_channels only.
SELECT
  'affiliate_owner_update_columns' AS check_name,
  (
    SELECT array_agg(column_name::text ORDER BY column_name::text)
           = ARRAY['promotion_channels']::text[]
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'affiliate_profiles'
      AND grantee = 'authenticated'
      AND privilege_type = 'UPDATE'
  ) AS passed;

-- 13. service_role has full access to the three tables.
SELECT
  'service_role_has_full_access' AS check_name,
  (
    SELECT count(*) = 3
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('policy_acceptances', 'vendor_profiles', 'affiliate_profiles')
      AND grantee = 'service_role'
      AND privilege_type = 'INSERT'
  )
  AND (
    SELECT count(*) = 3
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('policy_acceptances', 'vendor_profiles', 'affiliate_profiles')
      AND grantee = 'service_role'
      AND privilege_type = 'DELETE'
  ) AS passed;

-- 14. vendor_profiles has an own-row read, a staff read and an own-row update
--     policy.
SELECT
  'vendor_profiles_policies' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendor_profiles'
  )
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'vendor_profiles'
                AND policyname = 'vendor_profiles_select_own' AND cmd = 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'vendor_profiles'
                AND policyname = 'vendor_profiles_select_staff' AND cmd = 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'vendor_profiles'
                AND policyname = 'vendor_profiles_update_own' AND cmd = 'UPDATE') AS passed;

-- 15. affiliate_profiles has the same three policies.
SELECT
  'affiliate_profiles_policies' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_profiles'
  )
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'affiliate_profiles'
                AND policyname = 'affiliate_profiles_select_own' AND cmd = 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'affiliate_profiles'
                AND policyname = 'affiliate_profiles_select_staff' AND cmd = 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'affiliate_profiles'
                AND policyname = 'affiliate_profiles_update_own' AND cmd = 'UPDATE') AS passed;

-- 16. policy_acceptances is readable by its owner and by staff, and writable by
--     no client.
SELECT
  'policy_acceptances_policies' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'policy_acceptances'
  )
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'policy_acceptances'
                AND policyname = 'policy_acceptances_select_own' AND cmd = 'SELECT')
  AND EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'policy_acceptances'
                AND policyname = 'policy_acceptances_select_staff' AND cmd = 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'policy_acceptances'
                    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) AS passed;

-- 17. become_vendor is SECURITY DEFINER with search_path pinned to an empty
--     string.
SELECT
  'become_vendor_secure_definition' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'become_vendor'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 18. become_affiliate is the same.
SELECT
  'become_affiliate_secure_definition' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'become_affiliate'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 19. Neither function is executable by PUBLIC, anon or authenticated, and both
--     are executable by service_role.
SELECT
  'become_functions_are_server_only' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public'
      AND p.proname IN ('become_vendor', 'become_affiliate')
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.become_vendor(uuid, text, text, text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege(
    'authenticated', 'public.become_vendor(uuid, text, text, text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege(
    'anon', 'public.become_affiliate(uuid, text, text[], text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege(
    'authenticated', 'public.become_affiliate(uuid, text, text[], text, text, text)', 'EXECUTE')
  AND has_function_privilege(
    'service_role', 'public.become_vendor(uuid, text, text, text, text, text, text, text)', 'EXECUTE')
  AND has_function_privilege(
    'service_role', 'public.become_affiliate(uuid, text, text[], text, text, text)', 'EXECUTE') AS passed;

-- 20. is_reserved_handle stays callable by a signed-in user, because the form
--     helper mirrors it and the app may re-check there.
SELECT
  'is_reserved_handle_callable_by_authenticated' AS check_name,
  has_function_privilege('authenticated', 'public.is_reserved_handle(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.is_reserved_handle(text)', 'EXECUTE') AS passed;

-- 21. The slug and the username are unique.
SELECT
  'slug_and_username_are_unique' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (x.indkey)
    WHERE c.relname IN ('vendor_profiles', 'affiliate_profiles')
      AND x.indisunique
      AND a.attname IN ('slug', 'username')
  ) AS passed;

-- 22. Both patterns match on the text value, so they stay case sensitive
--     whatever the search_path of the session that created the table.
SELECT
  'patterns_match_the_text_value' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_constraint c
    WHERE c.conrelid IN ('public.vendor_profiles'::regclass, 'public.affiliate_profiles'::regclass)
      AND c.contype = 'c'
      AND (
        pg_get_constraintdef(c.oid) LIKE '%(slug)::text ~ %'
        OR pg_get_constraintdef(c.oid) LIKE '%(username)::text ~ %'
      )
  ) AS passed;

-- 23. Both tables refuse a reserved handle in a CHECK, not only in the form.
SELECT
  'reserved_handle_check_present' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_constraint c
    WHERE c.conrelid IN ('public.vendor_profiles'::regclass, 'public.affiliate_profiles'::regclass)
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%is_reserved_handle%'
  ) AS passed;

-- 24. The status column only accepts active or suspended.
SELECT
  'status_values_are_checked' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_constraint c
    WHERE c.conrelid IN ('public.vendor_profiles'::regclass, 'public.affiliate_profiles'::regclass)
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%active%'
      AND pg_get_constraintdef(c.oid) LIKE '%suspended%'
  ) AS passed;

-- 25. Both updated_at triggers are in place.
SELECT
  'updated_at_triggers_present' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal
      AND c.relname IN ('vendor_profiles', 'affiliate_profiles')
      AND tg.tgname IN ('vendor_profiles_set_updated_at', 'affiliate_profiles_set_updated_at')
  ) AS passed;

-- 26. become_vendor writes the role, both acceptances and the audit entry.
SELECT
  'become_vendor_writes_role_policies_and_audit' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%public.user_roles%'
       AND pg_get_functiondef(p.oid) LIKE '%public.policy_acceptances%'
       AND pg_get_functiondef(p.oid) LIKE '%terms_of_service%'
       AND pg_get_functiondef(p.oid) LIKE '%privacy_policy%'
       AND pg_get_functiondef(p.oid) LIKE '%public.audit_log%'
       AND pg_get_functiondef(p.oid) LIKE '%role.vendor.granted%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'become_vendor'
  ) AS passed;

-- 27. become_affiliate does the same, with its own audit action.
SELECT
  'become_affiliate_writes_role_policies_and_audit' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%public.user_roles%'
       AND pg_get_functiondef(p.oid) LIKE '%public.policy_acceptances%'
       AND pg_get_functiondef(p.oid) LIKE '%public.audit_log%'
       AND pg_get_functiondef(p.oid) LIKE '%role.affiliate.granted%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'become_affiliate'
  ) AS passed;

-- 28. Both functions refuse an inactive profile and return created:false for a
--     user who already has the row.
SELECT
  'become_functions_are_idempotent_and_gated' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('become_vendor', 'become_affiliate')
      AND pg_get_functiondef(p.oid) LIKE '%profile_not_active%'
      AND pg_get_functiondef(p.oid) LIKE '%''created'', false%'
      AND pg_get_functiondef(p.oid) LIKE '%''created'', true%'
  ) AS passed;

-- 29. The identity sequence behind policy_acceptances is server-only.
SELECT
  'policy_acceptances_sequence_is_server_only' AS check_name,
  has_sequence_privilege('service_role', 'public.policy_acceptances_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.policy_acceptances_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('anon', 'public.policy_acceptances_id_seq', 'USAGE') AS passed;
