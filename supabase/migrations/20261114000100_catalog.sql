-- ============================================================================
-- Migration 20261114000100_catalog
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  the product catalog: categories, products, the private files a vendor
--         uploads and the images it points at, plus every function that writes
--         them. There is no client write path at all.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (profiles, user_roles, settings,
-- audit_log, is_staff, set_updated_at, the citext and pg_trgm extensions) and on
-- 20261113000100_roles_onboarding.sql (vendor_profiles).
--
-- Rules that hold everywhere below:
--   * every function is SECURITY DEFINER with an empty search_path, and only
--     service_role may execute it;
--   * every function that writes reads the actor as p_actor and compares it with
--     the row's own owner column. A vendor id supplied anywhere else is ignored;
--   * an error is raised with a short code as its MESSAGE (invalid_price,
--     slug_taken, not_ready, ...) so the application can map it to a safe
--     sentence. Database detail never has to reach a browser.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Settings used by the catalog rules
--
-- Each one is read with a coalesce fallback to the same value, so a missing row
-- never blocks a vendor. They are commercial defaults, not approved terms: the
-- owner can change them in public.settings without a migration.
-- ----------------------------------------------------------------------------
INSERT INTO public.settings (key, value, description) VALUES
  ('refund_window_min_hours',  '24'::jsonb,   'Shortest refund window a product may offer, in hours.'),
  ('product_commission_min_bps','500'::jsonb, 'Lowest affiliate commission a product may offer, in basis points (5%).'),
  ('product_commission_max_bps','8000'::jsonb,'Highest affiliate commission a product may offer, in basis points (80%).')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. public.catalog_setting_int(text, int)
-- Read one integer setting, or p_fallback when the row is missing or does not
-- hold a plain non-negative integer. Never raises: a typo in a settings value
-- must not break every product write.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_setting_int(p_key text, p_fallback int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN (s.value #>> '{}') ~ '^[0-9]{1,9}$' THEN (s.value #>> '{}')::int
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = p_key
    ),
    p_fallback
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. public.product_categories
-- Public reference data: a fixed list, read by everyone, written by nobody.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id   smallint             PRIMARY KEY,
  slug extensions.citext    NOT NULL UNIQUE,
  name text                 NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  sort smallint             NOT NULL
);

INSERT INTO public.product_categories (id, slug, name, sort) VALUES
  (1, 'education', 'Education', 1),
  (2, 'software',  'Software',  2),
  (3, 'ebooks',    'eBooks',    3),
  (4, 'video',     'Video',     4),
  (5, 'audio',     'Audio',     5),
  (6, 'graphics',  'Graphics',  6),
  (7, 'business',  'Business',  7),
  (8, 'health',    'Health',    8),
  (9, 'finance',   'Finance',   9)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. public.product_status
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'product_status'
  ) THEN
    CREATE TYPE public.product_status AS ENUM
      ('draft', 'submitted', 'live', 'paused', 'rejected', 'archived');
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 5. public.products
--
-- Money is an integer number of kobo. commission_bps is basis points (500 = 5%).
-- Everything a vendor can change is range-checked here as well as in the
-- functions, so a direct service-role insert cannot store a nonsense product.
--
-- slug is citext, so uniqueness is case-insensitive: "Keto-Guide" and
-- "keto-guide" are the same product address. The CHECK casts the slug to text
-- before matching, because citext's own operators make a [a-z0-9] pattern match
-- uppercase letters too.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id                      uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id               uuid                     NOT NULL
                                                   REFERENCES public.vendor_profiles (user_id)
                                                   ON DELETE RESTRICT,
  category_id             smallint                 NOT NULL
                                                   REFERENCES public.product_categories (id),
  title                   text                     NOT NULL
                                                   CHECK (char_length(title) BETWEEN 3 AND 120),
  slug                    extensions.citext        NOT NULL UNIQUE
                                                   CHECK ((slug::text) ~ '^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$'),
  short_description       text                     NOT NULL
                                                   CHECK (char_length(short_description) BETWEEN 10 AND 200),
  description             text                     NOT NULL
                                                   CHECK (char_length(description) BETWEEN 0 AND 10000),
  price_kobo              bigint                   NOT NULL
                                                   CHECK (price_kobo BETWEEN 10000 AND 1000000000),
  compare_at_price_kobo   bigint                   CHECK (
                                                     compare_at_price_kobo IS NULL
                                                     OR compare_at_price_kobo > price_kobo
                                                   ),
  currency                text                     NOT NULL DEFAULT 'NGN'
                                                   CHECK (currency = 'NGN'),
  commission_bps          int                      NOT NULL
                                                   CHECK (commission_bps BETWEEN 500 AND 8000),
  affiliate_approval      text                     NOT NULL DEFAULT 'open'
                                                   CHECK (affiliate_approval IN ('open', 'approval', 'invite')),
  refund_window_hours     int                      NOT NULL DEFAULT 24
                                                   CHECK (refund_window_hours BETWEEN 24 AND 720),
  max_downloads           int                      NOT NULL DEFAULT 5
                                                   CHECK (max_downloads BETWEEN 1 AND 100),
  status                  public.product_status    NOT NULL DEFAULT 'draft',
  reject_reason           text,
  submitted_at            timestamptz,
  published_at            timestamptz,
  reviewed_at             timestamptz,
  reviewed_by             uuid,
  search_vector           tsvector GENERATED ALWAYS AS (
                            pg_catalog.setweight(
                              pg_catalog.to_tsvector('english'::pg_catalog.regconfig, title), 'A'
                            )
                            ||
                            pg_catalog.setweight(
                              pg_catalog.to_tsvector('english'::pg_catalog.regconfig, short_description), 'B'
                            )
                          ) STORED,
  created_at              timestamptz              NOT NULL DEFAULT now(),
  updated_at              timestamptz              NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- A vendor's own shelf, and the review queue's "oldest submitted first".
CREATE INDEX IF NOT EXISTS products_vendor_status_idx
  ON public.products (vendor_id, status);
CREATE INDEX IF NOT EXISTS products_status_submitted_idx
  ON public.products (status, submitted_at);
CREATE INDEX IF NOT EXISTS products_category_idx
  ON public.products (category_id);

-- Full text search over the two short fields, plus a fuzzy title index for
-- "did you mean" style matching.
CREATE INDEX IF NOT EXISTS products_search_idx
  ON public.products USING gin (search_vector);
CREATE INDEX IF NOT EXISTS products_title_trgm_idx
  ON public.products USING gin (title extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 6. public.product_files
-- The private file behind a product. The row is created *before* the bytes are
-- uploaded (status 'pending'), so a half-finished upload is visible and can be
-- cleaned up. storage_key is the object key in the private bucket.
--
-- id has no default on purpose: the caller generates it first, because the key
-- it uploads to embeds it (products/<product>/<file>/<name>).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_files (
  id                  uuid        PRIMARY KEY,
  product_id          uuid        NOT NULL
                                  REFERENCES public.products (id) ON DELETE CASCADE,
  storage_key         text        NOT NULL UNIQUE,
  original_name       text        NOT NULL
                                  CHECK (char_length(original_name) BETWEEN 1 AND 180),
  content_type        text        NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 120),
  size_bytes          bigint      NOT NULL
                                  CHECK (size_bytes > 0 AND size_bytes <= 2147483648),
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'uploaded')),
  scan_status         text        NOT NULL DEFAULT 'not_scanned'
                                  CHECK (scan_status IN ('not_scanned', 'clean', 'infected', 'error')),
  multipart_upload_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  uploaded_at         timestamptz
);

CREATE INDEX IF NOT EXISTS product_files_product_idx
  ON public.product_files (product_id);
-- The cleanup sweep looks for old pending rows; the partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS product_files_pending_idx
  ON public.product_files (created_at)
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. public.product_images
-- Cloudinary holds the bytes; this table holds the public id and the metadata
-- the grid needs. One cover per product, enforced by a partial unique index.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_images (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid        NOT NULL
                                  REFERENCES public.products (id) ON DELETE CASCADE,
  cloudinary_public_id text       NOT NULL UNIQUE,
  alt_text            text        CHECK (alt_text IS NULL OR char_length(alt_text) <= 140),
  width               int,
  height              int,
  bytes               int,
  format              text,
  sort                smallint    NOT NULL DEFAULT 0,
  is_cover            boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_images_product_idx
  ON public.product_images (product_id, sort);

CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_cover_idx
  ON public.product_images (product_id)
  WHERE is_cover;

-- ----------------------------------------------------------------------------
-- 8. Row level security on every table created here
-- ----------------------------------------------------------------------------
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images    ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 9. Privileges and policies
-- Order, as in the other migrations: revoke everything from the client roles
-- first, then grant only the reads listed below. There is no INSERT, UPDATE or
-- DELETE grant for anon or authenticated on any of these tables, so the only
-- write path is a SECURITY DEFINER function called by the service role.
-- ----------------------------------------------------------------------------

-- categories: public reference data, readable with no account at all.
REVOKE ALL ON TABLE public.product_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_categories TO anon, authenticated;

DROP POLICY IF EXISTS product_categories_select_all ON public.product_categories;
CREATE POLICY product_categories_select_all
  ON public.product_categories
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- products: the owner reads their own, staff read all.
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.products TO authenticated;

DROP POLICY IF EXISTS products_select_own ON public.products;
CREATE POLICY products_select_own
  ON public.products
  FOR SELECT
  TO authenticated
  USING (vendor_id = (select auth.uid()));

DROP POLICY IF EXISTS products_select_staff ON public.products;
CREATE POLICY products_select_staff
  ON public.products
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- product_files: read through the parent product, so the rule cannot drift from
-- the product rule. The subquery is itself subject to the products policies,
-- which is exactly the behaviour wanted.
REVOKE ALL ON TABLE public.product_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_files TO authenticated;

DROP POLICY IF EXISTS product_files_select_own ON public.product_files;
CREATE POLICY product_files_select_own
  ON public.product_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = product_files.product_id
        AND p.vendor_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS product_files_select_staff ON public.product_files;
CREATE POLICY product_files_select_staff
  ON public.product_files
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- product_images: the same two rules, again through the parent product.
REVOKE ALL ON TABLE public.product_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_images TO authenticated;

DROP POLICY IF EXISTS product_images_select_own ON public.product_images;
CREATE POLICY product_images_select_own
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = product_images.product_id
        AND p.vendor_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS product_images_select_staff ON public.product_images;
CREATE POLICY product_images_select_staff
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- ----------------------------------------------------------------------------
-- 10. Server role privileges
-- Explicit, so nothing depends on Supabase's default privileges for new tables.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON TABLE
  public.product_categories,
  public.products,
  public.product_files,
  public.product_images
TO service_role;

-- ============================================================================
-- 11. Functions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 11.1 public.get_product_readiness(uuid)
-- What is still missing before a product can be submitted. Booleans for the
-- screen, and a "missing" array in the order the form asks for them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_readiness(p_product uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product  public.products;
  v_min_bps  int := public.catalog_setting_int('product_commission_min_bps', 500);
  v_max_bps  int := public.catalog_setting_int('product_commission_max_bps', 8000);
  v_has_file boolean;
  v_has_cover boolean;
  v_missing  text[] := ARRAY[]::text[];
  v_title    boolean;
  v_short    boolean;
  v_long     boolean;
  v_category boolean;
  v_price    boolean;
  v_commission boolean;
BEGIN
  SELECT * INTO v_product FROM public.products p WHERE p.id = p_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_title      := char_length(v_product.title) BETWEEN 3 AND 120;
  v_short      := char_length(v_product.short_description) BETWEEN 10 AND 200;
  -- 80 characters is the point where a description stops being a placeholder.
  v_long       := char_length(v_product.description) >= 80;
  v_category   := v_product.category_id IS NOT NULL;
  v_price      := v_product.price_kobo BETWEEN 10000 AND 1000000000;
  v_commission := v_product.commission_bps BETWEEN v_min_bps AND v_max_bps;

  SELECT EXISTS (
    SELECT 1
    FROM public.product_files f
    WHERE f.product_id = p_product
      AND f.status = 'uploaded'
  ) INTO v_has_file;

  SELECT EXISTS (
    SELECT 1
    FROM public.product_images i
    WHERE i.product_id = p_product
      AND i.is_cover
  ) INTO v_has_cover;

  IF NOT v_title       THEN v_missing := v_missing || 'title'::text; END IF;
  IF NOT v_short       THEN v_missing := v_missing || 'short_description'::text; END IF;
  IF NOT v_long        THEN v_missing := v_missing || 'description'::text; END IF;
  IF NOT v_category    THEN v_missing := v_missing || 'category'::text; END IF;
  IF NOT v_price       THEN v_missing := v_missing || 'price'::text; END IF;
  IF NOT v_commission  THEN v_missing := v_missing || 'commission'::text; END IF;
  IF NOT v_has_file    THEN v_missing := v_missing || 'file'::text; END IF;
  IF NOT v_has_cover   THEN v_missing := v_missing || 'cover'::text; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'title',       v_title,
    'short_description', v_short,
    'description', v_long,
    'category',    v_category,
    'price',       v_price,
    'commission',  v_commission,
    'file',        v_has_file,
    'cover',       v_has_cover,
    'missing',     pg_catalog.to_jsonb(v_missing)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.2 public.catalog_actor_is_vendor(uuid)
-- True when the actor holds an active vendor role and an active vendor profile.
-- Both are needed: the role alone can outlive a suspended store.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_actor_is_vendor(p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_actor IS NOT NULL
    AND public.has_role(p_actor, 'vendor')
    AND EXISTS (
      SELECT 1
      FROM public.vendor_profiles v
      WHERE v.user_id = p_actor
        AND v.status = 'active'
    );
$$;

-- ----------------------------------------------------------------------------
-- 11.3 public.catalog_owns_product(uuid, uuid)
-- The one ownership test every product function uses: the row's vendor_id
-- against p_actor. Nothing else may be supplied as an owner.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_owns_product(p_actor uuid, p_product uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product
      AND p.vendor_id = p_actor
  );
$$;

-- ----------------------------------------------------------------------------
-- 11.4 public.catalog_slugify(text)
-- The SQL twin of lib/catalog/slug.ts, used only when a vendor does not supply a
-- slug of their own. Lowercase, non-alphanumerics to hyphens, no leading or
-- trailing hyphen, at most 80 characters.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_slugify(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.left(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(coalesce(p_title, '')),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
    80
  );
$$;

-- ----------------------------------------------------------------------------
-- 11.5 public.create_product_draft(uuid, jsonb)
--
-- Only the keys below are read; anything else in p_fields is ignored, so a
-- caller cannot set status, vendor_id or a review column through this door.
--
-- Required: title, category_slug, short_description, price_kobo.
-- Slug defaults to a slugified title. description defaults to ''. commission_bps
-- defaults to the configured minimum, refund_window_hours to 24, max_downloads
-- to 5, affiliate_approval to 'open'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_draft(p_actor uuid, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_min_bps     int := public.catalog_setting_int('product_commission_min_bps', 500);
  v_max_bps     int := public.catalog_setting_int('product_commission_max_bps', 8000);
  v_min_refund  int := public.catalog_setting_int('refund_window_min_hours', 24);
  v_title       text;
  v_slug        text;
  v_short       text;
  v_description text;
  v_category    smallint;
  v_price       bigint;
  v_compare     bigint;
  v_commission  int;
  v_approval    text;
  v_refund      int;
  v_downloads   int;
  v_product     uuid;
BEGIN
  IF p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fields';
  END IF;

  IF NOT public.catalog_actor_is_vendor(p_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- title
  v_title := pg_catalog.btrim(coalesce(p_fields ->> 'title', ''));

  IF char_length(v_title) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'invalid_title';
  END IF;

  -- short_description
  v_short := pg_catalog.btrim(coalesce(p_fields ->> 'short_description', ''));

  IF char_length(v_short) NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'invalid_short_description';
  END IF;

  -- description (optional at creation)
  v_description := coalesce(p_fields ->> 'description', '');

  IF char_length(v_description) > 10000 THEN
    RAISE EXCEPTION 'invalid_description';
  END IF;

  -- slug, or one derived from the title
  v_slug := pg_catalog.lower(pg_catalog.btrim(coalesce(p_fields ->> 'slug', '')));

  IF v_slug = '' THEN
    v_slug := public.catalog_slugify(v_title);
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  -- category
  IF p_fields ->> 'category_slug' IS NULL THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  SELECT c.id INTO v_category
  FROM public.product_categories c
  WHERE pg_catalog.lower(c.slug::text) = pg_catalog.lower(pg_catalog.btrim(p_fields ->> 'category_slug'));

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  -- price: digits only, so a float or an exponent can never become money
  IF coalesce(p_fields ->> 'price_kobo', '') !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  v_price := (p_fields ->> 'price_kobo')::bigint;

  IF v_price < 10000 OR v_price > 1000000000 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  -- compare-at price is optional, but must be above the price when present
  IF p_fields ? 'compare_at_price_kobo'
     AND pg_catalog.jsonb_typeof(p_fields -> 'compare_at_price_kobo') <> 'null' THEN
    IF (p_fields ->> 'compare_at_price_kobo') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'invalid_compare_price';
    END IF;

    v_compare := (p_fields ->> 'compare_at_price_kobo')::bigint;

    IF v_compare <= v_price OR v_compare > 1000000000 THEN
      RAISE EXCEPTION 'invalid_compare_price';
    END IF;
  END IF;

  -- commission: inside the configured range, and inside the column range
  IF p_fields ? 'commission_bps'
     AND pg_catalog.jsonb_typeof(p_fields -> 'commission_bps') <> 'null' THEN
    IF (p_fields ->> 'commission_bps') !~ '^[0-9]{1,5}$' THEN
      RAISE EXCEPTION 'invalid_commission';
    END IF;

    v_commission := (p_fields ->> 'commission_bps')::int;

    IF v_commission < v_min_bps OR v_commission > v_max_bps
       OR v_commission < 500 OR v_commission > 8000 THEN
      RAISE EXCEPTION 'invalid_commission';
    END IF;
  ELSE
    v_commission := GREATEST(v_min_bps, 500);
  END IF;

  -- affiliate approval
  IF p_fields ? 'affiliate_approval'
     AND pg_catalog.jsonb_typeof(p_fields -> 'affiliate_approval') <> 'null' THEN
    v_approval := p_fields ->> 'affiliate_approval';

    IF v_approval NOT IN ('open', 'approval', 'invite') THEN
      RAISE EXCEPTION 'invalid_approval';
    END IF;
  ELSE
    v_approval := 'open';
  END IF;

  -- refund window: never shorter than the platform minimum
  IF p_fields ? 'refund_window_hours'
     AND pg_catalog.jsonb_typeof(p_fields -> 'refund_window_hours') <> 'null' THEN
    IF (p_fields ->> 'refund_window_hours') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'invalid_refund_window';
    END IF;

    v_refund := (p_fields ->> 'refund_window_hours')::int;

    IF v_refund < v_min_refund OR v_refund > 720 THEN
      RAISE EXCEPTION 'invalid_refund_window';
    END IF;
  ELSE
    v_refund := 24;
  END IF;

  -- download allowance
  IF p_fields ? 'max_downloads'
     AND pg_catalog.jsonb_typeof(p_fields -> 'max_downloads') <> 'null' THEN
    IF (p_fields ->> 'max_downloads') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'invalid_max_downloads';
    END IF;

    v_downloads := (p_fields ->> 'max_downloads')::int;

    IF v_downloads < 1 OR v_downloads > 100 THEN
      RAISE EXCEPTION 'invalid_max_downloads';
    END IF;
  ELSE
    v_downloads := 5;
  END IF;

  -- An explicit check first, so the common case answers slug_taken instead of a
  -- bare unique violation. The insert is still guarded for the racing case.
  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE pg_catalog.lower(p.slug::text) = v_slug
  ) THEN
    RAISE EXCEPTION 'slug_taken';
  END IF;

  BEGIN
    INSERT INTO public.products (
      vendor_id, category_id, title, slug, short_description, description,
      price_kobo, compare_at_price_kobo, commission_bps, affiliate_approval,
      refund_window_hours, max_downloads, status
    )
    VALUES (
      p_actor, v_category, v_title, v_slug::extensions.citext, v_short, v_description,
      v_price, v_compare, v_commission, v_approval,
      v_refund, v_downloads, 'draft'
    )
    RETURNING id INTO v_product;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'slug_taken';
  END;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'product.created', 'product', v_product::text,
    pg_catalog.jsonb_build_object('title', v_title, 'slug', v_slug, 'status', 'draft')
  );

  RETURN v_product;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.6 public.update_product(uuid, uuid, jsonb)
--
-- Allowed in draft, rejected, live and paused. Not in submitted (the vendor has
-- to withdraw first, so a reviewer never approves something that changes under
-- them) and not in archived.
--
-- The slug is frozen once the product has been published: an address that has
-- been shared cannot be taken over by someone else's link.
--
-- Every change is audited with before and after values, which is what makes an
-- edit to a live product acceptable before versioned review exists.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product(p_actor uuid, p_product uuid, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_min_bps     int := public.catalog_setting_int('product_commission_min_bps', 500);
  v_max_bps     int := public.catalog_setting_int('product_commission_max_bps', 8000);
  v_min_refund  int := public.catalog_setting_int('refund_window_min_hours', 24);
  v_row         public.products;
  v_old         jsonb;
  v_new         jsonb;
  v_before      jsonb := '{}'::jsonb;
  v_after       jsonb := '{}'::jsonb;
  v_key         text;
  v_text        text;
  v_int         int;
  v_big         bigint;
  v_slug        text;
BEGIN
  IF p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'invalid_fields';
  END IF;

  SELECT * INTO v_row FROM public.products p WHERE p.id = p_product FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_row.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_row.status NOT IN ('draft', 'rejected', 'live', 'paused') THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  -- A snapshot of the fields a vendor may change, for the audit entry.
  v_old := pg_catalog.jsonb_build_object(
    'title', v_row.title,
    'slug', v_row.slug::text,
    'short_description', v_row.short_description,
    'description', v_row.description,
    'price_kobo', v_row.price_kobo,
    'compare_at_price_kobo', v_row.compare_at_price_kobo,
    'commission_bps', v_row.commission_bps,
    'affiliate_approval', v_row.affiliate_approval,
    'refund_window_hours', v_row.refund_window_hours,
    'max_downloads', v_row.max_downloads,
    'category_id', v_row.category_id
  );

  -- title
  IF p_fields ? 'title' THEN
    v_text := pg_catalog.btrim(coalesce(p_fields ->> 'title', ''));

    IF char_length(v_text) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'invalid_title';
    END IF;

    v_row.title := v_text;
  END IF;

  -- slug: only while the product has never been published
  IF p_fields ? 'slug' THEN
    v_slug := pg_catalog.lower(pg_catalog.btrim(coalesce(p_fields ->> 'slug', '')));

    IF v_slug !~ '^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$' THEN
      RAISE EXCEPTION 'invalid_slug';
    END IF;

    IF v_row.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id <> p_product
        AND pg_catalog.lower(p.slug::text) = v_slug
    ) THEN
      RAISE EXCEPTION 'slug_taken';
    END IF;

    v_row.slug := v_slug::extensions.citext;
  END IF;

  -- short_description
  IF p_fields ? 'short_description' THEN
    v_text := pg_catalog.btrim(coalesce(p_fields ->> 'short_description', ''));

    IF char_length(v_text) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'invalid_short_description';
    END IF;

    v_row.short_description := v_text;
  END IF;

  -- description
  IF p_fields ? 'description' THEN
    v_text := coalesce(p_fields ->> 'description', '');

    IF char_length(v_text) > 10000 THEN
      RAISE EXCEPTION 'invalid_description';
    END IF;

    v_row.description := v_text;
  END IF;

  -- category
  IF p_fields ? 'category_slug' THEN
    SELECT c.id INTO v_int
    FROM public.product_categories c
    WHERE pg_catalog.lower(c.slug::text) = pg_catalog.lower(pg_catalog.btrim(p_fields ->> 'category_slug'));

    IF v_int IS NULL THEN
      RAISE EXCEPTION 'invalid_category';
    END IF;

    v_row.category_id := v_int::smallint;
  END IF;

  -- price
  IF p_fields ? 'price_kobo' THEN
    IF coalesce(p_fields ->> 'price_kobo', '') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'invalid_price';
    END IF;

    v_big := (p_fields ->> 'price_kobo')::bigint;

    IF v_big < 10000 OR v_big > 1000000000 THEN
      RAISE EXCEPTION 'invalid_price';
    END IF;

    v_row.price_kobo := v_big;
  END IF;

  -- compare-at price; explicitly null clears it
  IF p_fields ? 'compare_at_price_kobo' THEN
    IF pg_catalog.jsonb_typeof(p_fields -> 'compare_at_price_kobo') = 'null' THEN
      v_row.compare_at_price_kobo := NULL;
    ELSE
      IF (p_fields ->> 'compare_at_price_kobo') !~ '^[0-9]{1,12}$' THEN
        RAISE EXCEPTION 'invalid_compare_price';
      END IF;

      v_big := (p_fields ->> 'compare_at_price_kobo')::bigint;

      IF v_big <= v_row.price_kobo OR v_big > 1000000000 THEN
        RAISE EXCEPTION 'invalid_compare_price';
      END IF;

      v_row.compare_at_price_kobo := v_big;
    END IF;
  END IF;

  -- a lower price must not leave a compare-at price at or below it
  IF v_row.compare_at_price_kobo IS NOT NULL
     AND v_row.compare_at_price_kobo <= v_row.price_kobo THEN
    RAISE EXCEPTION 'invalid_compare_price';
  END IF;

  -- commission
  IF p_fields ? 'commission_bps' THEN
    IF (p_fields ->> 'commission_bps') !~ '^[0-9]{1,5}$' THEN
      RAISE EXCEPTION 'invalid_commission';
    END IF;

    v_int := (p_fields ->> 'commission_bps')::int;

    IF v_int < v_min_bps OR v_int > v_max_bps OR v_int < 500 OR v_int > 8000 THEN
      RAISE EXCEPTION 'invalid_commission';
    END IF;

    v_row.commission_bps := v_int;
  END IF;

  -- affiliate approval
  IF p_fields ? 'affiliate_approval' THEN
    v_text := coalesce(p_fields ->> 'affiliate_approval', '');

    IF v_text NOT IN ('open', 'approval', 'invite') THEN
      RAISE EXCEPTION 'invalid_approval';
    END IF;

    v_row.affiliate_approval := v_text;
  END IF;

  -- refund window
  IF p_fields ? 'refund_window_hours' THEN
    IF (p_fields ->> 'refund_window_hours') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'invalid_refund_window';
    END IF;

    v_int := (p_fields ->> 'refund_window_hours')::int;

    IF v_int < v_min_refund OR v_int > 720 THEN
      RAISE EXCEPTION 'invalid_refund_window';
    END IF;

    v_row.refund_window_hours := v_int;
  END IF;

  -- download allowance
  IF p_fields ? 'max_downloads' THEN
    IF (p_fields ->> 'max_downloads') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'invalid_max_downloads';
    END IF;

    v_int := (p_fields ->> 'max_downloads')::int;

    IF v_int < 1 OR v_int > 100 THEN
      RAISE EXCEPTION 'invalid_max_downloads';
    END IF;

    v_row.max_downloads := v_int;
  END IF;

  BEGIN
    UPDATE public.products p
       SET title                 = v_row.title,
           slug                  = v_row.slug,
           short_description     = v_row.short_description,
           description           = v_row.description,
           category_id           = v_row.category_id,
           price_kobo            = v_row.price_kobo,
           compare_at_price_kobo = v_row.compare_at_price_kobo,
           commission_bps        = v_row.commission_bps,
           affiliate_approval    = v_row.affiliate_approval,
           refund_window_hours   = v_row.refund_window_hours,
           max_downloads         = v_row.max_downloads
     WHERE p.id = p_product;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'slug_taken';
  END;

  v_new := pg_catalog.jsonb_build_object(
    'title', v_row.title,
    'slug', v_row.slug::text,
    'short_description', v_row.short_description,
    'description', v_row.description,
    'price_kobo', v_row.price_kobo,
    'compare_at_price_kobo', v_row.compare_at_price_kobo,
    'commission_bps', v_row.commission_bps,
    'affiliate_approval', v_row.affiliate_approval,
    'refund_window_hours', v_row.refund_window_hours,
    'max_downloads', v_row.max_downloads,
    'category_id', v_row.category_id
  );

  -- Only the keys that actually changed, so a no-op save writes no history.
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(v_old) LOOP
    IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
      v_before := v_before || pg_catalog.jsonb_build_object(v_key, v_old -> v_key);
      v_after  := v_after  || pg_catalog.jsonb_build_object(v_key, v_new -> v_key);
    END IF;
  END LOOP;

  IF v_before <> '{}'::jsonb THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    VALUES (p_actor, 'product.updated', 'product', p_product::text, v_before, v_after);
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.7 public.product_transition(uuid, uuid, text, text)
--
-- The state machine. Returns the new status.
--
--   action       who            from                       to
--   submit       vendor owner   draft, rejected            submitted
--   withdraw     vendor owner   submitted                  draft
--   pause        vendor owner   live                       paused
--   resume       vendor owner   paused                     live
--   archive      vendor owner   draft, rejected, paused    archived
--   approve      admin/mod      submitted                  live
--   reject       admin/mod      submitted                  rejected
--   staff_pause  admin/mod      live                       paused
--
-- A reviewer may never act on a product they own (self_review), and a reviewer
-- decision needs a reason of at least 10 characters.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_transition(
  p_actor  uuid,
  p_product uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row        public.products;
  v_status     public.product_status;
  v_reason     text;
  v_ready      jsonb;
  v_is_staff   boolean;
  v_from       text;
BEGIN
  SELECT * INTO v_row FROM public.products p WHERE p.id = p_product FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_from     := v_row.status::text;
  v_reason   := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_is_staff := public.is_staff(p_actor)
                AND (
                  public.has_role(p_actor, 'admin')
                  OR public.has_role(p_actor, 'moderator')
                );

  IF p_action = 'submit' OR p_action = 'withdraw' OR p_action = 'pause'
     OR p_action = 'resume' OR p_action = 'archive' THEN
    IF v_row.vendor_id <> p_actor THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSIF p_action = 'approve' OR p_action = 'reject' OR p_action = 'staff_pause' THEN
    IF NOT v_is_staff THEN
      RAISE EXCEPTION 'forbidden';
    END IF;

    -- Nobody reviews their own product, whichever role they hold.
    IF v_row.vendor_id = p_actor THEN
      RAISE EXCEPTION 'self_review';
    END IF;
  ELSE
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_action = 'submit' THEN
    IF v_from NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_ready := public.get_product_readiness(p_product);

    IF pg_catalog.jsonb_array_length(v_ready -> 'missing') > 0 THEN
      RAISE EXCEPTION 'not_ready';
    END IF;

    v_status := 'submitted';
  ELSIF p_action = 'withdraw' THEN
    IF v_from <> 'submitted' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_status := 'draft';
  ELSIF p_action = 'pause' THEN
    IF v_from <> 'live' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_status := 'paused';
  ELSIF p_action = 'resume' THEN
    IF v_from <> 'paused' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_status := 'live';
  ELSIF p_action = 'archive' THEN
    IF v_from NOT IN ('draft', 'rejected', 'paused') THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_status := 'archived';
  ELSIF p_action = 'approve' THEN
    IF v_from <> 'submitted' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    v_status := 'live';
  ELSIF p_action = 'reject' THEN
    IF v_from <> 'submitted' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
      RAISE EXCEPTION 'reason_required';
    END IF;

    v_status := 'rejected';
  ELSE -- staff_pause
    IF v_from <> 'live' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
      RAISE EXCEPTION 'reason_required';
    END IF;

    v_status := 'paused';
  END IF;

  UPDATE public.products p
     SET status        = v_status,
         submitted_at  = CASE
                           WHEN v_status = 'submitted' THEN now()
                           ELSE p.submitted_at
                         END,
         published_at  = CASE
                           WHEN v_status = 'live' AND p.published_at IS NULL THEN now()
                           WHEN v_status = 'live' THEN p.published_at
                           ELSE p.published_at
                         END,
         reviewed_at   = CASE
                           WHEN p_action IN ('approve', 'reject') THEN now()
                           ELSE p.reviewed_at
                         END,
         reviewed_by   = CASE
                           WHEN p_action IN ('approve', 'reject') THEN p_actor
                           ELSE p.reviewed_by
                         END,
         reject_reason = CASE
                           WHEN p_action = 'reject' THEN v_reason
                           WHEN p_action = 'submit' THEN NULL
                           ELSE p.reject_reason
                         END
   WHERE p.id = p_product;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'product.' || p_action,
    'product',
    p_product::text,
    pg_catalog.jsonb_build_object('status', v_from),
    pg_catalog.jsonb_build_object('status', v_status::text, 'reason', v_reason)
  );

  RETURN v_status::text;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.8 public.register_product_file(...)
--
-- Reserves the row for an upload that is about to happen. The storage key is
-- built by the caller, so its prefix is checked here: the key must live under
-- this product and this file id, or a vendor could point a row at another
-- product's object.
--
-- Limits: 10 files and 5 GiB per product, counted across pending and uploaded
-- rows so ten abandoned uploads cannot be used to get eleven files.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_product_file(
  p_actor               uuid,
  p_product             uuid,
  p_file_id             uuid,
  p_storage_key         text,
  p_original_name       text,
  p_content_type        text,
  p_size_bytes          bigint,
  p_multipart_upload_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row       public.products;
  v_count     int;
  v_total     bigint;
  v_prefix    text;
  v_name      text;
BEGIN
  SELECT * INTO v_row FROM public.products p WHERE p.id = p_product FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_row.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_file_id IS NULL OR p_storage_key IS NULL OR p_storage_key = '' THEN
    RAISE EXCEPTION 'key_mismatch';
  END IF;

  v_prefix := 'products/' || p_product::text || '/' || p_file_id::text || '/';

  IF pg_catalog.left(p_storage_key, char_length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'key_mismatch';
  END IF;

  v_name := pg_catalog.btrim(coalesce(p_original_name, ''));

  IF char_length(v_name) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_content_type IS NULL OR char_length(pg_catalog.btrim(p_content_type)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_content_type';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 2147483648 THEN
    RAISE EXCEPTION 'size_limit';
  END IF;

  -- A repeated call for the row that is already there is a no-op, so a retried
  -- request does not reserve a second file.
  IF EXISTS (SELECT 1 FROM public.product_files f WHERE f.id = p_file_id) THEN
    IF EXISTS (
      SELECT 1 FROM public.product_files f
      WHERE f.id = p_file_id
        AND f.product_id = p_product
        AND f.storage_key = p_storage_key
    ) THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'key_mismatch';
  END IF;

  SELECT count(*), coalesce(sum(f.size_bytes), 0)
    INTO v_count, v_total
    FROM public.product_files f
   WHERE f.product_id = p_product;

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'file_limit';
  END IF;

  IF v_total + p_size_bytes > 5368709120 THEN
    RAISE EXCEPTION 'size_limit';
  END IF;

  INSERT INTO public.product_files (
    id, product_id, storage_key, original_name, content_type, size_bytes,
    status, scan_status, multipart_upload_id
  )
  VALUES (
    p_file_id, p_product, p_storage_key, v_name, pg_catalog.btrim(p_content_type), p_size_bytes,
    'pending', 'not_scanned', nullif(pg_catalog.btrim(coalesce(p_multipart_upload_id, '')), '')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.9 public.confirm_product_file(uuid, uuid, bigint)
-- The upload finished and the object's real size is known. A size that does not
-- match the reservation is refused; the action deletes the object and the row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_product_file(
  p_actor       uuid,
  p_file        uuid,
  p_actual_size bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file    public.product_files;
  v_product public.products;
BEGIN
  SELECT * INTO v_file FROM public.product_files f WHERE f.id = p_file FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_product FROM public.products p WHERE p.id = v_file.product_id;

  IF NOT FOUND OR v_product.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_actual_size IS NULL OR p_actual_size <> v_file.size_bytes THEN
    RAISE EXCEPTION 'size_mismatch';
  END IF;

  UPDATE public.product_files f
     SET status      = 'uploaded',
         uploaded_at = coalesce(f.uploaded_at, now())
   WHERE f.id = p_file;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.10 public.delete_product_file(uuid, uuid)
-- Returns the storage key so the caller can delete the object afterwards. The
-- database goes first: if the object delete fails, an orphaned object is
-- harmless, while a row pointing at nothing is not.
--
-- A live or submitted product may not lose its last uploaded file: a published
-- product with nothing to download is a broken promise.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_product_file(p_actor uuid, p_file uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file      public.product_files;
  v_product   public.products;
  v_remaining int;
BEGIN
  SELECT * INTO v_file FROM public.product_files f WHERE f.id = p_file FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_product FROM public.products p WHERE p.id = v_file.product_id FOR UPDATE;

  IF NOT FOUND OR v_product.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_product.status IN ('live', 'submitted') AND v_file.status = 'uploaded' THEN
    SELECT count(*) INTO v_remaining
    FROM public.product_files f
    WHERE f.product_id = v_product.id
      AND f.id <> p_file
      AND f.status = 'uploaded';

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'last_file';
    END IF;
  END IF;

  DELETE FROM public.product_files f WHERE f.id = p_file;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before)
  VALUES (
    p_actor, 'product.file.deleted', 'product_file', p_file::text,
    pg_catalog.jsonb_build_object('storage_key', v_file.storage_key)
  );

  RETURN v_file.storage_key;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.11 public.add_product_image(...)
-- The bytes are already in Cloudinary; the action has verified them. At most 6
-- images, and the first one added becomes the cover.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_product_image(
  p_actor     uuid,
  p_product   uuid,
  p_public_id text,
  p_alt       text,
  p_width     int,
  p_height    int,
  p_bytes     int,
  p_format    text,
  p_make_cover boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row    public.products;
  v_count  int;
  v_alt    text;
  v_cover  boolean;
  v_id     uuid;
BEGIN
  SELECT * INTO v_row FROM public.products p WHERE p.id = p_product FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_row.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_public_id IS NULL
     OR pg_catalog.left(p_public_id, char_length('products/' || p_product::text || '/'))
        <> 'products/' || p_product::text || '/' THEN
    RAISE EXCEPTION 'key_mismatch';
  END IF;

  v_alt := nullif(pg_catalog.btrim(coalesce(p_alt, '')), '');

  IF v_alt IS NOT NULL AND char_length(v_alt) > 140 THEN
    RAISE EXCEPTION 'invalid_alt';
  END IF;

  SELECT count(*) INTO v_count FROM public.product_images i WHERE i.product_id = p_product;

  IF v_count >= 6 THEN
    RAISE EXCEPTION 'image_limit';
  END IF;

  v_cover := coalesce(p_make_cover, false) OR v_count = 0;

  IF v_cover THEN
    UPDATE public.product_images i
       SET is_cover = false
     WHERE i.product_id = p_product
       AND i.is_cover;
  END IF;

  INSERT INTO public.product_images (
    product_id, cloudinary_public_id, alt_text, width, height, bytes, format, sort, is_cover
  )
  VALUES (
    p_product, p_public_id, v_alt, p_width, p_height, p_bytes,
    nullif(pg_catalog.btrim(coalesce(p_format, '')), ''), v_count::smallint, v_cover
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.12 public.remove_product_image(uuid, uuid)
-- Returns the Cloudinary public id so the caller can destroy the asset. When the
-- cover goes, the image with the lowest sort order becomes the new cover.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_product_image(p_actor uuid, p_image uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_image   public.product_images;
  v_product public.products;
  v_next    uuid;
BEGIN
  SELECT * INTO v_image FROM public.product_images i WHERE i.id = p_image FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_product FROM public.products p WHERE p.id = v_image.product_id FOR UPDATE;

  IF NOT FOUND OR v_product.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.product_images i WHERE i.id = p_image;

  IF v_image.is_cover THEN
    SELECT i.id INTO v_next
    FROM public.product_images i
    WHERE i.product_id = v_image.product_id
    ORDER BY i.sort, i.created_at
    LIMIT 1;

    IF v_next IS NOT NULL THEN
      UPDATE public.product_images i
         SET is_cover = true
       WHERE i.id = v_next;
    END IF;
  END IF;

  RETURN v_image.cloudinary_public_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.13 public.set_cover_image(uuid, uuid)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_cover_image(p_actor uuid, p_image uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_image   public.product_images;
  v_product public.products;
BEGIN
  SELECT * INTO v_image FROM public.product_images i WHERE i.id = p_image FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_product FROM public.products p WHERE p.id = v_image.product_id FOR UPDATE;

  IF NOT FOUND OR v_product.vendor_id <> p_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.product_images i
     SET is_cover = false
   WHERE i.product_id = v_image.product_id
     AND i.is_cover
     AND i.id <> p_image;

  UPDATE public.product_images i
     SET is_cover = true
   WHERE i.id = p_image;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.14 public.list_stale_pending_files(interval)
-- Reservations that never turned into an upload: the row, the key and the
-- multipart upload id (when there was one). Ordered oldest first so a caller
-- can take them 50 at a time.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_stale_pending_files(
  p_older_than interval DEFAULT '24 hours'
)
RETURNS TABLE (id uuid, storage_key text, multipart_upload_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.id, f.storage_key, f.multipart_upload_id
  FROM public.product_files f
  WHERE f.status = 'pending'
    AND f.created_at < now() - p_older_than
  ORDER BY f.created_at;
$$;

-- ----------------------------------------------------------------------------
-- 11.15 public.purge_pending_file(uuid)
-- Delete a reservation row, but only while it is still pending: a file that
-- completed between the listing and this call is left alone.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_pending_file(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.product_files f
  WHERE f.id = p_id
    AND f.status = 'pending';
END;
$$;

-- ----------------------------------------------------------------------------
-- 11.16 public.log_product_file_admin_access(uuid, uuid)
-- The audit row written when a member of staff takes a download link for a
-- vendor's file. Malware scanning is not implemented, so this record is the
-- control that stands in for it: every look at a file is attributable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_product_file_admin_access(p_actor uuid, p_file uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff(p_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_files f WHERE f.id = p_file) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
  VALUES (p_actor, 'product.file.admin_download', 'product_file', p_file::text);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Nothing here is callable from a browser
-- Revoked from PUBLIC, anon and authenticated; granted to service_role only.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.catalog_setting_int(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_product_readiness(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_actor_is_vendor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_owns_product(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_slugify(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_product_draft(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_product(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_transition(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_product_file(uuid, uuid, uuid, text, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_product_file(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_product_file(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_product_image(uuid, uuid, text, text, int, int, int, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_product_image(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_cover_image(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_stale_pending_files(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_pending_file(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_product_file_admin_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.catalog_setting_int(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_product_readiness(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_actor_is_vendor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_owns_product(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_slugify(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_product_draft(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_product(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_transition(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_product_file(uuid, uuid, uuid, text, text, text, bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_product_file(uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_product_file(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_product_image(uuid, uuid, text, text, int, int, int, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_product_image(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_cover_image(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_stale_pending_files(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_pending_file(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_product_file_admin_access(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 13. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261114000100', 'catalog')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops the four catalog tables, every product, file reservation
-- and image row, and all ecommerce data is lost. The Cloudinary assets and the
-- R2 objects are NOT deleted by this block: the rows that held their keys are
-- gone, so they have to be cleared out of the bucket and the Cloudinary account
-- by hand. The three settings rows and the product_status enum are dropped too.
-- Nothing from another migration is touched.
-- ============================================================================
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.log_product_file_admin_access(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.purge_pending_file(uuid);
-- DROP FUNCTION IF EXISTS public.list_stale_pending_files(interval);
-- DROP FUNCTION IF EXISTS public.set_cover_image(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.remove_product_image(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.add_product_image(uuid, uuid, text, text, int, int, int, text, boolean);
-- DROP FUNCTION IF EXISTS public.delete_product_file(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.confirm_product_file(uuid, uuid, bigint);
-- DROP FUNCTION IF EXISTS public.register_product_file(uuid, uuid, uuid, text, text, text, bigint, text);
-- DROP FUNCTION IF EXISTS public.product_transition(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.update_product(uuid, uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.create_product_draft(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.catalog_slugify(text);
-- DROP FUNCTION IF EXISTS public.catalog_owns_product(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.catalog_actor_is_vendor(uuid);
-- DROP FUNCTION IF EXISTS public.get_product_readiness(uuid);
--
-- DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
--
-- DROP POLICY IF EXISTS product_images_select_staff ON public.product_images;
-- DROP POLICY IF EXISTS product_images_select_own ON public.product_images;
-- DROP POLICY IF EXISTS product_files_select_staff ON public.product_files;
-- DROP POLICY IF EXISTS product_files_select_own ON public.product_files;
-- DROP POLICY IF EXISTS products_select_staff ON public.products;
-- DROP POLICY IF EXISTS products_select_own ON public.products;
-- DROP POLICY IF EXISTS product_categories_select_all ON public.product_categories;
--
-- DROP TABLE IF EXISTS public.product_images;
-- DROP TABLE IF EXISTS public.product_files;
-- DROP TABLE IF EXISTS public.products;
-- DROP TABLE IF EXISTS public.product_categories;
--
-- DROP FUNCTION IF EXISTS public.catalog_setting_int(text, int);
--
-- DROP TYPE IF EXISTS public.product_status;
--
-- DELETE FROM public.settings
--  WHERE key IN ('refund_window_min_hours', 'product_commission_min_bps',
--                'product_commission_max_bps');
--
-- DELETE FROM public.app_migrations WHERE version = '20261114000100';
--
-- COMMIT;
