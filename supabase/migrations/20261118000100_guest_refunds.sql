-- ============================================================================
-- Migration 20261118000100_guest_refunds
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  one function, request_refund_by_email, so a buyer who paid as a guest
--         can ask for a refund from the download link in their receipt.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261116000200_commerce_core.sql (public.orders,
-- public.order_items, public.refund_requests, public.audit_log,
-- public.request_refund) and on 20261112000100_foundation.sql
-- (public.app_migrations).
--
-- Why a second function instead of a new argument on request_refund: that one
-- takes the buyer's auth user id and compares it with orders.buyer_user_id, which
-- a guest order does not have. Changing its signature would mean changing every
-- caller and every grant for a rule that only the access page needs. The rules
-- below are deliberately a copy of request_refund's, with one difference: the
-- caller proves ownership with the email the order was bought with, not with a
-- session.
--
-- Nothing here reads or writes the ledger. A refund becomes money only through
-- process_refund, when Paystack confirms it moved.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.request_refund_by_email(uuid, text, text) -> jsonb
--
-- The same rules as request_refund, in the same order:
--   * the reason is trimmed and must be 10 to 1000 characters;
--   * the order must exist and be paid;
--   * the request is auto-approved while the product's refund window is open;
--   * at most one open request per order (the partial unique index on
--     refund_requests), so a second ask raises refund_exists.
--
-- The one difference: ownership. The caller passes the address the order was
-- bought with, and it must equal orders.buyer_email after trimming and
-- lower-casing. A mismatch raises forbidden, and it is checked before the order's
-- status so a stranger cannot learn whether an order is paid, refunded or still
-- pending from this function.
--
-- requested_by is left NULL: there is no session, and the audit row records that
-- the request came through the buyer's own access link.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_refund_by_email(
  p_order  uuid,
  p_email  text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order  public.orders;
  v_item   public.order_items;
  v_reason text;
  v_email  text;
  v_auto   boolean;
  v_id     uuid;
BEGIN
  IF p_order IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  v_email  := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));

  IF char_length(v_reason) < 10 OR char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_email = ''
     OR v_order.buyer_email IS NULL
     OR pg_catalog.lower(pg_catalog.btrim(v_order.buyer_email)) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'not_refundable';
  END IF;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = p_order
  ORDER BY i.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_refundable';
  END IF;

  v_auto := pg_catalog.now() <= v_order.paid_at
            + pg_catalog.make_interval(hours => v_item.refund_window_hours);

  BEGIN
    INSERT INTO public.refund_requests (
      order_id, requested_by, reason, status, auto_approved, decided_at
    )
    VALUES (
      p_order, NULL, v_reason,
      CASE WHEN v_auto THEN 'approved' ELSE 'requested' END,
      v_auto,
      CASE WHEN v_auto THEN pg_catalog.now() ELSE NULL END
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'refund_exists';
  END;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL, 'refund.requested', 'refund_request', v_id::text,
    pg_catalog.jsonb_build_object(
      'order_id', p_order,
      'auto_approved', v_auto,
      'reason', v_reason,
      'via', 'access_link'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'request_id', v_id,
    'auto_approved', v_auto
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Row level security and privileges
--
-- No table is created here, so the only RLS statement is the one that keeps
-- refund_requests closed to the browser roles (it was already enabled by
-- 20261116000200_commerce_core.sql; repeating it is harmless).
-- ----------------------------------------------------------------------------
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.request_refund_by_email(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_refund_by_email(uuid, text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261118000100', 'guest_refunds')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Refund requests the function created are kept:
-- they are real records of what a buyer asked for, and dropping the function does
-- not make them untrue.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.request_refund_by_email(uuid, text, text);
--
-- DELETE FROM public.app_migrations WHERE version = '20261118000100';
--
-- COMMIT;
-- ============================================================================
