-- ============================================================================
-- Migration 20261127000100_email_suppressions
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the list of addresses that must not be written to again, the two
--         functions that maintain it, the one that reads it back, and the admin
--         action that removes an entry.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (app_migrations, audit_log) and on
-- 20261124000100_admin_finance.sql (staff_has_any_role).
--
-- Why a hash and not the address: this table exists so that a hard bounce or a
-- spam complaint stops us writing to a mailbox. Nothing in that job needs the
-- address itself, and a table of addresses is a list worth stealing. What is
-- stored is SHA-256 of the lowercased address with a server-side pepper
-- (EMAIL_HASH_PEPPER), computed in the application, so the same address always
-- hashes the same way and nobody can reverse the table by hashing a guessed
-- address without the pepper.
--
-- Who may do what:
--   * the sender writes, through the service role, one row per address;
--   * an admin may remove an entry, and that removal leaves an audit row;
--   * admin and finance may read the counts, which carry no address at all.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.email_suppressions
--
-- recipient_hash: 64 lower-case hex characters: SHA-256 of the lowercased
--                 address with the pepper. The primary key, so one row per
--                 address however many times it bounces.
-- reason:        one of five words. The list is closed on purpose: a new reason
--                is a change to this check, not a value a caller can invent.
-- source:        where the event came from: "brevo_webhook", "manual", a
--                template name. Short, and never an address.
-- first_seen:    when the address was first suppressed. Never changes.
-- last_seen:     when it was last confirmed. Moves forward on every repeat.
-- events:        how many times it has been confirmed. One means once.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  recipient_hash text        PRIMARY KEY
                             CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  reason         text        NOT NULL
                             CHECK (reason IN ('hard_bounce', 'complaint', 'blocked', 'invalid', 'unsubscribed')),
  source         text        NOT NULL DEFAULT ''
                             CHECK (char_length(source) <= 60),
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  events         int         NOT NULL DEFAULT 1
                             CHECK (events >= 1)
);

-- The overview groups by reason; the recent list reads newest first. One index
-- serves both, and it is small: a suppression list is hundreds of rows.
CREATE INDEX IF NOT EXISTS email_suppressions_reason_idx
  ON public.email_suppressions (reason);

CREATE INDEX IF NOT EXISTS email_suppressions_last_seen_idx
  ON public.email_suppressions (last_seen DESC);

-- ----------------------------------------------------------------------------
-- 2. public.add_email_suppression(text, text, text) -> int
--
-- Upsert. A repeat event moves last_seen forward and increments events; it never
-- rewrites first_seen, because "first seen" is the fact that answers "when did we
-- stop writing to this address".
--
-- Returns the number of events recorded for the address afterwards, so a caller
-- can log "first time" against "again" without a second read.
--
-- The reason is checked by the table; an unknown one raises. The hash shape is
-- checked here as well, so a caller that passes an address by mistake gets an
-- error rather than a row nobody can look up.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_email_suppression(
  p_hash   text,
  p_reason text,
  p_source text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash   text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hash, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_source text := pg_catalog.left(pg_catalog.btrim(coalesce(p_source, '')), 60);
  v_events int;
BEGIN
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'add_email_suppression expects a 64-character hex hash';
  END IF;

  INSERT INTO public.email_suppressions AS s (recipient_hash, reason, source, first_seen, last_seen, events)
  VALUES (v_hash, v_reason, v_source, pg_catalog.now(), pg_catalog.now(), 1)
  ON CONFLICT (recipient_hash) DO UPDATE
     SET last_seen = pg_catalog.now(),
         events    = s.events + 1,
         -- The first reason is kept: a bounce followed by a complaint is still
         -- a bounce that happened first, and the list is read in that order.
         source    = CASE WHEN s.source = '' THEN EXCLUDED.source ELSE s.source END
  RETURNING s.events INTO v_events;

  RETURN v_events;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.is_email_suppressed(text) -> boolean
--
-- The question the sender asks before every message. True means "do not send".
-- A null or empty hash answers false: that is the shape of "no address given",
-- and refusing to send for it is the caller's job, not this function's.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_email_suppressed(p_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.email_suppressions s
     WHERE s.recipient_hash = pg_catalog.lower(pg_catalog.btrim(coalesce(p_hash, '')))
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. public.remove_email_suppression(uuid, text, text) -> jsonb
--
-- An admin decided the address is fine after all: the bounce was a full mailbox,
-- the complaint was a mistake. The row goes, and the removal is written to
-- public.audit_log with the note, so the decision has a name and a reason
-- attached to it.
--
-- The note is required. "Why did we start writing to this address again" is the
-- only question anyone will ask about this later.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_email_suppression(
  p_actor uuid,
  p_hash  text,
  p_note  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash   text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hash, '')));
  v_note   text := pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 200);
  v_reason text;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF pg_catalog.char_length(v_note) < 3 THEN
    RAISE EXCEPTION 'a note of at least 3 characters is required';
  END IF;

  DELETE FROM public.email_suppressions s
   WHERE s.recipient_hash = v_hash
  RETURNING s.reason INTO v_reason;

  IF v_reason IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('removed', false);
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'email_suppression.removed',
    'email_suppression',
    v_hash,
    pg_catalog.jsonb_build_object('reason', v_reason),
    pg_catalog.jsonb_build_object('note', v_note)
  );

  RETURN pg_catalog.jsonb_build_object('removed', true, 'reason', v_reason);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.email_suppression_overview(uuid) -> jsonb
--
--   { total, by_reason: { <reason>: <count> },
--     recent: [ { reason, source, first_seen, last_seen, events } ] }  (last 10)
--
-- Admin or finance. There is no address in this table, so there is nothing here
-- for a role to be kept away from beyond the fact that email is being refused:
-- that is why support and moderator do not get it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_suppression_overview(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total  bigint;
  v_reason jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_total FROM public.email_suppressions s;

  -- coalesce keeps the shape stable: an empty list is an empty object, not null.
  SELECT coalesce(pg_catalog.jsonb_object_agg(grouped.reason, grouped.n), '{}'::jsonb)
    INTO v_reason
    FROM (
      SELECT s.reason, count(*) AS n
        FROM public.email_suppressions s
       GROUP BY s.reason
       ORDER BY s.reason
    ) AS grouped;

  SELECT coalesce(pg_catalog.jsonb_agg(rowed.entry ORDER BY rowed.last_seen DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT s.last_seen,
             pg_catalog.jsonb_build_object(
               'reason', s.reason,
               'source', s.source,
               'first_seen', s.first_seen,
               'last_seen', s.last_seen,
               'events', s.events
             ) AS entry
        FROM public.email_suppressions s
       ORDER BY s.last_seen DESC
       LIMIT 10
    ) AS rowed;

  RETURN pg_catalog.jsonb_build_object(
    'total', coalesce(v_total, 0),
    'by_reason', v_reason,
    'recent', v_recent
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row level security, privileges and policies
--
-- The table is written by the sender through the service role and read through
-- one function, so the client roles get nothing at all: no grant, and no policy
-- that could grant a row. RLS is on anyway, so a future grant cannot expose it
-- by accident.
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_suppressions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_suppressions TO service_role;

REVOKE ALL ON FUNCTION public.add_email_suppression(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_email_suppressed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_email_suppression(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_suppression_overview(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_email_suppression(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_email_suppressed(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_email_suppression(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_suppression_overview(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261127000100', 'email_suppressions')
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
-- DROP FUNCTION IF EXISTS public.email_suppression_overview(uuid);
-- DROP FUNCTION IF EXISTS public.remove_email_suppression(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.is_email_suppressed(text);
-- DROP FUNCTION IF EXISTS public.add_email_suppression(text, text, text);
-- DROP TABLE IF EXISTS public.email_suppressions;
--
-- DELETE FROM public.app_migrations WHERE version = '20261127000100';
--
-- COMMIT;
-- ============================================================================
