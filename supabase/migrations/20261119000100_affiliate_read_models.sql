-- ============================================================================
-- Migration 20261119000100_affiliate_read_models
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the read models behind the affiliate and merchant screens: the
--         marketplace, the overview numbers, the daily series, per-link stats,
--         the campaign breakdown, the commission list, and the vendor's side
--         (requests, affiliate performance and invites).
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.has_role, public.audit_log,
-- public.app_migrations), 20261113000100_roles_onboarding.sql
-- (public.vendor_profiles, public.affiliate_profiles),
-- 20261114000100_catalog.sql (public.products, public.product_images,
-- public.product_categories) and 20261118000200_affiliate_tracking.sql
-- (public.affiliate_links, public.affiliate_clicks, public.affiliate_daily_stats,
-- public.affiliate_product_access, public.affiliate_invites) and
-- 20261116000200_commerce_core.sql (public.orders, public.order_items,
-- public.ledger_transactions, public.ledger_entries,
-- public.get_party_balance).
--
-- The rules, in one place:
--   * every function is a read model except revoke_affiliate_invite(), which is
--     the one write here (it revokes an invitation and writes an audit row);
--   * every function is SECURITY DEFINER with an empty search_path, and only the
--     service role may execute it;
--   * every function takes the actor as its FIRST argument and checks the
--     ownership of that actor inside: an affiliate sees only their own numbers,
--     a vendor sees only the affiliates of their own products;
--   * a range is a range of whole Lagos days, and a range longer than 366 days
--     is refused rather than silently truncated;
--   * a page cursor is opaque JSON: it is parsed and checked, never trusted.
--
-- Money is bigint kobo throughout, as everywhere else in the database. Ratios
-- are integer maths: basis points and kobo per hundred clicks, never a float.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.affiliate_marketplace(...) -> jsonb
--
-- The products an affiliate may promote, or ask to promote: live products of
-- active vendors only. my_access is the affiliate's own row ('none' when there
-- is none) and my_link_count counts their active links for that product.
--
-- Search is websearch_to_tsquery over the existing search vector. The trigram
-- fallback on the title only runs when the full text search finds nothing at
-- all, which is what makes it a fallback rather than a second, fuzzier result
-- set on every search: without that guard, "Approval Product" would also return
-- every other product whose title shares the word "Product". The fallback also
-- asks for a similarity of at least 0.5, so a typo is caught and an unrelated
-- title is not. Both indexes already exist (products_search_idx,
-- products_title_trgm_idx).
--
-- Sorting is keyset paginated on (sort value, id). The sort value is a numeric
-- so one comparison shape covers all four orders: newest is the publication
-- instant, commission is basis points, and the price sorts negate the price so
-- every list is "descending". id breaks ties, so a page cannot repeat or skip a
-- row when two products share a sort value.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_marketplace(
  p_affiliate          uuid,
  p_q                  text,
  p_category           text,
  p_min_commission_bps int,
  p_sort               text,
  p_limit              int,
  p_cursor             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sort      text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sort, '')));
  v_q         text := nullif(pg_catalog.btrim(coalesce(p_q, '')), '');
  v_category  text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_limit     int;
  v_fts       boolean := false;
  v_cursor_v  numeric;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_sort = '' THEN
    v_sort := 'newest';
  END IF;

  IF v_sort NOT IN ('newest', 'commission', 'price_low', 'price_high') THEN
    RAISE EXCEPTION 'invalid_sort';
  END IF;

  IF p_min_commission_bps IS NOT NULL AND p_min_commission_bps < 0 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 30);

  -- Is there a full text answer at all? If there is, the trigram fallback stays
  -- out of the way.
  IF v_q IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.products p2
      JOIN public.vendor_profiles v2 ON v2.user_id = p2.vendor_id
      WHERE p2.status = 'live'
        AND v2.status = 'active'
        AND p2.search_vector @@ pg_catalog.websearch_to_tsquery('english', v_q)
    )
    INTO v_fts;
  END IF;

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
      p.id,
      p.slug::text                        AS slug,
      p.title,
      p.short_description,
      (
        SELECT i.cloudinary_public_id
        FROM public.product_images i
        WHERE i.product_id = p.id
          AND i.is_cover
        LIMIT 1
      )                                   AS cover_public_id,
      v.business_name                     AS vendor_name,
      c.slug::text                        AS category_slug,
      p.price_kobo,
      p.commission_bps,
      p.affiliate_approval,
      coalesce(
        (
          SELECT a.status
          FROM public.affiliate_product_access a
          WHERE a.affiliate_id = p_affiliate
            AND a.product_id = p.id
        ),
        'none'
      )                                   AS my_access,
      (
        SELECT pg_catalog.count(*)::int
        FROM public.affiliate_links l
        WHERE l.affiliate_id = p_affiliate
          AND l.product_id = p.id
          AND l.status = 'active'
      )                                   AS my_link_count,
      CASE v_sort
        WHEN 'commission' THEN p.commission_bps::numeric
        WHEN 'price_low'  THEN (-p.price_kobo)::numeric
        WHEN 'price_high' THEN p.price_kobo::numeric
        ELSE EXTRACT(epoch FROM coalesce(p.published_at, p.created_at))
      END                                 AS sort_value
    FROM public.products p
    JOIN public.vendor_profiles v ON v.user_id = p.vendor_id
    JOIN public.product_categories c ON c.id = p.category_id
    WHERE p.status = 'live'
      AND v.status = 'active'
      AND (v_category IS NULL OR c.slug = v_category::extensions.citext)
      AND (p_min_commission_bps IS NULL OR p.commission_bps >= p_min_commission_bps)
      AND (
        v_q IS NULL
        OR (v_fts AND p.search_vector @@ pg_catalog.websearch_to_tsquery('english', v_q))
        OR (
          NOT v_fts
          AND p.title OPERATOR(extensions.%) v_q
          AND extensions.similarity(p.title, v_q) >= 0.5
        )
      )
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
          'product_id', id,
          'slug', slug,
          'title', title,
          'short_description', short_description,
          'cover_public_id', cover_public_id,
          'vendor_name', vendor_name,
          'category_slug', category_slug,
          'price_kobo', price_kobo,
          'commission_bps', commission_bps,
          'affiliate_approval', affiliate_approval,
          'my_access', my_access,
          'my_link_count', my_link_count
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
-- 2. public.affiliate_overview(uuid, timestamptz, timestamptz) -> jsonb
--
-- The totals for a range, from affiliate_daily_stats, over whole Lagos days.
-- The two timestamps are turned into Lagos dates first, so a request at 23:30
-- UTC belongs to the Lagos day that has already started.
--
--   conversion_bps          orders * 10000 / unique clicks (0 with no clicks)
--   epc_kobo_per_100_clicks commission * 100 / clicks (0 with no clicks)
--
-- The balance is all-time and comes from the ledger through get_party_balance():
-- pending is still inside the hold, available is what is left after the hold,
-- and negative is true when a refund left the affiliate owing the platform.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_overview(
  p_affiliate uuid,
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
  v_from        date;
  v_to          date;
  v_clicks      bigint;
  v_unique      bigint;
  v_orders      bigint;
  v_revenue     bigint;
  v_commission  bigint;
  v_conversion  int;
  v_epc         bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  v_from := (p_from AT TIME ZONE 'Africa/Lagos')::date;
  v_to   := (p_to   AT TIME ZONE 'Africa/Lagos')::date;

  IF (v_to - v_from) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT
    coalesce(pg_catalog.sum(s.clicks), 0),
    coalesce(pg_catalog.sum(s.unique_clicks), 0),
    coalesce(pg_catalog.sum(s.orders), 0),
    coalesce(pg_catalog.sum(s.order_revenue_kobo), 0),
    coalesce(pg_catalog.sum(s.commission_kobo), 0)
  INTO v_clicks, v_unique, v_orders, v_revenue, v_commission
  FROM public.affiliate_daily_stats s
  WHERE s.affiliate_id = p_affiliate
    AND s.day BETWEEN v_from AND v_to;

  v_conversion := CASE
                    WHEN v_unique > 0 THEN (v_orders * 10000 / v_unique)::int
                    ELSE 0
                  END;
  v_epc := CASE
             WHEN v_clicks > 0 THEN (v_commission * 100 / v_clicks)
             ELSE 0
           END;

  RETURN pg_catalog.jsonb_build_object(
    'clicks', v_clicks,
    'unique_clicks', v_unique,
    'orders', v_orders,
    'revenue_kobo', v_revenue,
    'commission_kobo', v_commission,
    'conversion_bps', v_conversion,
    'epc_kobo_per_100_clicks', v_epc,
    'balance', public.get_party_balance(p_affiliate)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.affiliate_daily_series(uuid, date, date)
--
-- One row per Lagos day in the range, including days with no activity: the
-- generate_series is the spine and the statistics are joined onto it, so a gap
-- is a zero row rather than a missing row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_daily_series(
  p_affiliate uuid,
  p_from      date,
  p_to        date
)
RETURNS TABLE (
  day           date,
  clicks        int,
  unique_clicks int,
  orders        int,
  commission_kobo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
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
    coalesce(s.clicks, 0)::int,
    coalesce(s.unique_clicks, 0)::int,
    coalesce(s.orders, 0)::int,
    coalesce(s.commission_kobo, 0)::bigint
  FROM pg_catalog.generate_series(
         p_from::timestamp,
         p_to::timestamp,
         interval '1 day'
       ) AS d(day)
  LEFT JOIN (
    SELECT
      st.day,
      pg_catalog.sum(st.clicks)::int          AS clicks,
      pg_catalog.sum(st.unique_clicks)::int   AS unique_clicks,
      pg_catalog.sum(st.orders)::int          AS orders,
      pg_catalog.sum(st.commission_kobo)::bigint AS commission_kobo
    FROM public.affiliate_daily_stats st
    WHERE st.affiliate_id = p_affiliate
      AND st.day BETWEEN p_from AND p_to
    GROUP BY st.day
  ) s ON s.day = d.day::date
  ORDER BY d.day;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.affiliate_link_stats(uuid, date, date, int, jsonb) -> jsonb
--
-- Every link the affiliate owns, with its numbers inside the range (zero when
-- the link had no activity). Ordered by clicks, then by link id, so the busiest
-- link is first and the keyset page is stable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_link_stats(
  p_affiliate uuid,
  p_from      date,
  p_to        date,
  p_limit     int,
  p_cursor    jsonb
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
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

  WITH agg AS (
    SELECT
      s.link_id,
      pg_catalog.sum(s.clicks)::int           AS clicks,
      pg_catalog.sum(s.unique_clicks)::int    AS unique_clicks,
      pg_catalog.sum(s.orders)::int           AS orders,
      pg_catalog.sum(s.commission_kobo)::bigint AS commission_kobo
    FROM public.affiliate_daily_stats s
    WHERE s.affiliate_id = p_affiliate
      AND s.day BETWEEN p_from AND p_to
      AND s.link_id IS NOT NULL
    GROUP BY s.link_id
  ),
  base AS (
    SELECT
      l.id                       AS link_id,
      l.code,
      l.alias::text              AS alias,
      l.label,
      pr.title                   AS product_title,
      l.status,
      coalesce(a.clicks, 0)      AS clicks,
      coalesce(a.unique_clicks, 0) AS unique_clicks,
      coalesce(a.orders, 0)      AS orders,
      coalesce(a.commission_kobo, 0) AS commission_kobo,
      coalesce(a.clicks, 0)::numeric AS sort_value
    FROM public.affiliate_links l
    JOIN public.products pr ON pr.id = l.product_id
    LEFT JOIN agg a ON a.link_id = l.id
    WHERE l.affiliate_id = p_affiliate
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY sort_value DESC, link_id DESC) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR sort_value < v_cursor_v
       OR (sort_value = v_cursor_v AND link_id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'link_id', link_id,
          'code', code,
          'alias', alias,
          'label', label,
          'product_title', product_title,
          'status', status,
          'clicks', clicks,
          'unique_clicks', unique_clicks,
          'orders', orders,
          'commission_kobo', commission_kobo
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', sort_value::text, 'id', link_id)
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
-- 5. public.affiliate_breakdown(uuid, date, date, text)
--
-- The top 20 groups for one dimension: sub1, utm_source or product.
--
-- Clicks are grouped from affiliate_clicks. Orders are attributed through the
-- click that started them (orders.click_id -> affiliate_clicks), so a sale is
-- counted under the same campaign label as the click that earned it. The day
-- boundaries are Lagos midnights converted to timestamptz, which keeps both
-- filters sargable against the (affiliate_id, created_at) index.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_breakdown(
  p_affiliate uuid,
  p_from      date,
  p_to        date,
  p_dim       text
)
RETURNS TABLE (
  label           text,
  clicks          int,
  unique_clicks   int,
  orders          int,
  commission_kobo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dim   text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_dim, '')));
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF v_dim NOT IN ('sub1', 'utm_source', 'product') THEN
    RAISE EXCEPTION 'invalid_dimension';
  END IF;

  v_start := p_from::timestamp AT TIME ZONE 'Africa/Lagos';
  v_end   := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos';

  RETURN QUERY
  WITH click_rows AS (
    SELECT
      CASE v_dim
        WHEN 'product' THEN k.product_id::text
        ELSE coalesce(
               nullif(
                 pg_catalog.btrim(
                   CASE v_dim WHEN 'sub1' THEN k.sub1 ELSE k.utm_source END
                 ),
                 ''
               ),
               ''
             )
      END AS group_key,
      pg_catalog.count(*)::int AS clicks,
      pg_catalog.count(*) FILTER (WHERE k.is_unique)::int AS unique_clicks
    FROM public.affiliate_clicks k
    WHERE k.affiliate_id = p_affiliate
      AND k.created_at >= v_start
      AND k.created_at < v_end
    GROUP BY 1
  ),
  order_rows AS (
    SELECT
      CASE v_dim
        WHEN 'product' THEN k.product_id::text
        ELSE coalesce(
               nullif(
                 pg_catalog.btrim(
                   CASE v_dim WHEN 'sub1' THEN k.sub1 ELSE k.utm_source END
                 ),
                 ''
               ),
               ''
             )
      END AS group_key,
      pg_catalog.count(*)::int AS orders,
      pg_catalog.sum(coalesce(i.affiliate_commission_kobo, 0))::bigint AS commission_kobo
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    JOIN public.affiliate_clicks k ON k.id = o.click_id
    WHERE i.affiliate_id = p_affiliate
      AND o.status = 'paid'
      AND o.paid_at >= v_start
      AND o.paid_at < v_end
    GROUP BY 1
  ),
  merged AS (
    SELECT
      coalesce(c.group_key, r.group_key)        AS group_key,
      coalesce(c.clicks, 0)                     AS clicks,
      coalesce(c.unique_clicks, 0)              AS unique_clicks,
      coalesce(r.orders, 0)                     AS orders,
      coalesce(r.commission_kobo, 0)            AS commission_kobo
    FROM click_rows c
    FULL OUTER JOIN order_rows r ON r.group_key = c.group_key
  )
  SELECT
    CASE
      WHEN v_dim = 'product' THEN coalesce(pr.title, 'Unknown product')
      WHEN m.group_key = '' THEN 'Not set'
      ELSE m.group_key
    END,
    m.clicks,
    m.unique_clicks,
    m.orders,
    m.commission_kobo
  FROM merged m
  LEFT JOIN public.products pr
    ON v_dim = 'product'
   AND pr.id::text = m.group_key
  ORDER BY m.commission_kobo DESC, m.clicks DESC, 1
  LIMIT 20;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. public.affiliate_commission_list(uuid, int, jsonb) -> jsonb
--
-- One row per paid order item that earned the affiliate a commission, newest
-- first. available_at is the hold end, read from the credit entry on the
-- affiliate payable account in the order's ledger transaction.
--
-- The affiliate_commissions view applies auth.uid() itself, and a service-role
-- call has no JWT, so the view would answer no rows. This function therefore
-- selects the same columns from the same two tables with the explicit owner
-- filter, which is the view's WHERE clause with p_affiliate in place of
-- auth.uid().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_commission_list(
  p_affiliate uuid,
  p_limit     int,
  p_cursor    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit     int;
  v_cursor_v  timestamptz;
  v_cursor_id uuid;
  v_items     jsonb;
  v_next      jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    JOIN public.user_roles ur
      ON ur.user_id = ap.user_id
     AND ur.role = 'affiliate'
     AND ur.status = 'active'
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
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
      v_cursor_v := (p_cursor ->> 'v')::timestamptz;
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
      i.id                                AS item_id,
      o.number                            AS order_number,
      o.status::text                      AS status,
      i.title_snapshot                    AS product_title,
      coalesce(i.affiliate_commission_kobo, 0)::bigint AS commission_kobo,
      o.paid_at,
      o.id                                AS order_id
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    WHERE i.affiliate_id = p_affiliate
      AND o.paid_at IS NOT NULL
  ),
  enriched AS (
    SELECT
      b.*,
      (
        SELECT pg_catalog.min(e.available_at)
        FROM public.ledger_transactions t
        JOIN public.ledger_entries e
          ON e.txn_id = t.id
         AND e.account_id = 4
         AND e.party_id = p_affiliate
         AND e.credit_kobo > 0
        WHERE t.kind = 'order_paid'
          AND t.ref_type = 'order'
          AND t.ref_id = b.order_id
      ) AS available_at
    FROM base b
  ),
  ranked AS (
    SELECT
      enriched.*,
      pg_catalog.row_number() OVER (ORDER BY paid_at DESC, item_id DESC) AS rn
    FROM enriched
    WHERE v_cursor_v IS NULL
       OR paid_at < v_cursor_v
       OR (paid_at = v_cursor_v AND item_id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'order_number', order_number,
          'product_title', product_title,
          'commission_kobo', commission_kobo,
          'status', status,
          'paid_at', paid_at,
          'available_at', available_at
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', paid_at::text, 'id', item_id)
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
-- 7. public.vendor_affiliate_requests(uuid, text, uuid, int, jsonb) -> jsonb
--
-- The access requests for the vendor's own products, newest first, optionally
-- filtered by status and by one product. A product that is not theirs simply
-- matches nothing: the join to products carries the vendor_id, so the filter can
-- never widen the answer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_affiliate_requests(
  p_vendor  uuid,
  p_status  text,
  p_product uuid,
  p_limit   int,
  p_cursor  jsonb
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
  v_cursor_v  timestamptz;
  v_cursor_a  uuid;
  v_cursor_p  uuid;
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
     AND v_status NOT IN ('pending', 'approved', 'rejected', 'blocked') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'v') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'a') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'p') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_cursor_v := (p_cursor ->> 'v')::timestamptz;
      v_cursor_a := (p_cursor ->> 'a')::uuid;
      v_cursor_p := (p_cursor ->> 'p')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_cursor_v IS NULL OR v_cursor_a IS NULL OR v_cursor_p IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH base AS (
    SELECT
      a.affiliate_id,
      af.username::text AS username,
      a.product_id,
      pr.title          AS product_title,
      a.status,
      a.note,
      a.requested_at
    FROM public.affiliate_product_access a
    JOIN public.products pr
      ON pr.id = a.product_id
     AND pr.vendor_id = p_vendor
    JOIN public.affiliate_profiles af ON af.user_id = a.affiliate_id
    WHERE (v_status IS NULL OR a.status = v_status)
      AND (p_product IS NULL OR a.product_id = p_product)
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (
        ORDER BY requested_at DESC, affiliate_id DESC, product_id DESC
      ) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR (requested_at, affiliate_id, product_id) < (v_cursor_v, v_cursor_a, v_cursor_p)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'affiliate_id', affiliate_id,
          'username', username,
          'product_id', product_id,
          'product_title', product_title,
          'status', status,
          'note', note,
          'requested_at', requested_at
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object(
                 'v', requested_at::text,
                 'a', affiliate_id,
                 'p', product_id
               )
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
-- 8. public.vendor_affiliate_stats(uuid, date, date, int, jsonb) -> jsonb
--
-- How each affiliate performed on the vendor's products in the range, ordered
-- by revenue. Only affiliates with activity appear: an affiliate who has never
-- clicked has no row in affiliate_daily_stats, and inventing one would be a
-- number the platform cannot prove.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_affiliate_stats(
  p_vendor uuid,
  p_from   date,
  p_to     date,
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

  WITH per_affiliate AS (
    SELECT
      s.affiliate_id,
      pg_catalog.sum(s.clicks)::int             AS clicks,
      pg_catalog.sum(s.unique_clicks)::int      AS unique_clicks,
      pg_catalog.sum(s.orders)::int             AS orders,
      pg_catalog.sum(s.order_revenue_kobo)::bigint AS revenue_kobo,
      pg_catalog.sum(s.commission_kobo)::bigint AS commission_kobo
    FROM public.affiliate_daily_stats s
    JOIN public.products pr ON pr.id = s.product_id
    WHERE pr.vendor_id = p_vendor
      AND s.day BETWEEN p_from AND p_to
    GROUP BY s.affiliate_id
  ),
  base AS (
    SELECT
      pa.affiliate_id,
      af.username::text AS username,
      pa.clicks,
      pa.unique_clicks,
      pa.orders,
      pa.revenue_kobo,
      pa.commission_kobo,
      pa.revenue_kobo::numeric AS sort_value
    FROM per_affiliate pa
    JOIN public.affiliate_profiles af ON af.user_id = pa.affiliate_id
  ),
  ranked AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY sort_value DESC, affiliate_id DESC) AS rn
    FROM base
    WHERE v_cursor_v IS NULL
       OR sort_value < v_cursor_v
       OR (sort_value = v_cursor_v AND affiliate_id < v_cursor_id)
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'affiliate_id', affiliate_id,
          'username', username,
          'clicks', clicks,
          'unique_clicks', unique_clicks,
          'orders', orders,
          'revenue_kobo', revenue_kobo,
          'commission_kobo', commission_kobo
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('v', sort_value::text, 'id', affiliate_id)
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
-- 9. public.vendor_invites(uuid) -> jsonb
--
-- The vendor's invitations, newest first. The token and its hash are never in
-- the answer: the plain token exists only in the response to the vendor who
-- created it, and the hash must not leave the database either.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_invites(p_vendor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_items jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_profiles vp
    WHERE vp.user_id = p_vendor
      AND vp.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', i.id,
               'product_title', pr.title,
               'max_uses', i.max_uses,
               'uses', i.uses,
               'expires_at', i.expires_at,
               'revoked_at', i.revoked_at,
               'created_at', i.created_at
             )
             ORDER BY i.created_at DESC, i.id DESC
           ),
           '[]'::jsonb
         )
  INTO v_items
  FROM public.affiliate_invites i
  JOIN public.products pr
    ON pr.id = i.product_id
   AND pr.vendor_id = p_vendor;

  RETURN pg_catalog.jsonb_build_object('items', v_items);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. public.revoke_affiliate_invite(uuid, uuid) -> void
--
-- The vendor who owns the product, a staff admin or a staff moderator may revoke
-- an invitation. Revoking one that is already revoked changes nothing and writes
-- no second audit row. A row that does not exist is 'not_found', never a silent
-- success.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_affiliate_invite(
  p_actor  uuid,
  p_invite uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor uuid;
  v_row    public.affiliate_invites;
BEGIN
  IF p_actor IS NULL OR p_invite IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT pr.vendor_id
  INTO v_vendor
  FROM public.affiliate_invites i
  JOIN public.products pr ON pr.id = i.product_id
  WHERE i.id = p_invite;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_vendor <> p_actor
     AND NOT public.has_role(p_actor, 'admin')
     AND NOT public.has_role(p_actor, 'moderator') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.affiliate_invites i
     SET revoked_at = pg_catalog.now()
   WHERE i.id = p_invite
     AND i.revoked_at IS NULL
  RETURNING * INTO v_row;

  IF FOUND THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
    VALUES (
      p_actor,
      'affiliate_invite.revoked',
      'affiliate_invite',
      p_invite::text,
      pg_catalog.jsonb_build_object(
        'product_id', v_row.product_id,
        'uses', v_row.uses,
        'max_uses', v_row.max_uses,
        'revoked_at', v_row.revoked_at
      )
    );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Function privileges
--
-- Nothing here is callable by a browser role. The server calls these with the
-- service role key, and every one of them re-checks the actor it was given.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.affiliate_marketplace(uuid, text, text, int, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliate_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliate_daily_series(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliate_link_stats(uuid, date, date, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliate_breakdown(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.affiliate_commission_list(uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_affiliate_requests(uuid, text, uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_affiliate_stats(uuid, date, date, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendor_invites(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_affiliate_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.affiliate_marketplace(uuid, text, text, int, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_overview(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_daily_series(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_link_stats(uuid, date, date, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_breakdown(uuid, date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_commission_list(uuid, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_affiliate_requests(uuid, text, uuid, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_affiliate_stats(uuid, date, date, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vendor_invites(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_affiliate_invite(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 12. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261119000100', 'affiliate_read_models')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Nothing here owns data: every function is a read
-- model over tables that other migrations created, except the audit rows written
-- by revoke_affiliate_invite(), which stay in public.audit_log as the record of
-- a real decision.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.revoke_affiliate_invite(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.vendor_invites(uuid);
-- DROP FUNCTION IF EXISTS public.vendor_affiliate_stats(uuid, date, date, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vendor_affiliate_requests(uuid, text, uuid, int, jsonb);
-- DROP FUNCTION IF EXISTS public.affiliate_commission_list(uuid, int, jsonb);
-- DROP FUNCTION IF EXISTS public.affiliate_breakdown(uuid, date, date, text);
-- DROP FUNCTION IF EXISTS public.affiliate_link_stats(uuid, date, date, int, jsonb);
-- DROP FUNCTION IF EXISTS public.affiliate_daily_series(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.affiliate_overview(uuid, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.affiliate_marketplace(uuid, text, text, int, text, int, jsonb);
--
-- DELETE FROM public.app_migrations WHERE version = '20261119000100';
--
-- COMMIT;
-- ============================================================================
