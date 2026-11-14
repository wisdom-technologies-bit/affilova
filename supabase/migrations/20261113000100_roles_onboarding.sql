-- ============================================================================
-- Migration 20261113000100_roles_onboarding
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the two role profile tables (vendor_profiles, affiliate_profiles), the
--         policy acceptance record, the reserved handle list, the owner column
--         privileges behind them, and the two SECURITY DEFINER functions that
--         are the only way a role is granted.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql: public.profiles, public.user_roles,
-- public.audit_log, public.set_updated_at(), public.is_staff(), the app_role
-- enum and the citext extension in the extensions schema.
--
-- Onboarding is not a client write. A signed-in user can read their own row and
-- edit a short list of columns on it, but the row itself is created by
-- public.become_vendor() / public.become_affiliate(), which also grant the role,
-- record the policy acceptance and write the audit entry in the same
-- transaction. The slug and the username are never writable by the owner, so an
-- owner cannot take an address after the fact.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.is_reserved_handle(text)
--
-- True for a handle that must not be handed to a user: a path the app already
-- serves, a word that would look official, or a value that reads as a missing
-- field. Matched case-insensitively on the trimmed value, so " Admin " is
-- reserved too. IMMUTABLE, so it is safe in an index expression and in a CHECK.
--
-- lib/identity/reserved-handles.ts carries the same list so the form can reject
-- a handle before it is sent. A test asserts the two lists match.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_reserved_handle(h text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    pg_catalog.lower(pg_catalog.btrim(h)) = ANY (
      ARRAY[
        'admin', 'administrator', 'support', 'help', 'affilova', 'api', 'www',
        'app', 'dashboard', 'merchant', 'account', 'login', 'signin', 'sign-in',
        'signup', 'sign-up', 'register', 'auth', 'root', 'system', 'billing',
        'payments', 'security', 'staff', 'moderator', 'finance', 'store', 'shop',
        'blog', 'about', 'contact', 'terms', 'privacy', 'status', 'null',
        'undefined'
      ]::text[]
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_reserved_handle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_reserved_handle(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. public.policy_acceptances
-- One row per (user, policy, version). Written only by the become_* functions,
-- so the acceptance always travels with the role it belongs to.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_acceptances (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  policy      text        NOT NULL,
  version     text        NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_hash     text,
  UNIQUE (user_id, policy, version)
);

CREATE INDEX IF NOT EXISTS policy_acceptances_user_idx
  ON public.policy_acceptances (user_id);

-- ----------------------------------------------------------------------------
-- 3. public.vendor_profiles
-- The storefront identity of a user who sells. The slug is what
-- affilova.com/store/<slug> resolves, so it is unique, lowercase and never one
-- of the reserved words above.
--
-- The slug and username patterns cast to text before matching on purpose.
-- citext installs its own case-insensitive operators in the extensions schema,
-- and whether they are used depends on the search_path of the session that runs
-- this file. Matching on the text value always uses pg_catalog's case-sensitive
-- regex, so "Shop" is rejected here on every database, whatever the path.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_profiles (
  user_id       uuid               PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  business_name text               NOT NULL
                                   CHECK (char_length(business_name) BETWEEN 2 AND 100),
  slug          extensions.citext  NOT NULL UNIQUE
                                   CHECK (
                                     (slug::text) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
                                     AND NOT public.is_reserved_handle(slug::text)
                                   ),
  support_email extensions.citext  NOT NULL,
  phone         text               CHECK (phone IS NULL OR char_length(phone) <= 20),
  country       text               NOT NULL DEFAULT 'NG'
                                   CHECK (char_length(country) = 2),
  status        text               NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'suspended')),
  created_at    timestamptz        NOT NULL DEFAULT now(),
  updated_at    timestamptz        NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS vendor_profiles_set_updated_at ON public.vendor_profiles;
CREATE TRIGGER vendor_profiles_set_updated_at
  BEFORE UPDATE ON public.vendor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. public.affiliate_profiles
-- The promotional identity of a user who promotes. Same shape: a unique
-- lowercase handle, a short list of channels, and no client-controlled writes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
  user_id             uuid              PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  username            extensions.citext NOT NULL UNIQUE
                                        CHECK (
                                          (username::text) ~ '^[a-z0-9_]{3,30}$'
                                          AND NOT public.is_reserved_handle(username::text)
                                        ),
  promotion_channels  text[]            NOT NULL DEFAULT '{}'
                                        CHECK (cardinality(promotion_channels) <= 10),
  country             text              NOT NULL DEFAULT 'NG'
                                        CHECK (char_length(country) = 2),
  status              text              NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'suspended')),
  created_at          timestamptz       NOT NULL DEFAULT now(),
  updated_at          timestamptz       NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS affiliate_profiles_set_updated_at ON public.affiliate_profiles;
CREATE TRIGGER affiliate_profiles_set_updated_at
  BEFORE UPDATE ON public.affiliate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Row level security on every table created here
-- ----------------------------------------------------------------------------
ALTER TABLE public.policy_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 6. Privileges and policies
-- Pattern, as in the foundation: revoke everything from the client roles first,
-- then grant only what is listed below. Policies use (select auth.uid()) so the
-- lookup is evaluated once per query.
-- ----------------------------------------------------------------------------

-- policy_acceptances: read your own, or read all as staff. No client writes:
-- the rows are inserted by the become_* functions.
REVOKE ALL ON TABLE public.policy_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.policy_acceptances TO authenticated;

DROP POLICY IF EXISTS policy_acceptances_select_own ON public.policy_acceptances;
CREATE POLICY policy_acceptances_select_own
  ON public.policy_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS policy_acceptances_select_staff ON public.policy_acceptances;
CREATE POLICY policy_acceptances_select_staff
  ON public.policy_acceptances
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- vendor_profiles: owner reads own row, staff read all, owner updates three
-- columns on their own row. slug, country and status are not in the column
-- grant, so an owner can never change the store address, and there is no INSERT
-- or DELETE for any client role.
REVOKE ALL ON TABLE public.vendor_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vendor_profiles TO authenticated;
GRANT UPDATE (business_name, support_email, phone)
  ON TABLE public.vendor_profiles TO authenticated;

DROP POLICY IF EXISTS vendor_profiles_select_own ON public.vendor_profiles;
CREATE POLICY vendor_profiles_select_own
  ON public.vendor_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS vendor_profiles_select_staff ON public.vendor_profiles;
CREATE POLICY vendor_profiles_select_staff
  ON public.vendor_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

DROP POLICY IF EXISTS vendor_profiles_update_own ON public.vendor_profiles;
CREATE POLICY vendor_profiles_update_own
  ON public.vendor_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- affiliate_profiles: same shape. The owner may edit promotion_channels only.
REVOKE ALL ON TABLE public.affiliate_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.affiliate_profiles TO authenticated;
GRANT UPDATE (promotion_channels) ON TABLE public.affiliate_profiles TO authenticated;

DROP POLICY IF EXISTS affiliate_profiles_select_own ON public.affiliate_profiles;
CREATE POLICY affiliate_profiles_select_own
  ON public.affiliate_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS affiliate_profiles_select_staff ON public.affiliate_profiles;
CREATE POLICY affiliate_profiles_select_staff
  ON public.affiliate_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

DROP POLICY IF EXISTS affiliate_profiles_update_own ON public.affiliate_profiles;
CREATE POLICY affiliate_profiles_update_own
  ON public.affiliate_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- Identity sequence: service_role only, as in the foundation.
REVOKE ALL ON SEQUENCE public.policy_acceptances_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.policy_acceptances_id_seq TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Server role (service_role) privileges
-- Explicit, so they do not depend on Supabase's default privileges for new
-- tables. public.audit_log keeps its foundation grants and stays append-only.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON TABLE
  public.policy_acceptances,
  public.vendor_profiles,
  public.affiliate_profiles
TO service_role;

-- ----------------------------------------------------------------------------
-- 8. public.become_vendor(...)
--
-- The only way to become a vendor. Everything happens in the caller's
-- transaction: one role row, two policy acceptances and one audit entry, or
-- nothing at all.
--
--   * an inactive or missing profile raises 'profile_not_active';
--   * a user who already has a vendor row gets {"created": false} and nothing
--     else is touched;
--   * a taken slug is left to surface as the normal unique_violation (23505),
--     so the caller can turn it into a field error without parsing a message.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.become_vendor(
  p_user          uuid,
  p_business_name text,
  p_slug          text,
  p_support_email text,
  p_phone         text,
  p_country       text,
  p_terms_version text,
  p_ip_hash       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'profile_not_active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_profiles v
    WHERE v.user_id = p_user
  ) THEN
    RETURN pg_catalog.jsonb_build_object('created', false);
  END IF;

  INSERT INTO public.vendor_profiles (
    user_id, business_name, slug, support_email, phone, country
  )
  VALUES (
    p_user,
    p_business_name,
    p_slug::extensions.citext,
    p_support_email::extensions.citext,
    p_phone,
    p_country
  );

  INSERT INTO public.user_roles (user_id, role, status)
  VALUES (p_user, 'vendor', 'active')
  ON CONFLICT (user_id, role) DO UPDATE SET status = 'active';

  INSERT INTO public.policy_acceptances (user_id, policy, version, ip_hash)
  VALUES
    (p_user, 'terms_of_service', p_terms_version, p_ip_hash),
    (p_user, 'privacy_policy', p_terms_version, p_ip_hash)
  ON CONFLICT (user_id, policy, version) DO NOTHING;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
  VALUES (p_user, 'role.vendor.granted', 'user', p_user::text);

  RETURN pg_catalog.jsonb_build_object('created', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. public.become_affiliate(...)
-- Same contract, for the affiliate side. Audit action 'role.affiliate.granted'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.become_affiliate(
  p_user              uuid,
  p_username          text,
  p_promotion_channels text[],
  p_country           text,
  p_terms_version     text,
  p_ip_hash           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'profile_not_active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.affiliate_profiles a
    WHERE a.user_id = p_user
  ) THEN
    RETURN pg_catalog.jsonb_build_object('created', false);
  END IF;

  INSERT INTO public.affiliate_profiles (
    user_id, username, promotion_channels, country
  )
  VALUES (
    p_user,
    p_username::extensions.citext,
    p_promotion_channels,
    p_country
  );

  INSERT INTO public.user_roles (user_id, role, status)
  VALUES (p_user, 'affiliate', 'active')
  ON CONFLICT (user_id, role) DO UPDATE SET status = 'active';

  INSERT INTO public.policy_acceptances (user_id, policy, version, ip_hash)
  VALUES
    (p_user, 'terms_of_service', p_terms_version, p_ip_hash),
    (p_user, 'privacy_policy', p_terms_version, p_ip_hash)
  ON CONFLICT (user_id, policy, version) DO NOTHING;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
  VALUES (p_user, 'role.affiliate.granted', 'user', p_user::text);

  RETURN pg_catalog.jsonb_build_object('created', true);
END;
$$;

-- Server-only. A signed-in user must not be able to name another user's id as
-- p_user and grant themselves, or anyone else, a role.
REVOKE ALL ON FUNCTION public.become_vendor(uuid, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.become_affiliate(uuid, text, text[], text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.become_vendor(uuid, text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.become_affiliate(uuid, text, text[], text, text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 10. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261113000100', 'roles_onboarding')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- The tables are dropped before the functions: their CHECK constraints call
-- public.is_reserved_handle(), so the function cannot be dropped while a table
-- that uses it still exists.
--
-- Warning: this drops the two role profile tables, the policy acceptances and
-- the two functions, and all data in them. The roles already granted in
-- public.user_roles are deliberately left in place: revoking a person's vendor
-- or affiliate role is a separate decision, not a side effect of a schema
-- rollback. Since this file depends on the foundation, dropping the extensions
-- is not part of it.
-- ============================================================================
--
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS affiliate_profiles_set_updated_at ON public.affiliate_profiles;
-- DROP TRIGGER IF EXISTS vendor_profiles_set_updated_at ON public.vendor_profiles;
--
-- DROP POLICY IF EXISTS affiliate_profiles_update_own ON public.affiliate_profiles;
-- DROP POLICY IF EXISTS affiliate_profiles_select_staff ON public.affiliate_profiles;
-- DROP POLICY IF EXISTS affiliate_profiles_select_own ON public.affiliate_profiles;
-- DROP POLICY IF EXISTS vendor_profiles_update_own ON public.vendor_profiles;
-- DROP POLICY IF EXISTS vendor_profiles_select_staff ON public.vendor_profiles;
-- DROP POLICY IF EXISTS vendor_profiles_select_own ON public.vendor_profiles;
-- DROP POLICY IF EXISTS policy_acceptances_select_staff ON public.policy_acceptances;
-- DROP POLICY IF EXISTS policy_acceptances_select_own ON public.policy_acceptances;
--
-- DROP TABLE IF EXISTS public.affiliate_profiles;
-- DROP TABLE IF EXISTS public.vendor_profiles;
-- DROP TABLE IF EXISTS public.policy_acceptances;
--
-- DROP FUNCTION IF EXISTS public.become_affiliate(uuid, text, text[], text, text, text);
-- DROP FUNCTION IF EXISTS public.become_vendor(uuid, text, text, text, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.is_reserved_handle(text);
--
-- DELETE FROM public.app_migrations WHERE version = '20261113000100';
--
-- COMMIT;
