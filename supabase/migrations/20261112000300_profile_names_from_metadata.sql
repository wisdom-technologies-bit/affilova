-- ============================================================================
-- Migration 20261112000300_profile_names_from_metadata
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  public.handle_new_user() only. The signup trigger now copies the
--         first and last name from the sign-up metadata into public.profiles and
--         derives display_name from them.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql: public.profiles, public.user_roles,
-- the auth.users trigger and the previous version of public.handle_new_user().
--
-- Why: app/auth/actions.ts sends { data: { first_name, last_name } } to
-- supabase.auth.signUp. It lands in auth.users.raw_user_meta_data, which is
-- client-supplied, so everything read from it is treated as untrusted text.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.handle_new_user(), now with names
--
-- Still SECURITY DEFINER with an empty search_path (so every name inside must
-- be schema qualified), still ON CONFLICT DO NOTHING, still inserts the
-- customer role, and still swallows every error: a problem here must never
-- block a signup. It only ever reads JSON strings from the metadata, so a
-- number, an object or an array under those keys leaves the name empty instead
-- of raising.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta         jsonb;
  first_name   text;
  last_name    text;
  display_name text;
BEGIN
  -- raw_user_meta_data is nullable and is not guaranteed to be an object.
  meta := CASE
            WHEN jsonb_typeof(NEW.raw_user_meta_data) = 'object'
              THEN NEW.raw_user_meta_data
            ELSE '{}'::jsonb
          END;

  IF jsonb_typeof(meta -> 'first_name') = 'string' THEN
    first_name := meta ->> 'first_name';
  END IF;

  IF jsonb_typeof(meta -> 'last_name') = 'string' THEN
    last_name := meta ->> 'last_name';
  END IF;

  -- Sanitise: drop control characters, trim, cut to 100 characters, trim again
  -- (the cut can leave a trailing space) and store an empty result as NULL.
  -- Each step passes NULL straight through, so a missing key stays missing.
  first_name := btrim(left(btrim(regexp_replace(first_name, '[[:cntrl:]]', '', 'g')), 100));
  last_name  := btrim(left(btrim(regexp_replace(last_name,  '[[:cntrl:]]', '', 'g')), 100));

  first_name := nullif(first_name, '');
  last_name  := nullif(last_name, '');

  -- "First Last", or just one of them, or NULL when both are empty.
  -- concat_ws skips NULL arguments.
  display_name := nullif(btrim(concat_ws(' ', first_name, last_name)), '');

  INSERT INTO public.profiles (id, email, first_name, last_name, display_name)
  VALUES (NEW.id, NEW.email, first_name, last_name, display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'public.handle_new_user failed for user % : %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- CREATE OR REPLACE keeps the existing privileges, so this is a no-op on a
-- database where the foundation migration already ran. It is repeated so the
-- function is closed to clients even if its privileges were changed by hand.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261112000300', 'profile_names_from_metadata')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- It restores the previous version of public.handle_new_user(), which fills in
-- the email and the customer role only and leaves the three name columns empty
-- for future signups. Existing profile rows are not touched: names already
-- copied into public.profiles stay there, and no data is deleted.
-- ============================================================================
--
-- BEGIN;
--
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $$
-- BEGIN
--   INSERT INTO public.profiles (id, email)
--   VALUES (NEW.id, NEW.email)
--   ON CONFLICT (id) DO NOTHING;
--
--   INSERT INTO public.user_roles (user_id, role)
--   VALUES (NEW.id, 'customer')
--   ON CONFLICT (user_id, role) DO NOTHING;
--
--   RETURN NEW;
-- EXCEPTION
--   WHEN OTHERS THEN
--     RAISE WARNING 'public.handle_new_user failed for user % : %', NEW.id, SQLERRM;
--     RETURN NEW;
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
--
-- DELETE FROM public.app_migrations WHERE version = '20261112000300';
--
-- COMMIT;
