-- ============================================================================
-- Verification for migration 20261112000300_profile_names_from_metadata
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000300_profile_names_from_metadata.sql has been applied
-- to the same project. Every statement returns a check_name and a boolean
-- passed. The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The migration is recorded in the ledger.
SELECT
  'app_migrations_has_version' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261112000300' AND name = 'profile_names_from_metadata'
  ) AS passed;

-- 2. The handler is still SECURITY DEFINER with search_path pinned to an empty
--    string, so every name inside it has to be schema qualified.
SELECT
  'handle_new_user_security_definer_and_search_path' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 3. The signup trigger still calls it.
SELECT
  'signup_trigger_points_at_handler' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND tg.tgname = 'on_auth_user_created'
      AND NOT tg.tgisinternal
      AND p.proname = 'handle_new_user'
  ) AS passed;

-- 4. The handler reads the two name keys out of the sign-up metadata.
SELECT
  'handler_reads_name_metadata' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%raw_user_meta_data%'
       AND pg_get_functiondef(p.oid) LIKE '%''first_name''%'
       AND pg_get_functiondef(p.oid) LIKE '%''last_name''%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 5. The three name columns are filled in, display_name included.
SELECT
  'handler_fills_name_columns' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.profiles%first_name%last_name%display_name%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 6. Values are sanitised before they are stored: control characters removed,
--    trimmed, and cut to 100 characters.
SELECT
  'handler_sanitises_names' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%regexp_replace%[[:cntrl:]]%'
       AND pg_get_functiondef(p.oid) LIKE '%btrim%'
       AND pg_get_functiondef(p.oid) LIKE '%left(%, 100)%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 7. A metadata value that is not a JSON string is skipped rather than cast,
--    which is what keeps a number or an object from raising.
SELECT
  'handler_type_checks_metadata' AS check_name,
  (
    SELECT (pg_get_functiondef(p.oid) LIKE '%jsonb_typeof%')
       AND (pg_get_functiondef(p.oid) LIKE '%''object''%')
       AND (pg_get_functiondef(p.oid) LIKE '%''string''%')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 8. Both inserts still use ON CONFLICT DO NOTHING, so a replayed signup cannot
--    raise a duplicate key error.
SELECT
  'handler_keeps_on_conflict_do_nothing' AS check_name,
  (
    SELECT (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'ON CONFLICT', ''))) / length('ON CONFLICT') = 2
       AND pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (id) DO NOTHING%'
       AND pg_get_functiondef(p.oid) LIKE '%ON CONFLICT (user_id, role) DO NOTHING%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 9. Every new user still gets the customer role.
SELECT
  'handler_keeps_customer_role' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%public.user_roles%'
       AND pg_get_functiondef(p.oid) LIKE '%''customer''%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 10. The handler still swallows its own errors, so a failure can never block a
--     signup, and it still returns NEW so the insert on auth.users completes.
SELECT
  'handler_swallows_errors' AS check_name,
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%EXCEPTION%'
       AND pg_get_functiondef(p.oid) LIKE '%WHEN OTHERS THEN%'
       AND pg_get_functiondef(p.oid) LIKE '%RETURN NEW%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) AS passed;

-- 11. No client role may call it.
SELECT
  'handler_closed_to_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) AS passed;

-- 12. The three name columns the handler writes to exist and are text.
SELECT
  'profile_name_columns_present' AS check_name,
  (
    SELECT count(*) = 3
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN ('first_name', 'last_name', 'display_name')
      AND data_type = 'text'
  ) AS passed;

-- 13. Row level security is still on for profiles, so the new values stay
--     readable only through the policies from the foundation migration.
SELECT
  'profiles_rls_still_enabled' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND c.relrowsecurity
  ) AS passed;
