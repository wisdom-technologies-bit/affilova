-- ============================================================================
-- Migration 20261113000200_rate_limits
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  a fixed-window rate limiter kept in Postgres, plus its cleanup job.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql: public.app_migrations.
--
-- Why Postgres: the auth actions and the CSP report endpoint need a shared
-- counter, and every server instance must see the same one. A table with an
-- atomic upsert gives that without another vendor or another moving part.
--
-- Nothing in here is reachable from a browser. The table has row level security
-- on and no policy at all, and both functions are revoked from every client role
-- and granted to service_role only.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.rate_limits
-- One row per (key, window). A key is a hashed identifier (never a raw IP or
-- email address; see lib/rate-limit.ts), a window is the fixed bucket the hits
-- were counted in.
--
-- The primary key is exactly the upsert conflict target, so the increment is a
-- single atomic statement and two concurrent callers cannot lose a hit.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int         NOT NULL DEFAULT 0,
  CONSTRAINT rate_limits_pkey PRIMARY KEY (key, window_start),
  CONSTRAINT rate_limits_hits_check CHECK (hits >= 0)
);

-- Cleanup path: "delete everything older than a day" scans on window_start
-- alone, which the primary key (key, window_start) cannot serve.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);

-- ----------------------------------------------------------------------------
-- 2. public.rate_limit_hit
-- Count one hit for p_key in the current fixed window and report the outcome.
--
--   window_start = floor(epoch(now()) / p_window_seconds) * p_window_seconds
--
-- so every caller in the same window bucket works on the same row, and the
-- window rolls over on its own without a sweeper.
--
-- allowed = hits <= p_limit, which means a limit of 5 allows hits 1 through 5
-- and refuses hit 6.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key            text,
  p_limit          int,
  p_window_seconds int
)
RETURNS TABLE (allowed boolean, remaining int, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_start timestamptz;
  v_hits         int;
BEGIN
  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'rate_limit_hit: p_key must not be empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: p_limit must be at least 1 (got %)', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: p_window_seconds must be at least 1 (got %)', p_window_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  -- One statement: insert the first hit, or increment the row that already
  -- exists for this window. A concurrent caller waits on the row lock and then
  -- increments the value it can see, so no hit is ever lost.
  INSERT INTO public.rate_limits AS rl (key, window_start, hits)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE
    SET hits = rl.hits + 1
  RETURNING rl.hits INTO v_hits;

  allowed    := v_hits <= p_limit;
  remaining  := GREATEST(p_limit - v_hits, 0);
  reset_at   := v_window_start + make_interval(secs => p_window_seconds);

  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.cleanup_rate_limits
-- Deletes windows that can no longer be counted against (older than one day;
-- the longest window the app uses is one hour) and reports how many rows went.
-- Called by the `cleanup` cron job.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH deleted AS (
    DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '1 day'
    RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

-- ----------------------------------------------------------------------------
-- 4. Server role only
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, int, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Row level security, with no policy at all
-- RLS on and zero policies means even a role that somehow gets a table grant
-- reads nothing. The service role bypasses RLS, which is the only way in.
-- ----------------------------------------------------------------------------
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON TABLE public.rate_limits TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261113000200', 'rate_limits')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops the table and every counter in it. In-flight rate limits
-- are simply forgotten, so someone who was being limited could try again.
-- Nothing else from any other migration is touched.
-- ============================================================================
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.cleanup_rate_limits();
-- DROP FUNCTION IF EXISTS public.rate_limit_hit(text, int, int);
--
-- DROP TABLE IF EXISTS public.rate_limits;
--
-- DELETE FROM public.app_migrations WHERE version = '20261113000200';
--
-- COMMIT;
