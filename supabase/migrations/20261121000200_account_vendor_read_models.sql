-- ============================================================================
-- Migration 20261121000200_account_vendor_read_models
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the read models behind the customer account screens (purchases,
--         purchase detail, receipts) and the merchant screens (overview, sales,
--         refund requests, analytics), plus the one write that links a guest
--         order to the account that has now confirmed its email.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.profiles, public.audit_log,
-- public.app_migrations, public.has_role), 20261113000100_roles_onboarding.sql
-- (public.vendor_profiles), 20261114000100_catalog.sql (public.products,
-- public.product_files, public.product_images), 20261115000100_malware_scanning.sql
-- (public.product_files.scan_status), 20261116000200_commerce_core.sql
-- (public.orders, public.order_items, public.order_tax_lines,
-- public.entitlements, public.refund_requests, public.get_party_balance).
--
-- The rules, in one place:
--   * every function is SECURITY DEFINER with an empty search_path, and only the
--     service role may execute it;
--   * every function takes the actor as its FIRST argument and checks ownership
--     inside: a buyer sees only orders where buyer_user_id is their own id, a
--     vendor sees only the orders that contain one of their own products;
--   * claim_guest_orders() is the one write here. It never claims anything for an
--     email the account has not proved it owns, it is idempotent, and it writes
--     one audit row per real claim;
--   * no read model ever returns a storage key, a buyer name or a buyer email.
--     The vendor screens answer with order numbers and money, nothing about who
--     bought;
--   * a range is a range of whole Lagos days, and a range longer than 366 days
--     is refused rather than silently truncated;
--   * a page cursor is opaque JSON: it is parsed and checked, never trusted.
--
-- Money is bigint kobo throughout. Ratios are integer maths: basis points,
-- rounded half up, never a float.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Row level security
--
-- These tables are already protected by RLS in the migrations that created them
-- (public.orders, public.order_items, public.entitlements, ...). Re-stating it
-- here is a belt and braces: the read models below run as the definer and bypass
-- RLS, so the browser must never reach the tables directly.
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tax_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests   ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. public.claim_guest_orders(p_user uuid) -> int
--
-- A person may buy as a guest, with the same address they later sign up with.
-- This function links those earlier orders (and their file entitlements) to the
-- account, but only after the account has proved it owns the address:
--
--   * auth.users.email_confirmed_at must not be null, and
--   * the confirmed auth email must equal the profile email, ignoring case.
--
-- Otherwise nothing happens and the answer is 0. That is the whole point: a
-- signed-up stranger who typed someone else's address cannot walk away with
-- their downloads.
--
-- The match itself is on buyer_email, case-insensitively, and only on rows that
-- have no buyer yet (buyer_user_id is null), so a second call changes nothing,
-- writes no second audit row and returns 0.
--
-- The answer is the number of rows claimed: orders plus entitlements.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_guest_orders(p_user uuid)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email    text;
  v_confirmed_at  timestamptz;
  v_profile_email text;
  v_orders        int := 0;
  v_entitlements  int := 0;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT u.email, u.email_confirmed_at
    INTO v_auth_email, v_confirmed_at
    FROM auth.users u
   WHERE u.id = p_user;

  IF NOT FOUND OR v_confirmed_at IS NULL OR v_auth_email IS NULL THEN
    RETURN 0;
  END IF;

  SELECT p.email::text
    INTO v_profile_email
    FROM public.profiles p
   WHERE p.id = p_user;

  IF v_profile_email IS NULL OR pg_catalog.btrim(v_profile_email) = '' THEN
    RETURN 0;
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_auth_email))
     <> pg_catalog.lower(pg_catalog.btrim(v_profile_email)) THEN
    RETURN 0;
  END IF;

  UPDATE public.orders o
     SET buyer_user_id = p_user
   WHERE o.buyer_user_id IS NULL
     AND pg_catalog.lower(o.buyer_email::text)
         = pg_catalog.lower(pg_catalog.btrim(v_profile_email));

  GET DIAGNOSTICS v_orders = ROW_COUNT;

  UPDATE public.entitlements e
     SET buyer_user_id = p_user
   WHERE e.buyer_user_id IS NULL
     AND pg_catalog.lower(e.buyer_email::text)
         = pg_catalog.lower(pg_catalog.btrim(v_profile_email));

  GET DIAGNOSTICS v_entitlements = ROW_COUNT;

  IF v_orders + v_entitlements > 0 THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
    VALUES (
      p_user,
      'guest_orders.claimed',
      'profile',
      p_user::text,
      pg_catalog.jsonb_build_object(
        'orders', v_orders,
        'entitlements', v_entitlements
      )
    );
  END IF;

  RETURN v_orders + v_entitlements;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.account_orders(uuid, int, jsonb) -> jsonb
--
-- One page of the buyer's own purchases, newest first.
--
-- An order holds one product at launch, so the product columns come from its
-- first item. A buyer with no orders gets an empty list, not an error: an empty
-- purchases screen is a real answer.
--
-- Keyset pagination on (created_at, id), both descending, so two orders created
-- in the same transaction still page without a gap or a repeat.
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
  v_cursor_v  numeric;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_user
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'v') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_cursor_v := (p_cursor ->> 'v')::numeric;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_cursor_v IS NULL OR v_cursor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH base AS (
    SELECT
      o.id,
      o.number,
      o.status::text                  AS status,
      o.total_kobo,
      o.paid_at,
      o.created_at,
      it.title_snapshot               AS product_title,
      pr.slug::text                   AS product_slug,
      vp.business_name                AS vendor_name,
      (
        SELECT img.cloudinary_public_id
        FROM public.product_images img
        WHERE img.product_id = it.product_id
          AND img.is_cover
        LIMIT 1
      )                               AS cover_public_id,
      EXTRACT(epoch FROM o.created_at)::numeric AS sort_value
    FROM public.orders o
    JOIN LATERAL (
      SELECT i.product_id, i.vendor_id, i.title_snapshot
      FROM public.order_items i
      WHERE i.order_id = o.id
      ORDER BY i.created_at, i.id
      LIMIT 1
    ) it ON true
    LEFT JOIN public.products pr ON pr.id = it.product_id
    LEFT JOIN public.vendor_profiles vp ON vp.user_id = it.vendor_id
    WHERE o.buyer_user_id = p_user
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY sort_value DESC, id DESC) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR sort_value < v_cursor_v
       OR (sort_value = v_cursor_v AND id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'order_id', id,
          'number', number,
          'status', status,
          'total_kobo', total_kobo,
          'paid_at', paid_at,
          'created_at', created_at,
          'product_title', product_title,
          'product_slug', product_slug,
          'vendor_name', vendor_name,
          'cover_public_id', cover_public_id
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', sort_value::text, 'id', id)
        FROM ranked
        WHERE rn = v_limit
      )
      ELSE NULL
    END
  INTO v_items, v_next
  FROM ranked;

  RETURN pg_catalog.jsonb_build_object('items', v_items, 'next_cursor', v_next);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.account_order_detail(uuid, uuid) -> jsonb
--
-- One order the buyer owns: the order itself, its items, its tax lines, the end
-- of its refund window, the refund request if there is one, and the files the
-- buyer may download.
--
-- The file list deliberately carries no storage key. A key is a credential; the
-- only way to a URL is claim_download(), which counts the download and checks the
-- file's scan state again.
--
-- An order that does not exist and an order that belongs to someone else both
-- answer 'not_found' for a missing id and 'forbidden' for a real one that is not
-- theirs. Neither answer contains any of the order's data.
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
  v_order             public.orders;
  v_items             jsonb;
  v_tax_lines         jsonb;
  v_entitlements      jsonb;
  v_refund            jsonb;
  v_refund_window_end timestamptz;
  v_window_hours      int;
BEGIN
  IF p_user IS NULL OR p_order IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_order.buyer_user_id IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'order_item_id', i.id,
               'product_id', i.product_id,
               'title', i.title_snapshot,
               'unit_price_kobo', i.unit_price_kobo,
               'vendor_name', vp.business_name
             )
             ORDER BY i.created_at, i.id
           ),
           '[]'::jsonb
         )
    INTO v_items
    FROM public.order_items i
    LEFT JOIN public.vendor_profiles vp ON vp.user_id = i.vendor_id
   WHERE i.order_id = p_order;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'basis', l.basis,
               'rate_bps', l.rate_bps,
               'base_kobo', l.base_kobo,
               'tax_kobo', l.tax_kobo,
               'included', l.included,
               'supplier', l.supplier
             )
             ORDER BY l.created_at, l.id
           ),
           '[]'::jsonb
         )
    INTO v_tax_lines
    FROM public.order_tax_lines l
   WHERE l.order_id = p_order;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'entitlement_id', e.id,
               'file_display_name', f.original_name,
               'size_bytes', f.size_bytes,
               'downloads_used', e.downloads_used,
               'max_downloads', e.max_downloads,
               'revoked', e.revoked_at IS NOT NULL,
               'scan_clean', f.scan_status = 'clean'
             )
             ORDER BY f.original_name, e.id
           ),
           '[]'::jsonb
         )
    INTO v_entitlements
    FROM public.entitlements e
    JOIN public.product_files f ON f.id = e.file_id
   WHERE e.order_item_id IN (
           SELECT i.id FROM public.order_items i WHERE i.order_id = p_order
         );

  SELECT pg_catalog.jsonb_build_object(
           'status', r.status,
           'auto_approved', r.auto_approved
         )
    INTO v_refund
    FROM public.refund_requests r
   WHERE r.order_id = p_order
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;

  SELECT i.refund_window_hours
    INTO v_window_hours
    FROM public.order_items i
   WHERE i.order_id = p_order
   ORDER BY i.created_at, i.id
   LIMIT 1;

  IF v_order.paid_at IS NOT NULL AND v_window_hours IS NOT NULL THEN
    v_refund_window_end := v_order.paid_at
                           + pg_catalog.make_interval(hours => v_window_hours);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order.id,
    'number', v_order.number,
    'status', v_order.status::text,
    'currency', v_order.currency,
    'subtotal_kobo', v_order.subtotal_kobo,
    'tax_kobo', v_order.tax_kobo,
    'tax_included', v_order.tax_included,
    'total_kobo', v_order.total_kobo,
    'channel', v_order.channel,
    'paid_at', v_order.paid_at,
    'created_at', v_order.created_at,
    'refund_window_ends_at', v_refund_window_end,
    'items', v_items,
    'tax_lines', v_tax_lines,
    'refund_request', v_refund,
    'entitlements', v_entitlements
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.vendor_overview(uuid, timestamptz, timestamptz) -> jsonb
--
-- The merchant's headline numbers for a range of whole Lagos days.
--
-- The two instants are turned into Lagos dates first, so a request at 23:30 UTC
-- belongs to the Lagos day that has already started, and the range always covers
-- whole days whatever hour the screen was opened.
--
-- What counts as a sale here: an order that reached the vendor's product and is
-- paid, refunded or disputed. A pending, expired or failed order never moved
-- money, so it is not a sale.
--
--   orders                  distinct orders in the range
--   gross_kobo              what buyers paid for this vendor's items
--   vendor_net_kobo         what is left for the vendor after fees and commission
--   platform_fee_kobo       the platform's fee on those items
--   affiliate_commission_kobo  what affiliates earned on them
--   affiliate_orders        orders that came through an affiliate link
--   refunds_count           orders in the range that were refunded
--   refunds_kobo            this vendor's item value on those refunded orders
--   refund_rate_bps         refunds_kobo / gross_kobo, rounded half up
--   pending_kobo            ledger balance still inside the hold (all time)
--   available_kobo          ledger balance withdrawable now (all time)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_overview(
  p_vendor uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from_day    date;
  v_to_day      date;
  v_start       timestamptz;
  v_end         timestamptz;
  v_orders      int := 0;
  v_gross       bigint := 0;
  v_vendor_net  bigint := 0;
  v_platform    bigint := 0;
  v_affiliate   bigint := 0;
  v_refunds     int := 0;
  v_aff_orders  int := 0;
  v_refund_kobo bigint := 0;
  v_rate        int := 0;
  v_balance     jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  v_from_day := (p_from AT TIME ZONE 'Africa/Lagos')::date;
  v_to_day   := (p_to AT TIME ZONE 'Africa/Lagos')::date;

  IF v_from_day > v_to_day OR (v_to_day - v_from_day) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  v_start := v_from_day::timestamp AT TIME ZONE 'Africa/Lagos';
  v_end   := (v_to_day + 1)::timestamp AT TIME ZONE 'Africa/Lagos';

  SELECT
    pg_catalog.count(DISTINCT o.id)::int,
    coalesce(pg_catalog.sum(i.unit_price_kobo), 0)::bigint,
    coalesce(pg_catalog.sum(coalesce(i.vendor_net_kobo, 0)), 0)::bigint,
    coalesce(pg_catalog.sum(coalesce(i.platform_fee_kobo, 0)), 0)::bigint,
    coalesce(pg_catalog.sum(coalesce(i.affiliate_commission_kobo, 0)), 0)::bigint,
    pg_catalog.count(DISTINCT o.id) FILTER (WHERE o.status = 'refunded')::int,
    pg_catalog.count(DISTINCT o.id) FILTER (WHERE i.affiliate_id IS NOT NULL)::int,
    coalesce(pg_catalog.sum(i.unit_price_kobo) FILTER (WHERE o.status = 'refunded'), 0)::bigint
  INTO v_orders, v_gross, v_vendor_net, v_platform, v_affiliate, v_refunds, v_aff_orders, v_refund_kobo
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.vendor_id = p_vendor
    AND o.status IN ('paid', 'refunded', 'disputed')
    AND o.paid_at >= v_start
    AND o.paid_at < v_end;

  IF v_gross > 0 THEN
    -- Round half up, in integers: no float ever touches a rate.
    v_rate := ((v_refund_kobo * 10000) + (v_gross / 2)) / v_gross;
  END IF;

  v_balance := public.get_party_balance(p_vendor);

  RETURN pg_catalog.jsonb_build_object(
    'orders', v_orders,
    'gross_kobo', v_gross,
    'vendor_net_kobo', v_vendor_net,
    'platform_fee_kobo', v_platform,
    'affiliate_commission_kobo', v_affiliate,
    'affiliate_orders', v_aff_orders,
    'refunds_count', v_refunds,
    'refunds_kobo', v_refund_kobo,
    'refund_rate_bps', v_rate,
    'pending_kobo', coalesce((v_balance ->> 'pending_kobo')::bigint, 0),
    'available_kobo', coalesce((v_balance ->> 'available_kobo')::bigint, 0)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. public.vendor_daily_series(uuid, date, date)
--
-- One row per Lagos day in the range, including days with no sale: the
-- generate_series is the spine and the sales are joined onto it, so a quiet day
-- is a zero row rather than a missing one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_daily_series(
  p_vendor uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  day            date,
  orders         int,
  gross_kobo     bigint,
  vendor_net_kobo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  RETURN QUERY
  SELECT
    d.day::date,
    coalesce(s.orders, 0)::int,
    coalesce(s.gross_kobo, 0)::bigint,
    coalesce(s.vendor_net_kobo, 0)::bigint
  FROM pg_catalog.generate_series(
         p_from::timestamp,
         p_to::timestamp,
         interval '1 day'
       ) AS d(day)
  LEFT JOIN (
    SELECT
      (o.paid_at AT TIME ZONE 'Africa/Lagos')::date AS sale_day,
      pg_catalog.count(DISTINCT o.id)::int          AS orders,
      pg_catalog.sum(i.unit_price_kobo)::bigint     AS gross_kobo,
      pg_catalog.sum(coalesce(i.vendor_net_kobo, 0))::bigint AS vendor_net_kobo
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    WHERE i.vendor_id = p_vendor
      AND o.status IN ('paid', 'refunded', 'disputed')
      AND o.paid_at >= (p_from::timestamp AT TIME ZONE 'Africa/Lagos')
      AND o.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
    GROUP BY 1
  ) s ON s.sale_day = d.day::date
  ORDER BY d.day;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. public.vendor_sales_list(uuid, text, int, jsonb) -> jsonb
--
-- The vendor's sales, newest first, with no buyer name and no buyer email: a
-- vendor sees what sold and what it earned, never who bought.
--
-- p_status is one of the order states, or null/empty for every order. An order
-- with several of the vendor's items is one row: the items are summed and the
-- product title is the first one.
--
-- Keyset pagination on (paid_at or created_at, id), both descending.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_sales_list(
  p_vendor uuid,
  p_status text,
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
  v_status    text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, ''))), '');
  v_limit     int;
  v_cursor_v  numeric;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'disputed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'v') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_cursor_v := (p_cursor ->> 'v')::numeric;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_cursor_v IS NULL OR v_cursor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH per_order AS (
    SELECT
      o.id,
      o.number,
      o.status::text                                  AS status,
      o.paid_at,
      o.created_at,
      pg_catalog.sum(i.unit_price_kobo)::bigint        AS gross_kobo,
      pg_catalog.sum(coalesce(i.vendor_net_kobo, 0))::bigint AS vendor_net_kobo,
      pg_catalog.bool_or(i.affiliate_id IS NOT NULL)   AS via_affiliate,
      (pg_catalog.array_agg(i.title_snapshot ORDER BY i.created_at, i.id))[1] AS product_title
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    WHERE i.vendor_id = p_vendor
      AND (v_status IS NULL OR o.status::text = v_status)
    GROUP BY o.id, o.number, o.status, o.paid_at, o.created_at
  ),
  base AS (
    SELECT
      per_order.*,
      EXTRACT(epoch FROM coalesce(per_order.paid_at, per_order.created_at))::numeric AS sort_value
    FROM per_order
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY sort_value DESC, id DESC) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR sort_value < v_cursor_v
       OR (sort_value = v_cursor_v AND id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'order_number', number,
          'product_title', product_title,
          'status', status,
          'paid_at', paid_at,
          'gross_kobo', gross_kobo,
          'vendor_net_kobo', vendor_net_kobo,
          'via_affiliate', via_affiliate
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', sort_value::text, 'id', id)
        FROM ranked
        WHERE rn = v_limit
      )
      ELSE NULL
    END
  INTO v_items, v_next
  FROM ranked;

  RETURN pg_catalog.jsonb_build_object('items', v_items, 'next_cursor', v_next);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. public.vendor_refund_requests(uuid, text, int, jsonb) -> jsonb
--
-- The refund requests on the vendor's orders, newest first. amount_kobo is what
-- the buyer paid for the order, which is the amount a full refund returns (only
-- full refunds exist at launch).
--
-- p_status is one of the request states, or null/empty for all of them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_refund_requests(
  p_vendor uuid,
  p_status text,
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
  v_status    text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, ''))), '');
  v_limit     int;
  v_cursor_v  numeric;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('requested', 'approved', 'rejected', 'processed', 'failed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'v') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_cursor_v := (p_cursor ->> 'v')::numeric;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_cursor_v IS NULL OR v_cursor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH base AS (
    SELECT
      r.id,
      r.created_at,
      r.reason,
      r.status,
      r.auto_approved,
      r.decided_at,
      o.number                                       AS order_number,
      o.total_kobo                                   AS amount_kobo,
      (pg_catalog.array_agg(i.title_snapshot ORDER BY i.created_at, i.id))[1] AS product_title,
      EXTRACT(epoch FROM r.created_at)::numeric      AS sort_value
    FROM public.refund_requests r
    JOIN public.orders o ON o.id = r.order_id
    JOIN public.order_items i ON i.order_id = o.id AND i.vendor_id = p_vendor
    WHERE (v_status IS NULL OR r.status = v_status)
    GROUP BY r.id, r.created_at, r.reason, r.status, r.auto_approved,
             r.decided_at, o.number, o.total_kobo
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY sort_value DESC, id DESC) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR sort_value < v_cursor_v
       OR (sort_value = v_cursor_v AND id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'request_id', id,
          'order_number', order_number,
          'product_title', product_title,
          'reason', reason,
          'status', status,
          'auto_approved', auto_approved,
          'requested_at', created_at,
          'decided_at', decided_at,
          'amount_kobo', amount_kobo
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', sort_value::text, 'id', id)
        FROM ranked
        WHERE rn = v_limit
      )
      ELSE NULL
    END
  INTO v_items, v_next
  FROM ranked;

  RETURN pg_catalog.jsonb_build_object('items', v_items, 'next_cursor', v_next);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. public.vendor_top_products(uuid, date, date)
--
-- The ten products that earned the most in the range, with how many orders and
-- how many of those were refunded. Ordered by gross, then by title so a tie is
-- stable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_top_products(
  p_vendor uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  product_id uuid,
  title      text,
  orders     int,
  gross_kobo bigint,
  refunds    int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  RETURN QUERY
  SELECT
    i.product_id,
    pr.title,
    pg_catalog.count(DISTINCT o.id)::int                                     AS orders,
    pg_catalog.sum(i.unit_price_kobo)::bigint                                AS gross_kobo,
    pg_catalog.count(DISTINCT o.id) FILTER (WHERE o.status = 'refunded')::int AS refunds
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  JOIN public.products pr ON pr.id = i.product_id
  WHERE i.vendor_id = p_vendor
    AND o.status IN ('paid', 'refunded', 'disputed')
    AND o.paid_at >= (p_from::timestamp AT TIME ZONE 'Africa/Lagos')
    AND o.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
  GROUP BY i.product_id, pr.title
  -- Positional on purpose: the output column names are plpgsql variables here,
  -- so naming them in ORDER BY would be ambiguous.
  ORDER BY 4 DESC, 2 ASC, 1 ASC
  LIMIT 10;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Function privileges
--
-- Nothing here is callable by a browser role. The server calls these with the
-- service role key, and every one of them re-checks the actor it was given.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 11. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261121000200', 'account_vendor_read_models')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Nothing here owns data: every function is a read
-- model over tables other migrations created, except claim_guest_orders(), whose
-- one effect is to fill buyer_user_id on rows that were already the buyer's own.
-- Those links are left in place by the rollback: undoing them would take a
-- buyer's purchases away from their account. The audit rows written by
-- claim_guest_orders() stay in public.audit_log for the same reason.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.vendor_top_products(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.vendor_refund_requests(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vendor_sales_list(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vendor_daily_series(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.vendor_overview(uuid, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.account_order_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.account_orders(uuid, int, jsonb);
-- DROP FUNCTION IF EXISTS public.claim_guest_orders(uuid);
--
-- DELETE FROM public.app_migrations WHERE version = '20261121000200';
--
-- COMMIT;
-- ============================================================================
