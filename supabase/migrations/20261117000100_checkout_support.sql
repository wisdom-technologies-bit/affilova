-- ============================================================================
-- Migration 20261117000100_checkout_support
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: the database half of Paystack checkout. Webhook bookkeeping, the read
--        helpers the checkout action and the cron reconciliation need, the
--        failure path for an order whose payment could not be started, and the
--        refund submission markers. No page, no component and no existing
--        function is changed.
-- Depends on: 20261112000100_foundation (audit_log, app_migrations, settings),
--        20261112000200_job_queue (enqueue_job),
--        20261116000200_commerce_core (orders, order_items, refund_requests,
--        order_disputes, process_paid_order, process_refund).
-- This file is idempotent: running it twice must not raise an error.
--
-- All money is an integer number of kobo (bigint), exactly as in the commerce
-- core. Nothing here reads or writes the ledger: the ledger is only moved by
-- process_paid_order, process_refund and resolve_dispute, which this file calls
-- and never replaces.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.webhook_events
--
-- One row per delivered webhook body. The body itself is never stored: only its
-- SHA-256, which is what makes a redelivered event recognisable. The unique key
-- on (provider, body_sha256) is the duplicate detector, so a retry from Paystack
-- cannot be processed twice even if two instances receive it at the same time.
--
-- error is capped at 300 characters: it holds a short reason, never a payload.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text        NOT NULL DEFAULT 'paystack',
  body_sha256  text        NOT NULL
                           CHECK (body_sha256 ~ '^[0-9a-fA-F]{64}$'),
  event_type   text,
  reference    text,
  status       text        NOT NULL DEFAULT 'received'
                           CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error        text        CHECK (error IS NULL OR char_length(error) <= 300),
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT webhook_events_provider_body_key UNIQUE (provider, body_sha256)
);

-- The duplicate lookup is the unique key above. These indexes serve the other
-- two reads: one order's events, and the last 24 hours by status (the admin
-- Security page).
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON public.webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS webhook_events_status_received_idx
  ON public.webhook_events (status, received_at DESC);

CREATE INDEX IF NOT EXISTS webhook_events_reference_idx
  ON public.webhook_events (reference)
  WHERE reference IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. insert_webhook_event(text, text, text, text) -> jsonb
--
-- Records the delivery and says whether it is new. Returns
-- { id, duplicate }. The insert is ON CONFLICT DO NOTHING, so two concurrent
-- deliveries of the same body produce one row and one "duplicate": true answer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_webhook_event(
  p_provider   text,
  p_sha256     text,
  p_event_type text,
  p_reference  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text := pg_catalog.btrim(coalesce(p_provider, ''));
  v_sha      text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sha256, '')));
  v_id       uuid;
BEGIN
  IF v_provider = '' THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

  IF v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_sha256';
  END IF;

  INSERT INTO public.webhook_events (provider, body_sha256, event_type, reference)
  VALUES (
    v_provider,
    v_sha,
    nullif(pg_catalog.btrim(coalesce(p_event_type, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_reference, '')), '')
  )
  ON CONFLICT (provider, body_sha256) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('id', v_id, 'duplicate', false);
  END IF;

  SELECT e.id INTO v_id
  FROM public.webhook_events e
  WHERE e.provider = v_provider
    AND e.body_sha256 = v_sha;

  IF v_id IS NULL THEN
    -- Only reachable if the row was purged between the two statements.
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN pg_catalog.jsonb_build_object('id', v_id, 'duplicate', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. finish_webhook_event(uuid, text, text)
--
-- Records the outcome. A row that already reached a terminal state is left
-- alone: a late retry of the same body must not rewrite what was decided.
-- The error text is cut to the 300 characters the column allows.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_webhook_event(
  p_id     uuid,
  p_status text,
  p_error  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text := pg_catalog.btrim(coalesce(p_status, ''));
  v_row    public.webhook_events;
BEGIN
  IF v_status NOT IN ('received', 'processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT * INTO v_row
  FROM public.webhook_events e
  WHERE e.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_row.status <> 'received' THEN
    RETURN;
  END IF;

  UPDATE public.webhook_events e
     SET status = v_status,
         error = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_error, '')), 300), ''),
         processed_at = pg_catalog.now()
   WHERE e.id = p_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. get_order_by_reference(text) -> jsonb
--
-- The one read the checkout and the webhook need: the order behind a Paystack
-- reference. Returns null when the reference is unknown, so the caller decides
-- what an unknown reference means.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_by_reference(p_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
           'id', o.id,
           'number', o.number,
           'status', o.status,
           'total_kobo', o.total_kobo,
           'buyer_email', o.buyer_email::text
         )
  FROM public.orders o
  WHERE o.paystack_reference = pg_catalog.btrim(coalesce(p_reference, ''));
$$;

-- ----------------------------------------------------------------------------
-- 5. fail_order(text, text)
--
-- The order a payment could not be started for. Only a pending order moves, so
-- a paid order can never be failed by a late or repeated checkout attempt. The
-- audit row carries the reason, cut to 300 characters.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_order(p_reference text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order  public.orders;
  v_reason text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 300);
BEGIN
  IF pg_catalog.btrim(coalesce(p_reference, '')) = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.paystack_reference = pg_catalog.btrim(p_reference)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.orders o
     SET status = 'failed'
   WHERE o.id = v_order.id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL,
    'order.failed',
    'order',
    v_order.id::text,
    pg_catalog.jsonb_build_object(
      'number', v_order.number,
      'reason', nullif(v_reason, '')
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. list_orders_needing_verification(int) -> table(reference text)
--
-- Pending orders old enough that the buyer has had time to finish on the
-- Paystack page, and young enough that the order has not expired yet. Oldest
-- first, so a backlog drains in the order it formed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_orders_needing_verification(p_limit int)
RETURNS TABLE (reference text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.paystack_reference
  FROM public.orders o
  WHERE o.status = 'pending'
    AND o.created_at < pg_catalog.now() - interval '10 minutes'
    AND o.created_at > pg_catalog.now() - interval '24 hours'
  ORDER BY o.created_at
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ----------------------------------------------------------------------------
-- 7. find_open_refund(text) -> jsonb
--
-- The refund request that is still waiting for the provider: requested (nobody
-- decided yet) or approved (decided, not yet submitted). Returns null when the
-- order has none, which is how a refund webhook for an order we never asked to
-- refund is recognised.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_open_refund(p_order_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
           'request_id', r.id,
           'status', r.status,
           'amount_kobo', o.total_kobo
         )
  FROM public.refund_requests r
  JOIN public.orders o ON o.id = r.order_id
  WHERE o.paystack_reference = pg_catalog.btrim(coalesce(p_order_reference, ''))
    AND r.status IN ('requested', 'approved')
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 8. mark_refund_submitted(uuid, text)
--
-- Paystack accepted the refund. The request stays approved until the
-- refund.processed webhook posts the reversal through process_refund, so the
-- ledger is never moved by an API answer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_refund_submitted(
  p_request            uuid,
  p_provider_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reference text := pg_catalog.btrim(coalesce(p_provider_reference, ''));
  v_request   public.refund_requests;
BEGIN
  IF v_reference = '' THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;

  SELECT * INTO v_request
  FROM public.refund_requests r
  WHERE r.id = p_request
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_request.status = 'processed' THEN
    RETURN;
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  UPDATE public.refund_requests r
     SET provider_reference = v_reference
   WHERE r.id = p_request;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL,
    'refund.submitted',
    'refund_request',
    p_request::text,
    pg_catalog.jsonb_build_object(
      'order_id', v_request.order_id,
      'provider_reference', v_reference
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. mark_refund_failed(uuid, text)
--
-- Paystack refused the refund, or refused it for a reason a retry cannot fix.
-- The request leaves the open set (so the buyer may ask again) and the reason is
-- kept where a decision note would go, prefixed so it cannot be mistaken for one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_refund_failed(p_request uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.refund_requests;
  v_reason  text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 250);
BEGIN
  SELECT * INTO v_request
  FROM public.refund_requests r
  WHERE r.id = p_request
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_request.status <> 'approved' THEN
    -- Already processed or already failed: nothing to record twice.
    RETURN;
  END IF;

  UPDATE public.refund_requests r
     SET status = 'failed',
         decision_note = coalesce(
           r.decision_note,
           nullif('refund failed: ' || v_reason, 'refund failed: ')
         )
   WHERE r.id = p_request;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL,
    'refund.failed',
    'refund_request',
    p_request::text,
    pg_catalog.jsonb_build_object(
      'order_id', v_request.order_id,
      'reason', nullif(v_reason, '')
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. purge_old_webhook_events(int) -> int
--
-- The dedupe window. A body older than this can no longer be recognised as a
-- duplicate, and Paystack's own retries are over long before it (72 hours in
-- live mode), so 30 days is generous. Clamped to 1..365 days.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_webhook_events(p_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days  int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_count int;
BEGIN
  DELETE FROM public.webhook_events e
  WHERE e.received_at < pg_catalog.now() - pg_catalog.make_interval(days => v_days);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Row level security
-- Enabled on the new table. There is no policy: no client role reads or writes
-- it, and the server reaches it through the service role, which bypasses RLS.
-- ----------------------------------------------------------------------------
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 12. Privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;

-- ----------------------------------------------------------------------------
-- 13. Functions are not callable from a browser
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.insert_webhook_event(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_webhook_event(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_order_by_reference(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_order(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_orders_needing_verification(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_open_refund(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_submitted(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_failed(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_webhook_events(int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.insert_webhook_event(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_webhook_event(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_order_by_reference(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_order(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_orders_needing_verification(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_open_refund(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_submitted(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_failed(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_webhook_events(int) TO service_role;

-- ----------------------------------------------------------------------------
-- 14. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261117000100', 'checkout_support')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops the webhook delivery log, so every event already received
-- becomes invisible and a redelivered body would be processed a second time.
-- The ledger is untouched: this file never wrote to it. Orders, refunds and
-- disputes keep every row they had before.
-- ============================================================================
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.purge_old_webhook_events(int);
-- DROP FUNCTION IF EXISTS public.mark_refund_failed(uuid, text);
-- DROP FUNCTION IF EXISTS public.mark_refund_submitted(uuid, text);
-- DROP FUNCTION IF EXISTS public.find_open_refund(text);
-- DROP FUNCTION IF EXISTS public.list_orders_needing_verification(int);
-- DROP FUNCTION IF EXISTS public.fail_order(text, text);
-- DROP FUNCTION IF EXISTS public.get_order_by_reference(text);
-- DROP FUNCTION IF EXISTS public.finish_webhook_event(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.insert_webhook_event(text, text, text, text);
--
-- DROP TABLE IF EXISTS public.webhook_events;
--
-- DELETE FROM public.app_migrations WHERE version = '20261117000100';
--
-- COMMIT;
-- ============================================================================
