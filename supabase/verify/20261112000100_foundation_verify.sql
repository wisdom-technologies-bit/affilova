-- ============================================================================
-- Verification for migration 20261112000100_foundation
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql has been applied to the same
-- project. Every statement returns a check_name and a boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. All expected tables exist in public.
SELECT
  'tables_exist' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'app_migrations', 'profiles', 'user_roles',
        'settings', 'settings_history', 'audit_log'
      )
  ) AS passed;

-- 2. Row level security is enabled on every table in the migration.
SELECT
  'rls_enabled_every_table' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('app_migrations'), ('profiles'), ('user_roles'),
      ('settings'), ('settings_history'), ('audit_log')
    ) AS t(tbl)
    JOIN pg_class c ON c.relname = t.tbl
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relrowsecurity = false
  ) AS passed;

-- 3. Expected number of policies per table.
SELECT
  'policy_counts_match' AS check_name,
  bool_and(coalesce(a.policy_count, 0) = e.policy_count) AS passed
FROM (VALUES
  ('app_migrations', 0),
  ('profiles', 3),
  ('user_roles', 2),
  ('settings', 3),
  ('settings_history', 1),
  ('audit_log', 1)
) AS e(tbl, policy_count)
LEFT JOIN (
  SELECT tablename, count(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) AS a ON a.tablename = e.tbl;

-- 4. No policy targets anon or the implicit PUBLIC role.
SELECT
  'no_policies_grant_to_anon_or_public' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) AS passed;

-- 5. app_role enum labels and order.
SELECT
  'enum_app_role_labels' AS check_name,
  coalesce(
    (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'app_role'
    ) = ARRAY['customer', 'affiliate', 'vendor', 'admin', 'finance', 'support', 'moderator'],
    false
  ) AS passed;

-- 6. verification_level enum labels and order.
SELECT
  'enum_verification_level_labels' AS check_name,
  coalesce(
    (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'verification_level'
    ) = ARRAY['basic', 'verified', 'pro'],
    false
  ) AS passed;

-- 7. account_status enum labels and order.
SELECT
  'enum_account_status_labels' AS check_name,
  coalesce(
    (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'account_status'
    ) = ARRAY['active', 'suspended', 'deletion_pending'],
    false
  ) AS passed;

-- 8. Both extensions are installed in the extensions schema.
SELECT
  'extensions_in_extensions_schema' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname IN ('citext', 'pg_trgm') AND n.nspname = 'extensions'
  ) AS passed;

-- 9. Case-insensitive email unique index exists.
SELECT
  'profiles_email_unique_index' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND indexname = 'profiles_email_lower_key'
  ) AS passed;

-- 10. Authenticated may only UPDATE the five profile columns.
SELECT
  'profiles_update_grants_limited' AS check_name,
  coalesce(
    (
      SELECT array_agg(column_name::text ORDER BY column_name)
      FROM information_schema.column_privileges
      WHERE grantee = 'authenticated'
        AND table_schema = 'public'
        AND table_name = 'profiles'
        AND privilege_type = 'UPDATE'
    ) = ARRAY['avatar_url', 'display_name', 'first_name', 'last_name', 'phone'],
    false
  ) AS passed;

-- 11. Authenticated cannot INSERT or DELETE profiles.
SELECT
  'profiles_no_client_insert_delete' AS check_name,
  NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE') AS passed;

-- 12. Authenticated cannot DELETE settings.
SELECT
  'settings_no_client_delete' AS check_name,
  NOT has_table_privilege('authenticated', 'public.settings', 'DELETE') AS passed;

-- 13. client roles only have SELECT on audit_log (append-only).
SELECT
  'audit_log_read_only_for_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
    CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
    WHERE has_table_privilege(r.role_name, 'public.audit_log', p.priv)
  ) AS passed;

-- 14. audit_log guards exist (row-level update/delete guard + truncate guard).
SELECT
  'audit_log_guard_triggers_exist' AS check_name,
  (
    SELECT count(*) = 2
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_log'
      AND NOT tg.tgisinternal
      AND tg.tgname IN ('audit_log_no_update_or_delete', 'audit_log_no_truncate')
  ) AS passed;

-- 15. Signup trigger exists on auth.users.
SELECT
  'auth_users_signup_trigger' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND NOT tg.tgisinternal
      AND tg.tgname = 'on_auth_user_created'
  ) AS passed;

-- 16. Email change trigger exists on auth.users.
SELECT
  'auth_users_email_change_trigger' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND NOT tg.tgisinternal
      AND tg.tgname = 'on_auth_user_email_changed'
  ) AS passed;

-- 17. public.has_role(uuid, public.app_role) exists, is STABLE and SECURITY DEFINER.
SELECT
  'has_role_security_definer' AS check_name,
  coalesce(
    (
      SELECT bool_and(p.prosecdef AND p.provolatile = 's')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'has_role'
        AND replace(pg_get_function_identity_arguments(p.oid), 'public.', '') = 'uid uuid, r app_role'
    ),
    false
  ) AS passed;

-- 18. public.is_staff(uuid) exists, is STABLE and SECURITY DEFINER.
SELECT
  'is_staff_security_definer' AS check_name,
  coalesce(
    (
      SELECT bool_and(p.prosecdef AND p.provolatile = 's')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'is_staff'
        AND replace(pg_get_function_identity_arguments(p.oid), 'public.', '') = 'uid uuid'
    ),
    false
  ) AS passed;

-- 19. Role helpers: authenticated can execute, anon cannot.
SELECT
  'role_helpers_execute_grants' AS check_name,
  has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.is_staff(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.has_role(uuid, public.app_role)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.is_staff(uuid)', 'EXECUTE') AS passed;

-- 20. anon has no privileges on any table created by this migration.
SELECT
  'anon_has_no_table_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('app_migrations'), ('profiles'), ('user_roles'),
      ('settings'), ('settings_history'), ('audit_log')
    ) AS t(tbl)
    CROSS JOIN (VALUES
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS p(priv)
    WHERE has_table_privilege('anon', format('public.%I', t.tbl), p.priv)
  ) AS passed;

-- 21. anon holds no column-level privileges in public either.
SELECT
  'anon_has_no_column_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.column_privileges cp
    WHERE cp.grantee = 'anon'
      AND cp.table_schema = 'public'
      AND cp.table_name IN (
        'app_migrations', 'profiles', 'user_roles',
        'settings', 'settings_history', 'audit_log'
      )
  ) AS passed;

-- 22. The nine settings keys exist (values are placeholders, not checked here).
SELECT
  'settings_seed_keys_present' AS check_name,
  (
    SELECT count(*) = 9
    FROM public.settings
    WHERE key IN (
      'platform_fee_bps', 'commission_hold_days', 'attribution_window_days',
      'refund_window_days', 'min_withdrawal_kobo', 'vat_enabled',
      'vat_rate_bps', 'vat_applies_to', 'prices_include_vat'
    )
  ) AS passed;

-- 23. settings_history receives changes from the settings trigger.
SELECT
  'settings_history_trigger_exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'settings'
      AND NOT tg.tgisinternal
      AND tg.tgname = 'settings_write_history'
  ) AS passed;

-- 24. The migration is recorded in the ledger.
SELECT
  'app_migrations_has_version' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261112000100' AND name = 'foundation'
  ) AS passed;
