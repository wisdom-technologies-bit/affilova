-- ============================================================================
-- Migration 20261126000100_email_diagnostics
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  one row per transactional email that was finally given up on, the two
--         functions that write and read it, and the purge that keeps it small.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (app_migrations), on
-- 20261113000100_roles_onboarding.sql (user_roles, app_role) and on
-- 20261124000100_admin_finance.sql (staff_has_any_role).
--
-- Why a table of reasons and not the provider's answer: a Brevo error body names
-- the sender address, sometimes the key and sometimes the IP. None of that is
-- stored here. The row is a template name, the provider's status, one reason from
-- the fixed list in lib/email/reasons.ts, and the time. That is enough to answer
-- "is email broken, and why" and not enough to leak anything.
--
-- The table is written by the sender through the service role and read only
-- through email_failure_overview(), which checks the caller's role itself.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.email_failures
--
-- template: the template name, cut to 60 characters. Never the subject.
-- status:   the provider's HTTP status. 0 when the request never got an answer
--           (a timeout or a refused connection), because a null would need a
--           second meaning for "we did not ask".
-- reason:   one word from the list in lib/email/reasons.ts, cut to 40.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_failures (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template   text        NOT NULL
                         CHECK (char_length(template) BETWEEN 1 AND 60),
  status     int         NOT NULL
                         CHECK (status >= 0 AND status <= 599),
  reason     text        NOT NULL
                         CHECK (char_length(reason) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The overview reads one day at a time, newest first, and the purge reads the
-- oldest rows. One index serves both.
CREATE INDEX IF NOT EXISTS email_failures_created_at_idx
  ON public.email_failures (created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. public.record_email_failure(text, int, text) -> void
--
-- The only way in. The sender calls this through the service role after the last
-- attempt, once per message, never once per retry.
--
-- The two text arguments are cut here as well as in the application: a caller
-- that forgets cannot store a whole Brevo body in a column sized for a word.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_email_failure(
  p_template text,
  p_status   int,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_template text := pg_catalog.left(coalesce(p_template, ''), 60);
  v_reason   text := pg_catalog.left(coalesce(p_reason, ''), 40);
  v_status   int  := coalesce(p_status, 0);
BEGIN
  -- A row with no template or no reason says nothing, so it is not written.
  IF pg_catalog.btrim(v_template) = '' OR pg_catalog.btrim(v_reason) = '' THEN
    RETURN;
  END IF;

  IF v_status < 0 OR v_status > 599 THEN
    v_status := 0;
  END IF;

  INSERT INTO public.email_failures (template, status, reason)
  VALUES (pg_catalog.btrim(v_template), v_status, pg_catalog.btrim(v_reason));
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.email_failure_overview(uuid) -> jsonb
--
--   { last_24h: { total, by_reason: { <reason>: <count> } },
--     recent: [ { template, status, reason, created_at } ] }   (last 10)
--
-- Admin and finance only. The address is not in the table, so there is nothing
-- here for a role to be kept away from beyond the fact that email is failing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_failure_overview(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since  timestamptz := pg_catalog.now() - interval '24 hours';
  v_total  bigint;
  v_reason jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.email_failures f
   WHERE f.created_at >= v_since;

  -- coalesce keeps the shape stable: an empty window is an empty object, not
  -- null, so the page can always read it.
  SELECT coalesce(
           pg_catalog.jsonb_object_agg(grouped.reason, grouped.n),
           '{}'::jsonb
         )
    INTO v_reason
    FROM (
      SELECT f.reason, count(*) AS n
        FROM public.email_failures f
       WHERE f.created_at >= v_since
       GROUP BY f.reason
       ORDER BY f.reason
    ) AS grouped;

  SELECT coalesce(pg_catalog.jsonb_agg(rowed.entry ORDER BY rowed.created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT f.created_at,
             pg_catalog.jsonb_build_object(
               'template', f.template,
               'status', f.status,
               'reason', f.reason,
               'created_at', f.created_at
             ) AS entry
        FROM public.email_failures f
       ORDER BY f.created_at DESC
       LIMIT 10
    ) AS rowed;

  RETURN pg_catalog.jsonb_build_object(
    'last_24h', pg_catalog.jsonb_build_object(
      'total', coalesce(v_total, 0),
      'by_reason', v_reason
    ),
    'recent', v_recent
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.purge_old_email_failures(int) -> int
--
-- Called by the daily `cleanup` job. Thirty days is long enough to see a pattern
-- and short enough that the table stays a working set. The window is clamped so a
-- caller cannot empty the table by passing 0.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_email_failures(p_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days    int := coalesce(p_days, 30);
  v_deleted int;
BEGIN
  IF v_days < 1 THEN
    v_days := 1;
  END IF;

  IF v_days > 365 THEN
    v_days := 365;
  END IF;

  DELETE FROM public.email_failures f
   WHERE f.created_at < pg_catalog.now() - pg_catalog.make_interval(days => v_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Row level security, privileges and policies
--
-- The table is written by the sender and read by one function, so the client
-- roles get nothing at all: no grant, and no policy that could grant a row.
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_failures FROM PUBLIC, anon, authenticated;

-- The identity column's sequence is a separate object, and an INSERT through the
-- service role needs USAGE on it as well as INSERT on the table.
GRANT USAGE, SELECT ON SEQUENCE public.email_failures_id_seq TO service_role;

GRANT SELECT, INSERT, DELETE ON TABLE public.email_failures TO service_role;

REVOKE ALL ON FUNCTION public.record_email_failure(text, int, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_failure_overview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_email_failures(int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_email_failure(text, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_failure_overview(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_email_failures(int) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261126000100', 'email_diagnostics')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.purge_old_email_failures(int);
-- DROP FUNCTION IF EXISTS public.email_failure_overview(uuid);
-- DROP FUNCTION IF EXISTS public.record_email_failure(text, int, text);
-- DROP TABLE IF EXISTS public.email_failures;
--
-- DELETE FROM public.app_migrations WHERE version = '20261126000100';
--
-- COMMIT;
-- ============================================================================
