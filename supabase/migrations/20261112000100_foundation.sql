-- ============================================================================
-- Migration 20261112000100_foundation
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  identity/role foundation, settings, settings history, audit log.
-- This file is idempotent: running it twice must not raise an error.
-- It does not create application tables (wallets, offers, payouts, ...).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extensions (installed into the extensions schema, referenced explicitly)
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 2. Migration ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_migrations (
  version    text        PRIMARY KEY,
  name       text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Enums
-- Enums cannot use IF NOT EXISTS, so each one is created inside a DO block
-- that first checks pg_type.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
  ) THEN
    CREATE TYPE public.app_role AS ENUM (
      'customer', 'affiliate', 'vendor', 'admin', 'finance', 'support', 'moderator'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'verification_level'
  ) THEN
    CREATE TYPE public.verification_level AS ENUM ('basic', 'verified', 'pro');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'account_status'
  ) THEN
    CREATE TYPE public.account_status AS ENUM ('active', 'suspended', 'deletion_pending');
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 4. Shared updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.profiles
-- One row per auth.users row, created by the signup trigger below.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                 uuid                     PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email              extensions.citext,
  first_name         text,
  last_name          text,
  display_name       text,
  phone              text,
  avatar_url         text,
  verification_level public.verification_level NOT NULL DEFAULT 'basic',
  status             public.account_status      NOT NULL DEFAULT 'active',
  created_at         timestamptz              NOT NULL DEFAULT now(),
  updated_at         timestamptz              NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on email. Lowered through ::text so the index
-- expression depends only on the immutable core lower(text) function.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_key
  ON public.profiles (lower((email)::text))
  WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. public.user_roles
-- A user may hold several roles; a role is revoked, not deleted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id    uuid           NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  status     text           NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'revoked')),
  created_at timestamptz    NOT NULL DEFAULT now(),
  granted_by uuid,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles (role);

-- ----------------------------------------------------------------------------
-- 7. auth.users triggers: bootstrap a profile + customer role on signup,
-- keep profiles.email in sync when the auth email changes.
--
-- Both functions are SECURITY DEFINER so they can write past RLS, and both
-- swallow their own errors: a failure here must never block a signup or an
-- email change. Problems surface as warnings in the Postgres logs instead.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
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

CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
     SET email = NEW.email
   WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'public.handle_user_email_change failed for user % : %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_email_change();

-- Trigger functions are not meant to be callable by clients.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_email_change() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Role helpers used by RLS policies
-- Only rows with status = 'active' grant a role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(uid uuid, r public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = has_role.uid
      AND ur.role = has_role.r
      AND ur.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = is_staff.uid
      AND ur.status = 'active'
      AND ur.role IN ('admin', 'finance', 'support', 'moderator')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9. public.settings + public.settings_history
-- Values are platform-wide configuration and are read by server code only.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  description text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings_history (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text        NOT NULL,
  old_value  jsonb,
  new_value  jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.log_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.settings_history (key, old_value, new_value, changed_by)
    VALUES (NEW.key, NULL, NEW.value, auth.uid());
  ELSE
    INSERT INTO public.settings_history (key, old_value, new_value, changed_by)
    VALUES (NEW.key, OLD.value, NEW.value, auth.uid());
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS settings_write_history ON public.settings;
CREATE TRIGGER settings_write_history
  AFTER INSERT OR UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_settings_change();

DROP TRIGGER IF EXISTS settings_set_updated_at ON public.settings;
CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON FUNCTION public.log_settings_change() FROM PUBLIC, anon, authenticated;

-- Seed values. These are placeholders pending owner decisions on pricing,
-- commission hold, attribution, refunds, withdrawals and VAT. They are not
-- approved commercial terms and must not be treated as final.
INSERT INTO public.settings (key, value, description) VALUES
  ('platform_fee_bps',      '1000'::jsonb,                        'Platform fee in basis points (placeholder: 10%).'),
  ('commission_hold_days',  '7'::jsonb,                           'Days a commission is held before release (placeholder).'),
  ('attribution_window_days','30'::jsonb,                         'Days an affiliate click is attributed (placeholder).'),
  ('refund_window_days',    '7'::jsonb,                           'Refund window in days (placeholder).'),
  ('min_withdrawal_kobo',   '500000'::jsonb,                      'Minimum withdrawal in kobo (placeholder: 5,000 NGN).'),
  ('vat_enabled',           'false'::jsonb,                       'Whether VAT is applied at all (placeholder).'),
  ('vat_rate_bps',          '750'::jsonb,                         'VAT rate in basis points (placeholder: 7.5%).'),
  ('vat_applies_to',        '"platform_fee"'::jsonb,              'What VAT applies to (placeholder).'),
  ('prices_include_vat',    'false'::jsonb,                       'Whether listed prices already include VAT (placeholder).')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 10. public.audit_log (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid,
  action      text        NOT NULL,
  entity_type text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at);

CREATE OR REPLACE FUNCTION public.audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'public.audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update_or_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_block_mutation();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_log_block_mutation();

REVOKE ALL ON FUNCTION public.audit_log_block_mutation() FROM PUBLIC, anon, authenticated;

-- Strip mutating privileges from every role except postgres. The DO block
-- covers Supabase's built-in roles (anon, authenticated, service_role, ...)
-- without hard-coding a list, and is a no-op when nothing is granted.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname <> 'postgres'
      AND rolname NOT LIKE 'pg\_%'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM %I', r.rolname);
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- 11. Row level security on every table created by this migration
-- ----------------------------------------------------------------------------
ALTER TABLE public.app_migrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 12. Privileges and policies
-- Pattern: revoke everything from clients, then grant only what is listed.
-- Policies use (select auth.uid()) so the lookup is evaluated once per query.
-- ----------------------------------------------------------------------------

-- app_migrations: server-only. No grants and no policies for clients.
REVOKE ALL ON TABLE public.app_migrations FROM PUBLIC, anon, authenticated;

-- profiles
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
-- Only these five columns may be edited by the user themselves. No INSERT or
-- DELETE: rows are created and removed by the auth.users cascade only.
GRANT UPDATE (first_name, last_name, display_name, phone, avatar_url)
  ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS profiles_select_staff ON public.profiles;
CREATE POLICY profiles_select_staff
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- user_roles: read-only for clients, written by the service role.
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;

DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_roles_select_staff ON public.user_roles;
CREATE POLICY user_roles_select_staff
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- settings: staff read; admin and finance write. No DELETE for clients.
REVOKE ALL ON TABLE public.settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.settings TO authenticated;

DROP POLICY IF EXISTS settings_select_staff ON public.settings;
CREATE POLICY settings_select_staff
  ON public.settings
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

DROP POLICY IF EXISTS settings_insert_admin_finance ON public.settings;
CREATE POLICY settings_insert_admin_finance
  ON public.settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS settings_update_admin_finance ON public.settings;
CREATE POLICY settings_update_admin_finance
  ON public.settings
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  )
  WITH CHECK (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

-- settings_history: staff read only. Rows are written by the SECURITY DEFINER
-- trigger on public.settings.
REVOKE ALL ON TABLE public.settings_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.settings_history TO authenticated;

DROP POLICY IF EXISTS settings_history_select_staff ON public.settings_history;
CREATE POLICY settings_history_select_staff
  ON public.settings_history
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- audit_log: staff read only. Writes come from the service role.
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_log TO authenticated;

DROP POLICY IF EXISTS audit_log_select_staff ON public.audit_log;
CREATE POLICY audit_log_select_staff
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- Identity sequences: clients have no business reading or advancing them.
REVOKE ALL ON SEQUENCE public.settings_history_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.settings_history_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;

-- ----------------------------------------------------------------------------
-- 13. Server role (service_role) privileges
-- Server code uses the service key. These grants are explicit so they do not
-- depend on Supabase's default privileges for new tables.
-- service_role deliberately gets no UPDATE, DELETE or TRUNCATE on audit_log:
-- that table stays append-only for every role except postgres.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON TABLE
  public.app_migrations,
  public.profiles,
  public.user_roles,
  public.settings,
  public.settings_history
TO service_role;

GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

-- ----------------------------------------------------------------------------
-- 14. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261112000100', 'foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops every object this migration created, and all data in them.
-- The citext and pg_trgm extensions are deliberately not dropped, because other
-- migrations may depend on them.
-- ============================================================================
--
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP TRIGGER IF EXISTS settings_set_updated_at ON public.settings;
--
-- DROP POLICY IF EXISTS audit_log_select_staff ON public.audit_log;
-- DROP POLICY IF EXISTS settings_history_select_staff ON public.settings_history;
-- DROP POLICY IF EXISTS settings_update_admin_finance ON public.settings;
-- DROP POLICY IF EXISTS settings_insert_admin_finance ON public.settings;
-- DROP POLICY IF EXISTS settings_select_staff ON public.settings;
-- DROP POLICY IF EXISTS user_roles_select_staff ON public.user_roles;
-- DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
-- DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
-- DROP POLICY IF EXISTS profiles_select_staff ON public.profiles;
-- DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
--
-- DROP TABLE IF EXISTS public.audit_log;
-- DROP TABLE IF EXISTS public.settings_history;
-- DROP TABLE IF EXISTS public.settings;
-- DROP TABLE IF EXISTS public.user_roles;
-- DROP TABLE IF EXISTS public.profiles;
-- DROP TABLE IF EXISTS public.app_migrations;
--
-- DROP FUNCTION IF EXISTS public.audit_log_block_mutation();
-- DROP FUNCTION IF EXISTS public.log_settings_change();
-- DROP FUNCTION IF EXISTS public.is_staff(uuid);
-- DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
-- DROP FUNCTION IF EXISTS public.handle_user_email_change();
-- DROP FUNCTION IF EXISTS public.handle_new_user();
-- DROP FUNCTION IF EXISTS public.set_updated_at();
--
-- DROP TYPE IF EXISTS public.account_status;
-- DROP TYPE IF EXISTS public.verification_level;
-- DROP TYPE IF EXISTS public.app_role;
--
-- COMMIT;
