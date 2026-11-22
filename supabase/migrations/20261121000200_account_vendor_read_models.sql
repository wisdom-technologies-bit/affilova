-- ============================================================================
-- Migration 20261121000200_account_vendor_read_models
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: read models and helpers for customer account and merchant screens:
--   1. claim_guest_orders
--   2. account_orders
--   3. account_order_detail
--   4. vendor_overview
--   5. vendor_daily_series
--   6. vendor_sales_list
--   7. vendor_refund_requests
--   8. vendor_top_products
--
-- This file is idempotent: running it twice must not raise an error.
-- Depends on foundation, roles_onboarding, catalog, commerce_core, checkout_support, affiliate_tracking.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.claim_guest_orders(uuid) -> int
-- Only when auth email is confirmed and matches profile email.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_guest_orders(p_user uuid)
RETURNS int
LANGUAGE plpgsql
VOLATILITY
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_count int := 0;
BEGIN
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email))
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_user
    AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user
      AND pg_catalog.lower(pg_catalog.btrim(p.email)) = v_email
  ) THEN
    RETURN 0;
  END IF;

  WITH updated_orders AS (
    UPDATE public.orders
    SET buyer_user_id = p_user
    WHERE buyer_user_id IS NULL
      AND pg_catalog.lower(buyer_email::text) = v_email
    RETURNING id
  ),
  updated_entitlements AS (
    UPDATE public.entitlements
    SET buyer_user_id = p_user
    WHERE buyer_user_id IS NULL
      AND pg_catalog.lower(buyer_email::text) = v_email
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM updated_orders;

  IF v_count > 0 THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
    VALUES (
      p_user,
      'orders.claimed',
      'user',
      p_user::text,
      pg_catalog.jsonb_build_object('claimed_count', v_count, 'email', v_email)
    );
  END IF;

  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. public.account_orders(uuid, int, jsonb) -> jsonb
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_orders(
  p_user   uuid,
  p_limit  int,
  p_cursor jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit     int;
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF p_user IS DISTINCT FROM (SELECT auth.uid()) THEN
    -- Allow service_role or self
    NULL;
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'ts') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
    BEGIN
      v_cursor_ts := (p_cursor ->> 'ts')::timestamptz;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'order_id', o.id,
      'number', o.number,
      'status', o.status,
      'total_kobo', o.total_kobo,
      'paid_at', o.paid_at,
      'created_at', o.created_at,
      'product_title', p.title,
      'product_slug', p.slug,
      'vendor_name', vp.business_name,
      'cover_public_id', pi.public_id
    )
  )
  INTO v_items
  FROM (
    SELECT o.*, i.product_id
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT product_id FROM public.order_items oi WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1
    ) i ON true
    WHERE o.buyer_user_id = p_user
      AND (
        v_cursor_ts IS NULL
        OR (o.created_at, o.id) < (v_cursor_ts, v_cursor_id)
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_limit + 1
  ) o
  LEFT JOIN public.products p ON p.id = o.product_id
  LEFT JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
  LEFT JOIN public.product_images pi ON pi.product_id = p.id AND pi.is_cover = true;

  v_items := coalesce(v_items, '[]'::jsonb);

  IF pg_catalog.jsonb_array_length(v_items) > v_limit THEN
    -- truncate and build next cursor
    SELECT pg_catalog.jsonb_build_object(
      'ts', (v_items -> v_limit - 1) ->> 'created_at',
      'id', (v_items -> v_limit - 1) ->> 'order_id'
    )
    INTO v_next;

    -- trim array
    SELECT pg_catalog.jsonb_agg(elem)
    INTO v_items
    FROM (
      SELECT elem FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, idx)
      WHERE idx <= v_limit
    ) sub;
  ELSE
    v_next := null;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.account_order_detail(uuid, uuid) -> jsonb
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_order_detail(
  p_user  uuid,
  p_order uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order    public.orders;
  v_items    jsonb;
  v_taxes    jsonb;
  v_ents     jsonb;
  v_req      jsonb;
  v_window   timestamptz;
BEGIN
  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order AND o.buyer_user_id = p_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Items
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'order_item_id', oi.id,
      'product_id', oi.product_id,
      'product_title', p.title,
      'product_slug', p.slug,
      'vendor_name', vp.business_name,
      'quantity', oi.quantity,
      'unit_amount_kobo', oi.unit_amount_kobo,
      'total_amount_kobo', oi.total_amount_kobo,
      'refund_window_hours', oi.refund_window_hours
    )
  )
  INTO v_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
  WHERE oi.order_id = p_order;

  -- Tax lines
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'tax_line_id', ot.id,
      'rate_bps', ot.rate_bps,
      'amount_kobo', ot.amount_kobo
    )
  )
  INTO v_taxes
  FROM public.order_tax_lines ot
  WHERE ot.order_id = p_order;

  -- Entitlements (no storage keys)
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'entitlement_id', e.id,
      'file_display_name', f.display_name,
      'size_bytes', f.size_bytes,
      'downloads_used', e.downloads_used,
      'max_downloads', e.max_downloads,
      'revoked', e.revoked,
      'scan_clean', (fs.status = 'clean')
    )
  )
  INTO v_ents
  FROM public.entitlements e
  JOIN public.product_files f ON f.id = e.file_id
  LEFT JOIN public.file_scans fs ON fs.file_id = f.id
  WHERE e.order_id = p_order;

  -- Refund request
  SELECT pg_catalog.jsonb_build_object(
    'request_id', rr.id,
    'status', rr.status,
    'auto_approved', rr.auto_approved,
    'reason', rr.reason,
    'requested_at', rr.requested_at,
    'amount_kobo', rr.amount_kobo
  )
  INTO v_req
  FROM public.refund_requests rr
  WHERE rr.order_id = p_order;

  -- Refund window ends at (from first item)
  SELECT v_order.paid_at + pg_catalog.make_interval(hours => oi.refund_window_hours)
  INTO v_window
  FROM public.order_items oi
  WHERE oi.order_id = p_order
  ORDER BY oi.created_at
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order.id,
    'number', v_order.number,
    'status', v_order.status,
    'currency', v_order.currency,
    'subtotal_kobo', v_order.subtotal_kobo,
    'discount_total_kobo', v_order.discount_total_kobo,
    'tax_total_kobo', v_order.tax_total_kobo,
    'total_kobo', v_order.total_kobo,
    'channel', v_order.channel,
    'paid_at', v_order.paid_at,
    'created_at', v_order.created_at,
    'refund_window_ends_at', v_window,
    'items', coalesce(v_items, '[]'::jsonb),
    'tax_lines', coalesce(v_taxes, '[]'::jsonb),
    'entitlements', coalesce(v_ents, '[]'::jsonb),
    'refund_request', v_req
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.vendor_overview(uuid, timestamptz, timestamptz) -> jsonb
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_overview(
  p_vendor    uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orders     int := 0;
  v_gross      bigint := 0;
  v_net        bigint := 0;
  v_fee        bigint := 0;
  v_aff_comm   bigint := 0;
  v_ref_count  int := 0;
  v_ref_kobo   bigint := 0;
  v_ref_rate   int := 0;
  v_pending    bigint := 0;
  v_available  bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.user_id = p_vendor AND vp.status = 'active') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    count(DISTINCT o.id)::int,
    coalesce(sum(oi.total_amount_kobo), 0)::bigint,
    coalesce(sum(lt.vendor_net_kobo), 0)::bigint,
    coalesce(sum(lt.platform_fee_kobo), 0)::bigint,
    coalesce(sum(lt.affiliate_commission_kobo), 0)::bigint
  INTO v_orders, v_gross, v_net, v_fee, v_aff_comm
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.ledger_transactions lt ON lt.order_id = o.id
  WHERE p.vendor_id = p_vendor
    AND o.status = 'paid'
    AND (p_from IS NULL OR o.created_at >= p_from)
    AND (p_to IS NULL OR o.created_at <= p_to);

  -- Refunds
  SELECT
    count(DISTINCT rr.id)::int,
    coalesce(sum(rr.amount_kobo), 0)::bigint
  INTO v_ref_count, v_ref_kobo
  FROM public.refund_requests rr
  JOIN public.orders o ON o.id = rr.order_id
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products p ON p.id = oi.product_id
  WHERE p.vendor_id = p_vendor
    AND rr.status = 'approved'
    AND (p_from IS NULL OR rr.requested_at >= p_from)
    AND (p_to IS NULL OR rr.requested_at <= p_to);

  IF v_orders > 0 THEN
    v_ref_rate := (v_ref_count * 10000) / v_orders;
  END IF;

  -- Balances using get_party_balance or ledger entries
  SELECT coalesce(sum(amount_kobo), 0)::bigint INTO v_available
  FROM public.ledger_entries
  WHERE party_id = p_vendor AND status = 'cleared';

  SELECT coalesce(sum(amount_kobo), 0)::bigint INTO v_pending
  FROM public.ledger_entries
  WHERE party_id = p_vendor AND status = 'pending';

  RETURN pg_catalog.jsonb_build_object(
    'orders', v_orders,
    'gross_kobo', v_gross,
    'vendor_net_kobo', v_net,
    'platform_fee_kobo', v_fee,
    'affiliate_commission_kobo', v_aff_comm,
    'refunds_count', v_ref_count,
    'refunds_kobo', v_ref_kobo,
    'refund_rate_bps', v_ref_rate,
    'pending_kobo', v_pending,
    'available_kobo', v_available
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.vendor_daily_series(uuid, date, date)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_daily_series(
  p_vendor uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  day           date,
  orders        int,
  gross_kobo    bigint,
  vendor_net_kobo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.user_id = p_vendor AND vp.status = 'active') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS dt
    FROM pg_catalog.generate_series(coalesce(p_from, current_date - 29), coalesce(p_to, current_date), interval '1 day') d
  ),
  agg AS (
    SELECT
      (o.created_at AT TIME ZONE 'Africa/Lagos')::date AS dt,
      count(DISTINCT o.id)::int AS ords,
      coalesce(sum(oi.total_amount_kobo), 0)::bigint AS gross,
      coalesce(sum(lt.vendor_net_kobo), 0)::bigint AS net
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.ledger_transactions lt ON lt.order_id = o.id
    WHERE p.vendor_id = p_vendor
      AND o.status = 'paid'
    GROUP BY (o.created_at AT TIME ZONE 'Africa/Lagos')::date
  )
  SELECT
    d.dt,
    coalesce(a.ords, 0),
    coalesce(a.gross, 0),
    coalesce(a.net, 0)
  FROM days d
  LEFT JOIN agg a ON a.dt = d.dt
  ORDER BY d.dt;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. public.vendor_sales_list(uuid, text, int, jsonb) -> jsonb
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_sales_list(
  p_vendor   uuid,
  p_status   text,
  p_limit    int,
  p_cursor   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit     int;
  v_status    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, 'all')));
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.user_id = p_vendor AND vp.status = 'active') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'ts') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
    BEGIN
      v_cursor_ts := (p_cursor ->> 'ts')::timestamptz;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'order_id', o.id,
      'order_number', o.number,
      'product_title', p.title,
      'status', o.status,
      'paid_at', o.paid_at,
      'gross_kobo', oi.total_amount_kobo,
      'vendor_net_kobo', coalesce(lt.vendor_net_kobo, 0),
      'via_affiliate', (o.affiliate_id IS NOT NULL)
    )
  )
  INTO v_items
  FROM (
    SELECT o.*, oi.product_id, oi.total_amount_kobo
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.ledger_transactions lt ON lt.order_id = o.id
    WHERE p.vendor_id = p_vendor
      AND (v_status = 'all' OR o.status = v_status)
      AND (
        v_cursor_ts IS NULL
        OR (o.created_at, o.id) < (v_cursor_ts, v_cursor_id)
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_limit + 1
  ) o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.ledger_transactions lt ON lt.order_id = o.id;

  v_items := coalesce(v_items, '[]'::jsonb);

  IF pg_catalog.jsonb_array_length(v_items) > v_limit THEN
    SELECT pg_catalog.jsonb_build_object(
      'ts', (v_items -> v_limit - 1) ->> 'paid_at',
      'id', (v_items -> v_limit - 1) ->> 'order_id'
    )
    INTO v_next;

    SELECT pg_catalog.jsonb_agg(elem)
    INTO v_items
    FROM (
      SELECT elem FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, idx)
      WHERE idx <= v_limit
    ) sub;
  ELSE
    v_next := null;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. public.vendor_refund_requests(uuid, text, int, jsonb) -> jsonb
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_refund_requests(
  p_vendor   uuid,
  p_status   text,
  p_limit    int,
  p_cursor   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit     int;
  v_status    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, 'all')));
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.user_id = p_vendor AND vp.status = 'active') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'ts') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
    BEGIN
      v_cursor_ts := (p_cursor ->> 'ts')::timestamptz;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'request_id', rr.id,
      'order_number', o.number,
      'product_title', p.title,
      'reason', rr.reason,
      'status', rr.status,
      'auto_approved', rr.auto_approved,
      'requested_at', rr.requested_at,
      'decided_at', rr.decided_at,
      'amount_kobo', rr.amount_kobo
    )
  )
  INTO v_items
  FROM (
    SELECT rr.*
    FROM public.refund_requests rr
    JOIN public.orders o ON o.id = rr.order_id
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.products p ON p.id = oi.product_id
    WHERE p.vendor_id = p_vendor
      AND (v_status = 'all' OR rr.status = v_status)
      AND (
        v_cursor_ts IS NULL
        OR (rr.requested_at, rr.id) < (v_cursor_ts, v_cursor_id)
      )
    ORDER BY rr.requested_at DESC, rr.id DESC
    LIMIT v_limit + 1
  ) rr
  JOIN public.orders o ON o.id = rr.order_id
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products p ON p.id = oi.product_id;

  v_items := coalesce(v_items, '[]'::jsonb);

  IF pg_catalog.jsonb_array_length(v_items) > v_limit THEN
    SELECT pg_catalog.jsonb_build_object(
      'ts', (v_items -> v_limit - 1) ->> 'requested_at',
      'id', (v_items -> v_limit - 1) ->> 'request_id'
    )
    INTO v_next;

    SELECT pg_catalog.jsonb_agg(elem)
    INTO v_items
    FROM (
      SELECT elem FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(elem, idx)
      WHERE idx <= v_limit
    ) sub;
  ELSE
    v_next := null;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. public.vendor_top_products(uuid, date, date)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_top_products(
  p_vendor uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  product_id   uuid,
  title        text,
  slug         text,
  orders_count int,
  gross_kobo   bigint,
  refunds_kobo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.user_id = p_vendor AND vp.status = 'active') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.slug,
    count(DISTINCT o.id)::int,
    coalesce(sum(oi.total_amount_kobo), 0)::bigint,
    coalesce(sum(rr.amount_kobo), 0)::bigint
  FROM public.products p
  JOIN public.order_items oi ON oi.product_id = p.id
  JOIN public.orders o ON o.id = oi.order_id AND o.status = 'paid'
  LEFT JOIN public.refund_requests rr ON rr.order_id = o.id AND rr.status = 'approved'
  WHERE p.vendor_id = p_vendor
    AND (p_from IS NULL OR o.created_at::date >= p_from)
    AND (p_to IS NULL OR o.created_at::date <= p_to)
  GROUP BY p.id, p.title, p.slug
  ORDER BY sum(oi.total_amount_kobo) DESC
  LIMIT 10;
END;
$$;

-- Record migration
INSERT INTO public.app_migrations (version, name)
VALUES ('20261121000200', 'account_vendor_read_models')
ON CONFLICT (version) DO NOTHING;

REVOKE ALL ON FUNCTION public.claim_guest_orders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_orders(uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_order_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_daily_series(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_sales_list(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_refund_requests(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_top_products(uuid, date, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_guest_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_orders(uuid, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_order_detail(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_overview(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_daily_series(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_sales_list(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_refund_requests(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_top_products(uuid, date, date) TO service_role;

COMMIT;

-- ============================================================================
-- Rollback:
-- DROP FUNCTION IF EXISTS public.claim_guest_orders(uuid);
-- DROP FUNCTION IF EXISTS public.account_orders(uuid, int, jsonb);
-- DROP FUNCTION IF EXISTS public.account_order_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.vendor_overview(uuid, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.vendor_daily_series(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.vendor_sales_list(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vendor_refund_requests(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vendor_top_products(uuid, date, date);
-- DELETE FROM public.app_migrations WHERE version = '20261121000200';
-- ============================================================================
