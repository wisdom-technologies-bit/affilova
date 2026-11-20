-- ============================================================================
-- Migration 20261117000200_email_log
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  one row per transactional email the platform has claimed to send, so a
--         retried job never sends the same email twice.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261116000200_commerce_core.sql (public.orders) and on
-- 20261112000100_foundation.sql (app_migrations).
--
-- Why a table and not the job queue: a job can be retried, re-enqueued by hand or
-- run twice after a redeploy. The claim has to survive all of that, so it lives in
-- a unique row per (kind, order, recipient) instead of in the queue's own state.
--
-- recipient_hash is a truncated SHA-256 of the address. The address itself is
-- never stored: this table has to be readable by whoever debugs a delivery, and
-- it must not become a second copy of the customer list.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.email_log
--
-- status:  pending  the send has been claimed and is in flight
--          sent     the provider accepted it
--          failed   reserved for a send that was given up on
-- A failed send deletes its claim instead of marking it failed, so the retry can
-- claim it again; 'failed' is kept for an operator who wants to record a give-up.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_log (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind                text        NOT NULL
                                  CHECK (char_length(kind) BETWEEN 1 AND 40),
  order_id            uuid        NOT NULL
                                  REFERENCES public.orders (id) ON DELETE CASCADE,
  recipient_hash      text        NOT NULL
                                  CHECK (recipient_hash ~ '^[0-9a-f]{32,64}$'),
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text        CHECK (
                                    provider_message_id IS NULL
                                    OR char_length(provider_message_id) <= 200
                                  ),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_log_one_per_recipient
    UNIQUE (kind, order_id, recipient_hash)
);

CREATE INDEX IF NOT EXISTS email_log_order_idx
  ON public.email_log (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_log_pending_idx
  ON public.email_log (created_at)
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 2. Row level security, privileges and policies
--
-- The table is written by the job runner and read by nobody in the browser, so
-- the client roles get nothing at all: no policy can grant anon a row, and there
-- is no policy here to try.
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_log FROM PUBLIC, anon, authenticated;

-- The identity column's sequence is a separate object, and an INSERT through the
-- service role needs USAGE on it as well as INSERT on the table.
GRANT USAGE, SELECT ON SEQUENCE public.email_log_id_seq TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_log TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261117000200', 'email_log')
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
-- DROP TABLE IF EXISTS public.email_log;
--
-- DELETE FROM public.app_migrations WHERE version = '20261117000200';
--
-- COMMIT;
-- ============================================================================
