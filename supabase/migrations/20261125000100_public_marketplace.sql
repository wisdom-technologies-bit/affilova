-- ============================================================================
-- Migration 20261125000100_public_marketplace
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the read models behind the public marketplace (the listing with its
--         search, filters, sorts and cursor), the category index, the related
--         products row on a product page, the vendor storefront and the
--         sitemap feed.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.app_migrations),
-- 20261113000100_roles_onboarding.sql (public.vendor_profiles),
-- 20261114000100_catalog.sql (public.products, public.product_categories,
-- public.product_images, public.products.search_vector and the trigram index),
-- 20261116000200_commerce_core.sql (public.orders, public.order_items).
--
-- The rules, in one place:
--   * every function is SECURITY DEFINER with an empty search_path, and only the
--     service role may execute it. Nothing here is reachable from a browser;
--   * every function returns live products of active vendors and nothing else.
--     A draft, a paused product, a rejected product and a suspended vendor's
--     shelf are invisible in every result, including the counts;
--   * the item shape is public data only: a product's slug, title, short
--     description, cover image id, price, category and the vendor's public name
--     and slug. No vendor email, phone, user id, commission or affiliate field
--     is selected anywhere in this file, so none can leak;
--   * search is a websearch_to_tsquery over the existing search_vector, plus a
--     trigram fallback on the title for partial words and typos. The query is
--     length-limited to 80 characters and its LIKE wildcards are escaped;
--   * a page cursor is opaque JSON: it is parsed and checked, never trusted, and
--     it carries the sort it was built for so a stale cursor cannot silently
--     page a different ordering;
--   * best_selling counts paid orders in the last 90 days, ties broken by
--     newest. Money is bigint kobo throughout.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Row level security
--
-- These tables already have RLS from the migrations that created them. Stating
-- it again is belt and braces: the read models below run as the definer and
-- bypass RLS, so the browser must never reach the tables directly.
-- ----------------------------------------------------------------------------
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items        ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. public.public_categories() -> jsonb
--
-- Every category that currently has at least one live product from an active
-- vendor, ordered by name. A category whose products have all been paused is
-- not in the list, because the page it would link to has nothing to show.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'slug', c.slug::text,
        'name', c.name,
        'product_count', counts.product_count
      )
      ORDER BY c.name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.product_categories c
  JOIN (
    SELECT p.category_id, pg_catalog.count(*)::bigint AS product_count
    FROM public.products p
    JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
    WHERE p.status = 'live'
      AND vp.status = 'active'
      AND p.published_at IS NOT NULL
    GROUP BY p.category_id
  ) counts ON counts.category_id = c.id;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.public_marketplace(text, text, bigint, bigint, text, int, jsonb)
--
-- One page of the public listing.
--
--   p_q               free text, at most 80 characters; empty or null means all
--   p_category        a category slug, or null/empty for every category
--   p_min_price_kobo  inclusive lower bound, or null/0 for no lower bound
--   p_max_price_kobo  inclusive upper bound, or null/0 for no upper bound
--   p_sort            newest | price_low | price_high | best_selling
--   p_limit           1 to 24, default 12
--   p_cursor          the next_cursor of the previous page, or null
--
-- Returns { items, next_cursor, total_estimate }. total_estimate is the number
-- of matching products, not the number on this page.
--
-- The ordering key is always three columns, so a cursor can never skip or
-- repeat a row: the sort value, then the published time, then the id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_marketplace(
  p_q              text,
  p_category       text,
  p_min_price_kobo bigint,
  p_max_price_kobo bigint,
  p_sort           text,
  p_limit          int,
  p_cursor         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET pg_trgm.word_similarity_threshold = 0.35
AS $$
DECLARE
  -- Control characters are removed and the value is cut to 80 characters, so a
  -- pasted wall of text costs the same as a word.
  v_q        text := pg_catalog.left(
                        pg_catalog.regexp_replace(
                          pg_catalog.btrim(coalesce(p_q, '')),
                          '[[:cntrl:]]', '', 'g'
                        ),
                        80
                      );
  v_category text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_category, ''))), '');
  v_min      bigint := CASE WHEN p_min_price_kobo IS NULL OR p_min_price_kobo <= 0
                            THEN NULL ELSE p_min_price_kobo END;
  v_max      bigint := CASE WHEN p_max_price_kobo IS NULL OR p_max_price_kobo <= 0
                            THEN NULL ELSE p_max_price_kobo END;
  v_sort     text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sort, '')));
  v_limit    int;
  v_desc     boolean;
  -- The query with LIKE wildcards escaped, so "%" searches for a per cent sign
  -- instead of matching every product.
  v_like     text;
  v_tsq      tsquery;
  v_cv       numeric;
  v_ct       numeric;
  v_cid      uuid;
  v_items    jsonb;
  v_next     jsonb;
  v_total    bigint;
BEGIN
  IF v_sort = '' THEN
    v_sort := 'newest';
  END IF;

  IF v_sort NOT IN ('newest', 'price_low', 'price_high', 'best_selling') THEN
    RAISE EXCEPTION 'invalid_sort';
  END IF;

  IF v_category IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.product_categories c WHERE c.slug::text = v_category
     ) THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_desc  := v_sort <> 'price_low';

  IF v_q <> '' THEN
    v_like := pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.replace(v_q, '\', '\\'),
                  '%', '\%'
                ),
                '_', '\_'
              );
    v_tsq := pg_catalog.websearch_to_tsquery('english'::pg_catalog.regconfig, v_q);
  END IF;

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'v') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 't') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 's') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    -- A cursor from a different ordering is refused: paging "newest" with a
    -- "price_low" cursor would drop and repeat rows without saying so.
    IF p_cursor ->> 's' <> v_sort THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_cv  := (p_cursor ->> 'v')::numeric;
      v_ct  := (p_cursor ->> 't')::numeric;
      v_cid := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_cv IS NULL OR v_ct IS NULL OR v_cid IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH sales AS (
    -- Paid orders in the last 90 days, per product. An order that was paid and
    -- later refunded still counts as a sale: it happened.
    SELECT i.product_id, pg_catalog.count(DISTINCT o.id)::numeric AS paid_orders
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    WHERE o.status IN ('paid', 'refunded', 'disputed')
      AND o.paid_at >= pg_catalog.now() - interval '90 days'
    GROUP BY i.product_id
  ),
  base AS (
    SELECT
      p.id,
      p.slug::text                                AS slug,
      p.title,
      p.short_description,
      p.price_kobo,
      p.compare_at_price_kobo,
      p.published_at,
      c.slug::text                                AS category_slug,
      c.name                                      AS category_name,
      vp.business_name                            AS vendor_name,
      vp.slug::text                               AS vendor_slug,
      coalesce(s.paid_orders, 0)                  AS paid_orders,
      EXTRACT(epoch FROM coalesce(p.published_at, p.created_at))::numeric AS published_epoch,
      (
        SELECT pi.cloudinary_public_id
        FROM public.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_cover DESC, pi.sort ASC, pi.id ASC
        LIMIT 1
      )                                           AS cover_public_id
    FROM public.products p
    JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
    JOIN public.product_categories c ON c.id = p.category_id
    LEFT JOIN sales s ON s.product_id = p.id
    WHERE p.status = 'live'
      AND vp.status = 'active'
      AND p.published_at IS NOT NULL
      AND (v_category IS NULL OR c.slug::text = v_category)
      AND (v_min IS NULL OR p.price_kobo >= v_min)
      AND (v_max IS NULL OR p.price_kobo <= v_max)
      AND (
        v_q = ''
        OR p.search_vector @@ v_tsq
        OR p.title ILIKE '%' || v_like || '%'
        -- Trigram word similarity is the typo and partial-word fallback: "ketp"
        -- still finds "Keto Diet Guide".
        OR v_q OPERATOR(extensions.<%) p.title
      )
  ),
  ranked AS (
    SELECT
      base.*,
      -- One numeric ordering key for every sort, so the keyset predicate is
      -- always the same three-column comparison. Ascending sorts are negated
      -- and every sort is then ordered descending.
      (
        CASE
          WHEN v_sort = 'best_selling' THEN paid_orders
          WHEN v_sort IN ('price_low', 'price_high') THEN price_kobo::numeric
          ELSE published_epoch
        END
        * CASE WHEN v_desc THEN 1 ELSE -1 END
      ) AS sort_key
    FROM base
  ),
  paged AS (
    SELECT
      ranked.*,
      pg_catalog.row_number() OVER (
        ORDER BY sort_key DESC, published_epoch DESC, id DESC
      ) AS rn
    FROM ranked
    WHERE v_cv IS NULL
       OR (sort_key, published_epoch, id) < (v_cv, v_ct, v_cid)
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
          'price_kobo', price_kobo,
          'compare_at_price_kobo', compare_at_price_kobo,
          'category_slug', category_slug,
          'category_name', category_name,
          'vendor_name', vendor_name,
          'vendor_slug', vendor_slug
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object(
          'v', sort_key::text,
          't', published_epoch::text,
          'id', id,
          's', v_sort
        )
        FROM paged
        WHERE rn = v_limit
      )
      ELSE NULL
    END,
    (SELECT pg_catalog.count(*) FROM base)
  INTO v_items, v_next, v_total
  FROM paged;

  RETURN pg_catalog.jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next,
    'total_estimate', v_total
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.public_product_related(uuid, int) -> jsonb
--
-- Up to four other live products in the same category as p_product, newest
-- first. The product itself is never in its own related row, and a product that
-- is not itself live and public has no related row at all.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_product_related(
  p_product uuid,
  p_limit   int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_category_id smallint;
  v_limit       int := least(greatest(coalesce(p_limit, 4), 1), 4);
  v_result      jsonb;
BEGIN
  SELECT p.category_id
  INTO v_category_id
  FROM public.products p
  JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
  WHERE p.id = p_product
    AND p.status = 'live'
    AND vp.status = 'active'
    AND p.published_at IS NOT NULL;

  IF v_category_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(
    pg_catalog.jsonb_agg(item ORDER BY published_at DESC, id DESC),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      p.published_at,
      p.id,
      pg_catalog.jsonb_build_object(
        'product_id', p.id,
        'slug', p.slug::text,
        'title', p.title,
        'short_description', p.short_description,
        'cover_public_id', (
          SELECT pi.cloudinary_public_id
          FROM public.product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.is_cover DESC, pi.sort ASC, pi.id ASC
          LIMIT 1
        ),
        'price_kobo', p.price_kobo,
        'compare_at_price_kobo', p.compare_at_price_kobo,
        'category_slug', c.slug::text,
        'category_name', c.name,
        'vendor_name', vp.business_name,
        'vendor_slug', vp.slug::text
      ) AS item
    FROM public.products p
    JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
    JOIN public.product_categories c ON c.id = p.category_id
    WHERE p.status = 'live'
      AND vp.status = 'active'
      AND p.published_at IS NOT NULL
      AND p.category_id = v_category_id
      AND p.id <> p_product
    ORDER BY p.published_at DESC, p.id DESC
    LIMIT v_limit
  ) related;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.public_store(text, int, jsonb) -> jsonb
--
-- One vendor's storefront, newest first. Answers null when the vendor does not
-- exist, is suspended, or has nothing live: the page turns that into a 404.
--
-- The vendor's business name and slug are public. The support email, the phone
-- number and the user id are never selected here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_store(
  p_vendor_slug text,
  p_limit       int,
  p_cursor      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug     text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_vendor_slug, ''))), '');
  v_vendor   uuid;
  v_name     text;
  v_limit    int := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_cv       numeric;
  v_ct       numeric;
  v_cid      uuid;
  v_count    bigint;
  v_items    jsonb;
  v_next     jsonb;
BEGIN
  IF v_slug IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT vp.user_id, vp.business_name
  INTO v_vendor, v_name
  FROM public.vendor_profiles vp
  WHERE vp.slug::text = v_slug
    AND vp.status = 'active';

  IF v_vendor IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_count
  FROM public.products p
  WHERE p.vendor_id = v_vendor
    AND p.status = 'live'
    AND p.published_at IS NOT NULL;

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  IF p_cursor IS NOT NULL AND p_cursor <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_cursor) <> 'object'
       OR pg_catalog.jsonb_typeof(p_cursor -> 't') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cursor -> 'id') <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;

    BEGIN
      v_ct  := (p_cursor ->> 't')::numeric;
      v_cid := (p_cursor ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'invalid_cursor';
    END;

    IF v_ct IS NULL OR v_cid IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor';
    END IF;
  END IF;

  WITH base AS (
    SELECT
      p.id,
      p.slug::text   AS slug,
      p.title,
      p.short_description,
      p.price_kobo,
      p.compare_at_price_kobo,
      p.published_at,
      c.slug::text   AS category_slug,
      c.name         AS category_name,
      EXTRACT(epoch FROM p.published_at)::numeric AS published_epoch,
      (
        SELECT pi.cloudinary_public_id
        FROM public.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_cover DESC, pi.sort ASC, pi.id ASC
        LIMIT 1
      ) AS cover_public_id
    FROM public.products p
    JOIN public.product_categories c ON c.id = p.category_id
    WHERE p.vendor_id = v_vendor
      AND p.status = 'live'
      AND p.published_at IS NOT NULL
  ),
  paged AS (
    SELECT
      base.*,
      pg_catalog.row_number() OVER (ORDER BY published_epoch DESC, id DESC) AS rn
    FROM base
    WHERE v_ct IS NULL
       OR (published_epoch, id) < (v_ct, v_cid)
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
          'price_kobo', price_kobo,
          'compare_at_price_kobo', compare_at_price_kobo,
          'category_slug', category_slug,
          'category_name', category_name,
          'vendor_name', v_name,
          'vendor_slug', v_slug
        )
        ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    CASE
      WHEN pg_catalog.count(*) > v_limit THEN (
        SELECT pg_catalog.jsonb_build_object('t', published_epoch::text, 'id', id)
        FROM paged
        WHERE rn = v_limit
      )
      ELSE NULL
    END
  INTO v_items, v_next
  FROM paged;

  RETURN pg_catalog.jsonb_build_object(
    'vendor_name', v_name,
    'vendor_slug', v_slug,
    'product_count', v_count,
    'items', v_items,
    'next_cursor', v_next
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. public.public_sitemap_entries() -> jsonb
--
-- Everything a crawler may index, in one read: up to 5000 live products with
-- their last change, the categories that have live products, and the stores
-- that have live products. The cap keeps the answer inside a sitemap file; a
-- catalogue larger than that needs the paged sitemap route, not a bigger blob.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_sitemap_entries()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_products   jsonb;
  v_categories jsonb;
  v_stores     jsonb;
BEGIN
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('slug', s.slug, 'updated_at', s.updated_at)
      ORDER BY s.updated_at DESC, s.slug
    ),
    '[]'::jsonb
  )
  INTO v_products
  FROM (
    SELECT p.slug::text AS slug, p.updated_at
    FROM public.products p
    JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
    WHERE p.status = 'live'
      AND vp.status = 'active'
      AND p.published_at IS NOT NULL
    ORDER BY p.updated_at DESC, p.slug::text
    LIMIT 5000
  ) s;

  SELECT coalesce(
    pg_catalog.jsonb_agg(c.slug::text ORDER BY c.slug::text),
    '[]'::jsonb
  )
  INTO v_categories
  FROM public.product_categories c
  WHERE EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
    WHERE p.category_id = c.id
      AND p.status = 'live'
      AND vp.status = 'active'
      AND p.published_at IS NOT NULL
  );

  SELECT coalesce(
    pg_catalog.jsonb_agg(vp.slug::text ORDER BY vp.slug::text),
    '[]'::jsonb
  )
  INTO v_stores
  FROM public.vendor_profiles vp
  WHERE vp.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.vendor_id = vp.user_id
        AND p.status = 'live'
        AND p.published_at IS NOT NULL
    );

  RETURN pg_catalog.jsonb_build_object(
    'products', v_products,
    'categories', v_categories,
    'stores', v_stores
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Function privileges
--
-- Nothing here is callable by a browser role. The server calls these with the
-- service role key; none of them takes an actor, because every one of them
-- returns public data and nothing else.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.public_categories() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_marketplace(text, text, bigint, bigint, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_product_related(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_store(text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_sitemap_entries() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_categories() TO service_role;
GRANT EXECUTE ON FUNCTION public.public_marketplace(text, text, bigint, bigint, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_product_related(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_store(text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_sitemap_entries() TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261125000100', 'public_marketplace')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Nothing here owns data: every function is a read
-- model over tables other migrations created, so dropping them loses nothing
-- but the ability to read the public marketplace.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.public_sitemap_entries();
-- DROP FUNCTION IF EXISTS public.public_store(text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.public_product_related(uuid, int);
-- DROP FUNCTION IF EXISTS public.public_marketplace(text, text, bigint, bigint, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.public_categories();
--
-- DELETE FROM public.app_migrations WHERE version = '20261125000100';
--
-- COMMIT;
-- ============================================================================
