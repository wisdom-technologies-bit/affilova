-- ============================================================================
-- Migration 20261125000200_admin_users
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  The database half of the admin Users screens. Six functions, all
--         SECURITY DEFINER and callable only by service_role, because the app
--         reaches them through the admin client and passes the acting staff
--         member in as p_actor:
--
--           public.admin_list_users(search, status, role, limit, offset)
--           public.admin_get_user(user_id)
--           public.admin_grant_staff_role(user_id, role, actor)
--           public.admin_revoke_staff_role(user_id, role, actor)
--           public.admin_set_user_status(user_id, status, actor)
--           public.admin_set_verification_level(user_id, level, actor)
--
--         Three rules are enforced here and not only in the screens, because a
--         screen is not a security boundary:
--
--           1. only the four staff roles can be granted or revoked through these
--              functions. customer, affiliate and vendor are never staff, and
--              granting them here would be a way to hand out a role that the
--              onboarding flows own;
--           2. the actor must hold an active admin role;
--           3. the last active admin cannot be revoked, suspended or deleted.
--              Recovery from a lost authenticator depends on a second admin
--              existing (see docs/staff-security.md), so the database refuses to
--              create the situation where nobody can get in.
--
--         Every change appends one row to public.audit_log. The before/after
--         JSON holds the role, the status and the level, never an email address,
--         a name or a token.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.profiles, public.user_roles,
-- public.audit_log, public.app_role, public.account_status,
-- public.verification_level).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. A partial index for the one query that runs on every admin page: who holds
--    which active staff role. The existing user_roles_role_idx covers the role;
--    this one covers the "active" half of it.
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS user_roles_active_role_idx
  ON public.user_roles (role)
  WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- 2. The staff roles, in one place. A table-valued helper rather than a check
--    constraint, so the list can be read by the functions below without
--    repeating it five times.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_staff_role(p_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_role IN (
    'admin'::public.app_role,
    'finance'::public.app_role,
    'support'::public.app_role,
    'moderator'::public.app_role
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. admin_list_users: one page of people, filtered and searched.
--
--    p_search matches the email or any of the three name columns, without case
--    sensitivity. A null or blank search returns everyone, which is what the
--    screen shows before anyone types.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status public.account_status DEFAULT NULL,
  p_role   public.app_role DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  email              text,
  display_name       text,
  status             public.account_status,
  verification_level public.verification_level,
  roles              text[],
  created_at         timestamptz,
  total_count        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH filtered AS (
    SELECT
      p.id,
      p.email::text AS email,
      coalesce(
        nullif(pg_catalog.btrim(p.display_name), ''),
        nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.first_name, p.last_name)), '')
      ) AS display_name,
      p.status,
      p.verification_level,
      p.created_at
    FROM public.profiles p
    WHERE
      (p_status IS NULL OR p.status = p_status)
      AND (
        p_role IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.user_roles r
          WHERE r.user_id = p.id AND r.role = p_role AND r.status = 'active'
        )
      )
      AND (
        coalesce(pg_catalog.btrim(p_search), '') = ''
        OR p.email::text ILIKE '%' || pg_catalog.btrim(p_search) || '%'
        OR p.display_name ILIKE '%' || pg_catalog.btrim(p_search) || '%'
        OR p.first_name ILIKE '%' || pg_catalog.btrim(p_search) || '%'
        OR p.last_name ILIKE '%' || pg_catalog.btrim(p_search) || '%'
      )
  )
  SELECT
    f.id,
    f.email,
    f.display_name,
    f.status,
    f.verification_level,
    coalesce(
      (
        SELECT pg_catalog.array_agg(r.role::text ORDER BY r.role::text)
        FROM public.user_roles r
        WHERE r.user_id = f.id AND r.status = 'active'
      ),
      ARRAY[]::text[]
    ) AS roles,
    f.created_at,
    pg_catalog.count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC, f.id
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

-- ----------------------------------------------------------------------------
-- 4. admin_get_user: one person, with every role they hold including revoked
--    ones, so the screen can show what was taken away and when.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', p.id,
    'email', p.email::text,
    'display_name', coalesce(
      nullif(pg_catalog.btrim(p.display_name), ''),
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.first_name, p.last_name)), '')
    ),
    'status', p.status,
    'verification_level', p.verification_level,
    'created_at', p.created_at,
    'roles', coalesce(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'role', r.role,
            'status', r.status,
            'created_at', r.created_at
          )
          ORDER BY r.role::text
        )
        FROM public.user_roles r
        WHERE r.user_id = p.id
      ),
      '[]'::jsonb
    )
  )
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

-- ----------------------------------------------------------------------------
-- 5. The actor check, shared by the four writing functions.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_admin_actor(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    WHERE r.user_id = p_actor AND r.role = 'admin'::public.app_role AND r.status = 'active'
  ) THEN
    RAISE EXCEPTION 'only an active admin may change staff access'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. The last-admin guard.
--
--    Called with the user about to lose their admin role (by revocation or by a
--    status change away from active). It counts the *other* active admins: one
--    or more must remain.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_not_last_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT pg_catalog.count(*)
  INTO v_remaining
  FROM public.user_roles r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.role = 'admin'::public.app_role
    AND r.status = 'active'
    AND p.status = 'active'
    AND r.user_id <> p_user_id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'the last active admin cannot be removed'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. admin_grant_staff_role
--
--    Idempotent: granting a role the person already holds does nothing and
--    writes no audit row. Granting back a revoked role reactivates the existing
--    row rather than inserting a second one, because (user_id, role) is the
--    primary key.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_grant_staff_role(
  p_user_id uuid,
  p_role    public.app_role,
  p_actor   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before text;
BEGIN
  PERFORM public.assert_admin_actor(p_actor);

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_role IS NULL OR NOT public.is_staff_role(p_role) THEN
    RAISE EXCEPTION 'only a staff role can be granted here'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'no such user'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT r.status INTO v_before
  FROM public.user_roles r
  WHERE r.user_id = p_user_id AND r.role = p_role;

  IF v_before = 'active' THEN
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role, status, granted_by)
  VALUES (p_user_id, p_role, 'active', p_actor)
  ON CONFLICT (user_id, role)
  DO UPDATE SET status = 'active', granted_by = p_actor;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'staff_role.granted',
    'user_role',
    p_user_id::text || ':' || p_role::text,
    pg_catalog.jsonb_build_object('role', p_role, 'status', coalesce(v_before, 'absent')),
    pg_catalog.jsonb_build_object('role', p_role, 'status', 'active')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. admin_revoke_staff_role
--
--    Revoking the admin role of the last active admin is refused. Revoking a role
--    the person does not hold actively does nothing.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_revoke_staff_role(
  p_user_id uuid,
  p_role    public.app_role,
  p_actor   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before text;
BEGIN
  PERFORM public.assert_admin_actor(p_actor);

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_role IS NULL OR NOT public.is_staff_role(p_role) THEN
    RAISE EXCEPTION 'only a staff role can be revoked here'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT r.status INTO v_before
  FROM public.user_roles r
  WHERE r.user_id = p_user_id AND r.role = p_role;

  IF v_before IS DISTINCT FROM 'active' THEN
    RETURN;
  END IF;

  IF p_role = 'admin'::public.app_role THEN
    PERFORM public.assert_not_last_admin(p_user_id);
  END IF;

  UPDATE public.user_roles
  SET status = 'revoked'
  WHERE user_id = p_user_id AND role = p_role;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'staff_role.revoked',
    'user_role',
    p_user_id::text || ':' || p_role::text,
    pg_catalog.jsonb_build_object('role', p_role, 'status', 'active'),
    pg_catalog.jsonb_build_object('role', p_role, 'status', 'revoked')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. admin_set_user_status
--
--    Suspending an account is how a compromised login is closed. Suspending the
--    last active admin is refused for the same reason revoking is: it would leave
--    nobody who can undo it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id uuid,
  p_status  public.account_status,
  p_actor   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before public.account_status;
BEGIN
  PERFORM public.assert_admin_actor(p_actor);

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_status IS NULL THEN
    RAISE EXCEPTION 'p_status is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.status INTO v_before
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'no such user'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_before = p_status THEN
    RETURN;
  END IF;

  IF p_status <> 'active' AND EXISTS (
    SELECT 1
    FROM public.user_roles r
    WHERE r.user_id = p_user_id AND r.role = 'admin'::public.app_role AND r.status = 'active'
  ) THEN
    PERFORM public.assert_not_last_admin(p_user_id);
  END IF;

  UPDATE public.profiles
  SET status = p_status, updated_at = pg_catalog.now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'user.status_changed',
    'profile',
    p_user_id::text,
    pg_catalog.jsonb_build_object('status', v_before),
    pg_catalog.jsonb_build_object('status', p_status)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. admin_set_verification_level
--
--     A staff decision with money behind it: verified vendors get paid. The
--     level and the status are the two things the admin screens own here.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_verification_level(
  p_user_id uuid,
  p_level   public.verification_level,
  p_actor   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before public.verification_level;
BEGIN
  PERFORM public.assert_admin_actor(p_actor);

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_level IS NULL THEN
    RAISE EXCEPTION 'p_level is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.verification_level INTO v_before
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'no such user'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_before = p_level THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET verification_level = p_level, updated_at = pg_catalog.now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'user.verification_changed',
    'profile',
    p_user_id::text,
    pg_catalog.jsonb_build_object('verification_level', v_before),
    pg_catalog.jsonb_build_object('verification_level', p_level)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Privileges. Every function above is service_role only: the app calls them
--     through the admin client after its own permission and second-factor
--     checks, and passes the acting staff member as p_actor.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_staff_role(public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_users(text, public.account_status, public.app_role, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_admin_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_not_last_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_staff_role(uuid, public.app_role, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_staff_role(uuid, public.app_role, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, public.account_status, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_verification_level(uuid, public.verification_level, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_list_users(text, public.account_status, public.app_role, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_staff_role(uuid, public.app_role, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_staff_role(uuid, public.app_role, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, public.account_status, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_verification_level(uuid, public.verification_level, uuid) TO service_role;

INSERT INTO public.app_migrations (version, name)
VALUES ('20261125000200', 'admin_users')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Rows in public.user_roles, public.profiles and
-- public.audit_log are preserved, because they record real people and real
-- decisions.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.admin_set_verification_level(uuid, public.verification_level, uuid);
-- DROP FUNCTION IF EXISTS public.admin_set_user_status(uuid, public.account_status, uuid);
-- DROP FUNCTION IF EXISTS public.admin_revoke_staff_role(uuid, public.app_role, uuid);
-- DROP FUNCTION IF EXISTS public.admin_grant_staff_role(uuid, public.app_role, uuid);
-- DROP FUNCTION IF EXISTS public.assert_not_last_admin(uuid);
-- DROP FUNCTION IF EXISTS public.assert_admin_actor(uuid);
-- DROP FUNCTION IF EXISTS public.admin_get_user(uuid);
-- DROP FUNCTION IF EXISTS public.admin_list_users(text, public.account_status, public.app_role, integer, integer);
-- DROP FUNCTION IF EXISTS public.is_staff_role(public.app_role);
--
-- DROP INDEX IF EXISTS public.user_roles_active_role_idx;
--
-- DELETE FROM public.app_migrations WHERE version = '20261125000200';
--
-- COMMIT;
-- ============================================================================
