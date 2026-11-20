-- ============================================================================
-- Migration 20261118000200_affiliate_tracking
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  short tracked links (/r/<code>), the click they record, the first-party
--         cookie's server side, the access rules that decide who may promote a
--         product, daily affiliate statistics, anomaly flags and the click purge.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.profiles, public.user_roles,
-- public.audit_log, public.settings, public.has_role, public.is_staff,
-- public.app_migrations, the citext extension), on
-- 20261113000100_roles_onboarding.sql (public.vendor_profiles,
-- public.affiliate_profiles, public.is_reserved_handle) and on
-- 20261116000200_commerce_core.sql (public.products, public.orders,
-- public.order_items, public.create_order, public.commerce_setting_int).
--
-- The rules, in one place:
--   * a link belongs to one affiliate and one product, and its code is a random
--     8 character string from an alphabet with no look-alike characters;
--   * a click is recorded with hashes, never with an address or a full referrer;
--   * the affiliate on an order is decided by the click, never by the browser;
--   * every function is SECURITY DEFINER with an empty search_path, and only the
--     service role may execute it. No client writes to any table here.
--
-- Money is bigint kobo throughout, as everywhere else in the database.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.affiliate_product_access
--
-- Whether one affiliate may promote one product. The row is the whole answer:
-- 'open' products need no row, 'approval' products need status 'approved', and
-- 'invite' products need an invite that was accepted (which writes 'approved').
--
-- 'blocked' and 'rejected' are refusals, and a refusal wins over everything:
-- affiliate_can_promote() returns false for both whatever the product mode is.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_product_access (
  affiliate_id uuid        NOT NULL
                           REFERENCES public.affiliate_profiles (user_id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL
                           REFERENCES public.products (id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'blocked')),
  note         text        CHECK (note IS NULL OR char_length(note) <= 500),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid,
  PRIMARY KEY (affiliate_id, product_id)
);

CREATE INDEX IF NOT EXISTS affiliate_product_access_product_idx
  ON public.affiliate_product_access (product_id, status);

-- ----------------------------------------------------------------------------
-- 2. public.affiliate_invites
--
-- A single-use-counted invitation to promote one product. Only the SHA-256 hex
-- of the token is stored, so the plain token exists once, in the response to the
-- vendor who created it. The row is never updated in place except for uses and
-- revoked_at: an expired or revoked invite is kept as history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_invites (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid        NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_by uuid        NOT NULL,
  token_hash text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  max_uses   int         NOT NULL CHECK (max_uses BETWEEN 1 AND 1000),
  uses       int         NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_invites_uses_within_max CHECK (uses <= max_uses)
);

CREATE INDEX IF NOT EXISTS affiliate_invites_product_idx
  ON public.affiliate_invites (product_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. public.affiliate_links
--
-- The short link. `code` is the random part of /r/<code>; `alias` is the vanity
-- alternative, a citext handle with the same rules as a store slug, so
-- /r/ada-deals and /r/ADA-DEALS are the same link.
--
-- The unique index on (affiliate_id, product_id, coalesce(label, '')) is what
-- stops one affiliate from creating two unlabelled links for the same product:
-- the label is the affiliate's own name for the link, and two links with no name
-- are the same link.
--
-- The limits (50 active links per product, 500 per affiliate) are enforced in
-- create_affiliate_link(), not by a constraint: a count cannot be a CHECK.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid        NOT NULL
                           REFERENCES public.affiliate_profiles (user_id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  code         text        NOT NULL UNIQUE CHECK (code ~ '^[a-hj-km-np-z2-9]{8}$'),
  alias        extensions.citext UNIQUE CHECK (
                             alias IS NULL
                             OR (
                               (alias::text) ~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'
                               AND NOT public.is_reserved_handle(alias::text)
                             )
                           ),
  label        text        CHECK (label IS NULL OR char_length(label) <= 60),
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_links_owner_label_idx
  ON public.affiliate_links (affiliate_id, product_id, coalesce(label, ''));

CREATE INDEX IF NOT EXISTS affiliate_links_affiliate_status_idx
  ON public.affiliate_links (affiliate_id, status);

CREATE INDEX IF NOT EXISTS affiliate_links_product_status_idx
  ON public.affiliate_links (product_id, status);

-- ----------------------------------------------------------------------------
-- 4. public.affiliate_clicks
--
-- One row per human click. There is no raw address, no user agent and no full
-- referrer here: ip_hash and ua_hash are SHA-256 digests made with a salt that
-- rotates daily (lib/tracking/hash.ts), and referrer_host is only the host.
--
-- id has no default on purpose: the route generates it before the insert, so the
-- click id it puts in the cookie is the click id that was stored.
--
-- A bot is never stored. is_unique is true when the same link has not seen the
-- same ip_hash and ua_hash in the previous 30 minutes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id            uuid        PRIMARY KEY,
  link_id       uuid        NOT NULL REFERENCES public.affiliate_links (id) ON DELETE CASCADE,
  affiliate_id  uuid        NOT NULL
                            REFERENCES public.affiliate_profiles (user_id) ON DELETE CASCADE,
  product_id    uuid        NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ip_hash       text,
  ua_hash       text,
  referrer_host text        CHECK (referrer_host IS NULL OR char_length(referrer_host) <= 100),
  country       text        CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  device        text        CHECK (device IS NULL OR device IN ('mobile', 'desktop', 'tablet', 'other')),
  sub1          text        CHECK (sub1 IS NULL OR char_length(sub1) <= 60),
  sub2          text        CHECK (sub2 IS NULL OR char_length(sub2) <= 60),
  sub3          text        CHECK (sub3 IS NULL OR char_length(sub3) <= 60),
  utm_source    text        CHECK (utm_source IS NULL OR char_length(utm_source) <= 60),
  utm_medium    text        CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 60),
  utm_campaign  text        CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 60),
  is_unique     boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS affiliate_clicks_affiliate_created_idx
  ON public.affiliate_clicks (affiliate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS affiliate_clicks_link_created_idx
  ON public.affiliate_clicks (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS affiliate_clicks_product_created_idx
  ON public.affiliate_clicks (product_id, created_at DESC);

-- The uniqueness window and the burst scan both read this index.
CREATE INDEX IF NOT EXISTS affiliate_clicks_ip_link_created_idx
  ON public.affiliate_clicks (ip_hash, link_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. public.affiliate_daily_stats
--
-- The dashboard's numbers, one row per Lagos day, affiliate, product and link.
-- link_id is NULL for the product total; the unique index below treats that NULL
-- as one value, so the upsert in rollup_affiliate_stats() has a single conflict
-- target for both shapes.
--
-- The table is derived data: every row can be rebuilt from affiliate_clicks and
-- the paid orders, which is exactly what rollup_affiliate_stats() does.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_daily_stats (
  day                date   NOT NULL,
  affiliate_id       uuid   NOT NULL
                            REFERENCES public.affiliate_profiles (user_id) ON DELETE CASCADE,
  product_id         uuid   NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  link_id            uuid   REFERENCES public.affiliate_links (id) ON DELETE CASCADE,
  clicks             int    NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  unique_clicks      int    NOT NULL DEFAULT 0 CHECK (unique_clicks >= 0),
  orders             int    NOT NULL DEFAULT 0 CHECK (orders >= 0),
  order_revenue_kobo bigint NOT NULL DEFAULT 0 CHECK (order_revenue_kobo >= 0),
  commission_kobo    bigint NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_daily_stats_key_idx
  ON public.affiliate_daily_stats (
    day,
    affiliate_id,
    product_id,
    coalesce(link_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS affiliate_daily_stats_affiliate_day_idx
  ON public.affiliate_daily_stats (affiliate_id, day DESC);

-- ----------------------------------------------------------------------------
-- 6. public.risk_flags
--
-- Written only by scan_click_anomalies(). A flag is never edited except to be
-- resolved, and resolving it records who did.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_flags (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id uuid        NOT NULL
                           REFERENCES public.affiliate_profiles (user_id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('click_burst', 'clicks_without_sales')),
  details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid
);

CREATE INDEX IF NOT EXISTS risk_flags_affiliate_created_idx
  ON public.risk_flags (affiliate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS risk_flags_open_idx
  ON public.risk_flags (created_at DESC)
  WHERE resolved_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7. public.affiliate_can_promote(uuid, uuid) -> boolean
--
-- The single rule for "may this affiliate promote this product right now". Every
-- other function calls it, and so does create_order, so a link, a click, a
-- checkout and a dashboard all agree.
--
-- True only when all of these hold:
--   * the affiliate role is active and the affiliate profile is active;
--   * the product is live and its vendor is active;
--   * no access row says 'blocked' or 'rejected';
--   * for 'open', that is enough; for 'approval' and 'invite' an 'approved'
--     access row is required.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_can_promote(p_affiliate uuid, p_product uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode   text;
  v_status text;
BEGIN
  IF p_affiliate IS NULL OR p_product IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.has_role(p_affiliate, 'affiliate') THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliate_profiles ap
    WHERE ap.user_id = p_affiliate
      AND ap.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  SELECT p.affiliate_approval
    INTO v_mode
  FROM public.products p
  JOIN public.vendor_profiles v ON v.user_id = p.vendor_id
  WHERE p.id = p_product
    AND p.status = 'live'
    AND v.status = 'active';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT a.status
    INTO v_status
  FROM public.affiliate_product_access a
  WHERE a.affiliate_id = p_affiliate
    AND a.product_id = p_product;

  IF v_status IN ('blocked', 'rejected') THEN
    RETURN false;
  END IF;

  IF v_mode = 'open' THEN
    RETURN true;
  END IF;

  RETURN coalesce(v_status, '') = 'approved';
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. public.create_affiliate_link(uuid, uuid, text, text) -> jsonb
--
-- Generates the code, enforces the two limits and the alias rules, and stores
-- the link. The code alphabet leaves out i, l, o, 0 and 1, so a code read out
-- loud or typed from a screenshot cannot be misread.
--
-- The retry loop is on the unique violation, not on a pre-check: two concurrent
-- calls must not both pass a "does this code exist" test and then collide.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_affiliate_link(
  p_affiliate uuid,
  p_product   uuid,
  p_label     text,
  p_alias     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_label    text;
  v_alias    text;
  v_code     text;
  v_digest   bytea;
  v_index    int;
  v_pos      int;
  v_id       uuid;
  v_active_for_product int;
  v_active_total       int;
  v_attempt  int := 0;
BEGIN
  IF NOT public.affiliate_can_promote(p_affiliate, p_product) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  v_label := nullif(pg_catalog.btrim(coalesce(p_label, '')), '');

  IF v_label IS NOT NULL AND char_length(v_label) > 60 THEN
    RAISE EXCEPTION 'invalid_label';
  END IF;

  v_alias := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_alias, ''))), '');

  IF v_alias IS NOT NULL THEN
    IF (v_alias !~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$')
       OR public.is_reserved_handle(v_alias) THEN
      RAISE EXCEPTION 'invalid_alias';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.affiliate_links l
      WHERE pg_catalog.lower(l.alias::text) = v_alias
    ) THEN
      RAISE EXCEPTION 'alias_taken';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.affiliate_links l
    WHERE l.affiliate_id = p_affiliate
      AND l.product_id = p_product
      AND coalesce(l.label, '') = coalesce(v_label, '')
  ) THEN
    RAISE EXCEPTION 'label_taken';
  END IF;

  SELECT count(*) INTO v_active_for_product
  FROM public.affiliate_links l
  WHERE l.affiliate_id = p_affiliate
    AND l.product_id = p_product
    AND l.status = 'active';

  IF v_active_for_product >= 50 THEN
    RAISE EXCEPTION 'link_limit';
  END IF;

  SELECT count(*) INTO v_active_total
  FROM public.affiliate_links l
  WHERE l.affiliate_id = p_affiliate
    AND l.status = 'active';

  IF v_active_total >= 500 THEN
    RAISE EXCEPTION 'link_limit';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    -- Eight bytes of an MD5 digest, each taken modulo the alphabet length. The
    -- alphabet has 31 characters (no i, l, o, 0 or 1), so the first eight
    -- letters are very slightly more likely than the rest: a difference of one
    -- in 256 that no one can exploit across an 8 character code.
    v_digest := pg_catalog.decode(
      pg_catalog.md5(
        pg_catalog.gen_random_uuid()::text
        || pg_catalog.clock_timestamp()::text
        || v_attempt::text
      ),
      'hex'
    );

    v_code := '';

    FOR v_pos IN 0..7 LOOP
      v_index := (pg_catalog.get_byte(v_digest, v_pos) % pg_catalog.char_length(v_alphabet)) + 1;
      v_code := v_code || pg_catalog.substr(v_alphabet, v_index, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.affiliate_links (affiliate_id, product_id, code, alias, label)
      VALUES (p_affiliate, p_product, v_code, v_alias::extensions.citext, v_label)
      RETURNING id INTO v_id;

      RETURN pg_catalog.jsonb_build_object(
        'link_id', v_id,
        'code', v_code,
        'alias', v_alias
      );
    EXCEPTION
      WHEN unique_violation THEN
        -- Either the code collided (try another) or the alias was taken by a
        -- concurrent call after the check above (report it, do not retry).
        IF EXISTS (
          SELECT 1
          FROM public.affiliate_links l
          WHERE pg_catalog.lower(l.alias::text) = v_alias
        ) THEN
          RAISE EXCEPTION 'alias_taken';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.affiliate_links l
          WHERE l.affiliate_id = p_affiliate
            AND l.product_id = p_product
            AND coalesce(l.label, '') = coalesce(v_label, '')
        ) THEN
          RAISE EXCEPTION 'label_taken';
        END IF;

        IF v_attempt >= 5 THEN
          RAISE EXCEPTION 'code_unavailable';
        END IF;
    END;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. public.archive_affiliate_link(uuid, uuid) -> void
-- Idempotent: archiving an archived link is not an error.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_affiliate_link(p_affiliate uuid, p_link uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.affiliate_links l
     SET status = 'archived'
   WHERE l.id = p_link
     AND l.affiliate_id = p_affiliate;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. public.request_product_access(uuid, uuid, text) -> text
--
-- Asks the vendor for permission on an 'approval' product. Idempotent: a second
-- ask returns the status that is already there instead of writing another row or
-- raising. A blocked affiliate cannot ask at all.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_product_access(
  p_affiliate uuid,
  p_product   uuid,
  p_note      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode   text;
  v_note   text;
  v_status text;
BEGIN
  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');

  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note';
  END IF;

  SELECT p.affiliate_approval
    INTO v_mode
  FROM public.products p
  WHERE p.id = p_product
    AND p.status = 'live';

  IF NOT FOUND OR v_mode <> 'approval' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  IF NOT public.has_role(p_affiliate, 'affiliate')
     OR NOT EXISTS (
       SELECT 1
       FROM public.affiliate_profiles ap
       WHERE ap.user_id = p_affiliate
         AND ap.status = 'active'
     ) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT a.status
    INTO v_status
  FROM public.affiliate_product_access a
  WHERE a.affiliate_id = p_affiliate
    AND a.product_id = p_product;

  IF FOUND THEN
    IF v_status = 'blocked' THEN
      RAISE EXCEPTION 'blocked';
    END IF;

    RETURN v_status;
  END IF;

  INSERT INTO public.affiliate_product_access (affiliate_id, product_id, status, note)
  VALUES (p_affiliate, p_product, 'pending', v_note)
  ON CONFLICT (affiliate_id, product_id) DO NOTHING;

  SELECT a.status
    INTO v_status
  FROM public.affiliate_product_access a
  WHERE a.affiliate_id = p_affiliate
    AND a.product_id = p_product;

  RETURN coalesce(v_status, 'pending');
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. public.decide_product_access(uuid, uuid, uuid, text, text) -> void
--
-- The vendor (or an admin or moderator) decides. A 'blocked' decision also
-- archives that affiliate's active links for the product, so a link already in
-- the wild stops working at the same moment the decision is made.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_product_access(
  p_actor     uuid,
  p_affiliate uuid,
  p_product   uuid,
  p_decision  text,
  p_note      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor   uuid;
  v_note     text;
  v_previous text;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'blocked') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');

  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note';
  END IF;

  SELECT p.vendor_id INTO v_vendor FROM public.products p WHERE p.id = p_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p_actor IS NULL
     OR NOT (
       p_actor = v_vendor
       OR public.has_role(p_actor, 'admin')
       OR public.has_role(p_actor, 'moderator')
     ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.affiliate_profiles ap WHERE ap.user_id = p_affiliate
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT a.status
    INTO v_previous
  FROM public.affiliate_product_access a
  WHERE a.affiliate_id = p_affiliate
    AND a.product_id = p_product
  FOR UPDATE;

  INSERT INTO public.affiliate_product_access (
    affiliate_id, product_id, status, note, requested_at, decided_at, decided_by
  )
  VALUES (
    p_affiliate, p_product, p_decision, v_note, pg_catalog.now(), pg_catalog.now(), p_actor
  )
  ON CONFLICT (affiliate_id, product_id) DO UPDATE
    SET status     = EXCLUDED.status,
        note       = coalesce(EXCLUDED.note, public.affiliate_product_access.note),
        decided_at = EXCLUDED.decided_at,
        decided_by = EXCLUDED.decided_by;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor,
    'affiliate_access.decided',
    'affiliate_product_access',
    p_affiliate::text || ':' || p_product::text,
    CASE WHEN v_previous IS NULL THEN NULL
         ELSE pg_catalog.jsonb_build_object('status', v_previous)
    END,
    pg_catalog.jsonb_build_object(
      'status', p_decision,
      'product_id', p_product,
      'affiliate_id', p_affiliate
    )
  );

  IF p_decision = 'blocked' THEN
    UPDATE public.affiliate_links l
       SET status = 'archived'
     WHERE l.affiliate_id = p_affiliate
       AND l.product_id = p_product
       AND l.status = 'active';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. public.create_affiliate_invite(uuid, uuid, text, int, int) -> uuid
-- The vendor owner of the product, or any staff member, may create an invite.
-- The token hash is the only thing stored; the plain token is returned once, by
-- the server action, to the person who created it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_affiliate_invite(
  p_actor       uuid,
  p_product     uuid,
  p_token_hash  text,
  p_max_uses    int,
  p_expires_days int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor uuid;
  v_hash   text;
  v_id     uuid;
BEGIN
  v_hash := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));

  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF p_max_uses IS NULL OR p_max_uses < 1 OR p_max_uses > 1000 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  END IF;

  IF p_expires_days IS NULL OR p_expires_days < 1 OR p_expires_days > 365 THEN
    RAISE EXCEPTION 'invalid_expiry';
  END IF;

  SELECT p.vendor_id INTO v_vendor FROM public.products p WHERE p.id = p_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p_actor IS NULL OR NOT (p_actor = v_vendor OR public.is_staff(p_actor)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.affiliate_invites (
    product_id, created_by, token_hash, max_uses, expires_at
  )
  VALUES (
    p_product,
    p_actor,
    v_hash,
    p_max_uses,
    pg_catalog.now() + pg_catalog.make_interval(days => p_expires_days)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'affiliate_invite.created', 'affiliate_invite', v_id::text,
    pg_catalog.jsonb_build_object(
      'product_id', p_product,
      'max_uses', p_max_uses,
      'expires_days', p_expires_days
    )
  );

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. public.accept_affiliate_invite(uuid, text) -> jsonb
--
-- Valid, unexpired, not revoked, and uses < max_uses, or invite_invalid. One
-- code for every failure on purpose: a stranger holding a wrong token learns
-- nothing about whether it was close, expired or used up.
--
-- The invite row is locked, so two people accepting the last use at the same
-- moment cannot both succeed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_affiliate_invite(p_affiliate uuid, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash   text;
  v_invite public.affiliate_invites;
BEGIN
  v_hash := pg_catalog.lower(pg_catalog.btrim(coalesce(p_token_hash, '')));

  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  IF p_affiliate IS NULL
     OR NOT public.has_role(p_affiliate, 'affiliate')
     OR NOT EXISTS (
       SELECT 1
       FROM public.affiliate_profiles ap
       WHERE ap.user_id = p_affiliate
         AND ap.status = 'active'
     ) THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT * INTO v_invite
  FROM public.affiliate_invites i
  WHERE i.token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND
     OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= pg_catalog.now()
     OR v_invite.uses >= v_invite.max_uses THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  UPDATE public.affiliate_invites i
     SET uses = i.uses + 1
   WHERE i.id = v_invite.id;

  INSERT INTO public.affiliate_product_access (
    affiliate_id, product_id, status, requested_at, decided_at, decided_by
  )
  VALUES (
    p_affiliate, v_invite.product_id, 'approved',
    pg_catalog.now(), pg_catalog.now(), v_invite.created_by
  )
  ON CONFLICT (affiliate_id, product_id) DO UPDATE
    SET status     = 'approved',
        decided_at = EXCLUDED.decided_at,
        decided_by = EXCLUDED.decided_by;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_affiliate, 'affiliate_invite.accepted', 'affiliate_invite', v_invite.id::text,
    pg_catalog.jsonb_build_object('product_id', v_invite.product_id)
  );

  RETURN pg_catalog.jsonb_build_object(
    'product_id', v_invite.product_id,
    'status', 'approved'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. public.get_link_target(text) -> text
--
-- The read-only half of a click: the product slug for an active link, or null.
-- A bot uses this, so a link preview still lands on the product without a click
-- row being written and without a cookie being set.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_link_target(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.slug::text
  FROM public.affiliate_links l
  JOIN public.products p ON p.id = l.product_id
  WHERE l.status = 'active'
    AND (
      l.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')))
      OR pg_catalog.lower(l.alias::text) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')))
    )
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 15. public.record_click(...) -> jsonb
--
-- Resolves the link, checks that the affiliate may still promote the product,
-- and stores the click. Anything unknown answers { "ok": false } with no detail:
-- a broken or withdrawn link must not tell a stranger which of the two it was.
--
-- is_unique is decided here, in the same statement as the insert, against the
-- previous 30 minutes of the same link, ip_hash and ua_hash. Without both hashes
-- the click cannot be de-duplicated, so it is not counted as unique.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_click(
  p_click        uuid,
  p_code         text,
  p_ip_hash      text,
  p_ua_hash      text,
  p_referrer_host text,
  p_country      text,
  p_device       text,
  p_sub1         text,
  p_sub2         text,
  p_sub3         text,
  p_utm_source   text,
  p_utm_medium   text,
  p_utm_campaign text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link     public.affiliate_links;
  v_slug     text;
  v_country  text;
  v_device   text;
  v_referrer text;
  v_unique   boolean := false;
BEGIN
  IF p_click IS NULL THEN
    RAISE EXCEPTION 'invalid_click';
  END IF;

  SELECT * INTO v_link
  FROM public.affiliate_links l
  WHERE l.code = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')))
     OR pg_catalog.lower(l.alias::text) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')));

  IF NOT FOUND OR v_link.status <> 'active' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false);
  END IF;

  IF NOT public.affiliate_can_promote(v_link.affiliate_id, v_link.product_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false);
  END IF;

  SELECT p.slug::text INTO v_slug FROM public.products p WHERE p.id = v_link.product_id;

  IF v_slug IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false);
  END IF;

  v_country := pg_catalog.upper(pg_catalog.btrim(coalesce(p_country, '')));

  IF v_country !~ '^[A-Z]{2}$' THEN
    v_country := NULL;
  END IF;

  v_device := pg_catalog.lower(pg_catalog.btrim(coalesce(p_device, '')));

  IF v_device NOT IN ('mobile', 'desktop', 'tablet', 'other') THEN
    v_device := NULL;
  END IF;

  v_referrer := pg_catalog.lower(pg_catalog.btrim(coalesce(p_referrer_host, '')));

  IF v_referrer = '' OR char_length(v_referrer) > 100 THEN
    v_referrer := NULL;
  END IF;

  IF p_ip_hash IS NOT NULL AND p_ua_hash IS NOT NULL THEN
    v_unique := NOT EXISTS (
      SELECT 1
      FROM public.affiliate_clicks c
      WHERE c.link_id = v_link.id
        AND c.ip_hash = p_ip_hash
        AND c.ua_hash = p_ua_hash
        AND c.created_at > pg_catalog.now() - interval '30 minutes'
    );
  END IF;

  INSERT INTO public.affiliate_clicks (
    id, link_id, affiliate_id, product_id, ip_hash, ua_hash, referrer_host,
    country, device, sub1, sub2, sub3, utm_source, utm_medium, utm_campaign, is_unique
  )
  VALUES (
    p_click, v_link.id, v_link.affiliate_id, v_link.product_id,
    nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_ua_hash, '')), ''),
    v_referrer,
    v_country,
    v_device,
    nullif(pg_catalog.btrim(coalesce(p_sub1, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_sub2, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_sub3, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_utm_source, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_utm_medium, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_utm_campaign, '')), ''),
    v_unique
  );

  -- product_id is included because the cookie keys its entries by product, and
  -- the route must not have to look the product up a second time to find it.
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'product_slug', v_slug,
    'product_id', v_link.product_id
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 16. public.get_click_attribution(uuid, uuid) -> uuid
--
-- The only way an affiliate reaches an order. The click must exist, belong to
-- this product, be inside the attribution window, and the affiliate must still
-- be allowed to promote the product. Anything else is null, and the order is
-- created with no affiliate: a withdrawn referral must never block a sale.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_click_attribution(p_click uuid, p_product uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_click  public.affiliate_clicks;
  v_window int;
BEGIN
  IF p_click IS NULL OR p_product IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_click FROM public.affiliate_clicks c WHERE c.id = p_click;

  IF NOT FOUND OR v_click.product_id <> p_product THEN
    RETURN NULL;
  END IF;

  v_window := public.commerce_setting_int('attribution_window_days', 30);

  IF v_window <= 0 THEN
    v_window := 30;
  END IF;

  IF v_click.created_at < pg_catalog.now() - pg_catalog.make_interval(days => v_window) THEN
    RETURN NULL;
  END IF;

  IF NOT public.affiliate_can_promote(v_click.affiliate_id, v_click.product_id) THEN
    RETURN NULL;
  END IF;

  RETURN v_click.affiliate_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 17. public.create_order(...)
--
-- Replaced from 20261116000200_commerce_core.sql with the identical signature and
-- body. The ONLY change is the affiliate condition: it now asks
-- affiliate_can_promote(), which is where the product's approval mode and any
-- access row are read. The two checks that were there stay: an affiliate is
-- never the buyer and never the vendor.
--
-- Everything else - the price snapshot, the tax lines, the order number, the
-- audit row, the silently dropped attribution - is untouched, so the commerce
-- harness passes unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(
  p_buyer_user uuid,
  p_email      text,
  p_name       text,
  p_product    uuid,
  p_affiliate  uuid,
  p_click      uuid,
  p_ip_hash    text,
  p_reference  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product   public.products;
  v_vendor    public.vendor_profiles;
  v_affiliate uuid;
  v_platform_bps int;
  v_math      jsonb;
  v_order_id  uuid;
  v_item_id   uuid;
  v_number    text;
  v_expiry_hours int;
  v_expires_at timestamptz;
  v_email     extensions.citext;
  v_line      jsonb;
BEGIN
  IF p_reference IS NULL OR pg_catalog.btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;

  IF p_email IS NULL OR char_length(pg_catalog.btrim(p_email)) < 3
     OR pg_catalog.strpos(pg_catalog.btrim(p_email), '@') < 2 THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  v_email := pg_catalog.btrim(p_email)::extensions.citext;

  SELECT * INTO v_product FROM public.products p WHERE p.id = p_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;

  IF v_product.status <> 'live' THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;

  SELECT * INTO v_vendor
  FROM public.vendor_profiles v
  WHERE v.user_id = v_product.vendor_id;

  IF NOT FOUND OR v_vendor.status <> 'active' THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;

  IF p_buyer_user IS NULL THEN
    IF NOT public.commerce_setting_bool('guest_checkout_enabled', true) THEN
      RAISE EXCEPTION 'guest_checkout_disabled';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_buyer_user) THEN
      RAISE EXCEPTION 'buyer_not_found';
    END IF;
  END IF;

  -- Affiliate attribution, silently dropped when any condition fails.
  v_affiliate := NULL;

  IF p_affiliate IS NOT NULL
     AND (p_buyer_user IS NULL OR p_affiliate <> p_buyer_user)
     AND p_affiliate <> v_product.vendor_id
     AND public.affiliate_can_promote(p_affiliate, v_product.id)
  THEN
    v_affiliate := p_affiliate;
  END IF;

  -- The platform fee is its own setting, snapshotted on the item below.
  v_platform_bps := public.commerce_setting_int('platform_fee_bps', 1000);

  v_math := public.commerce_order_math(
    v_product.price_kobo,
    v_product.commission_bps,
    v_platform_bps,
    v_affiliate IS NOT NULL
  );

  v_expiry_hours := public.commerce_setting_int('order_expiry_hours', 24);

  IF v_expiry_hours <= 0 THEN
    v_expiry_hours := 24;
  END IF;

  v_expires_at := pg_catalog.now()
                  + pg_catalog.make_interval(hours => v_expiry_hours);

  v_number := public.next_order_number();

  BEGIN
    INSERT INTO public.orders (
      number, buyer_user_id, buyer_email, buyer_name, status, currency,
      subtotal_kobo, tax_kobo, tax_included, total_kobo, paystack_reference,
      affiliate_id, click_id, ip_hash, expires_at
    )
    VALUES (
      v_number, p_buyer_user, v_email,
      nullif(pg_catalog.btrim(coalesce(p_name, '')), ''),
      'pending', 'NGN',
      v_product.price_kobo,
      (v_math ->> 'buyer_tax_kobo')::bigint,
      (v_math ->> 'tax_included')::boolean,
      v_product.price_kobo + (v_math ->> 'buyer_tax_kobo')::bigint,
      pg_catalog.btrim(p_reference),
      v_affiliate, p_click, nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), ''),
      v_expires_at
    )
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'duplicate_reference';
  END;

  INSERT INTO public.order_items (
    order_id, product_id, vendor_id, affiliate_id, title_snapshot,
    unit_price_kobo, commission_bps, platform_fee_bps, refund_window_hours,
    max_downloads
  )
  VALUES (
    v_order_id, v_product.id, v_product.vendor_id, v_affiliate,
    v_product.title, v_product.price_kobo, v_product.commission_bps,
    v_platform_bps, v_product.refund_window_hours, v_product.max_downloads
  )
  RETURNING id INTO v_item_id;

  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(v_math -> 'lines')
  LOOP
    INSERT INTO public.order_tax_lines (
      order_id, basis, rate_bps, base_kobo, tax_kobo, included, supplier
    )
    VALUES (
      v_order_id,
      v_line ->> 'basis',
      (v_line ->> 'rate_bps')::int,
      (v_line ->> 'base_kobo')::bigint,
      (v_line ->> 'tax_kobo')::bigint,
      (v_line ->> 'included')::boolean,
      v_line ->> 'supplier'
    );
  END LOOP;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after, ip_hash)
  VALUES (
    p_buyer_user, 'order.created', 'order', v_order_id::text,
    pg_catalog.jsonb_build_object(
      'number', v_number,
      'product_id', v_product.id,
      'total_kobo', v_product.price_kobo + (v_math ->> 'buyer_tax_kobo')::bigint,
      'affiliate_applied', v_affiliate IS NOT NULL
    ),
    nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), '')
  );

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id,
    'number', v_number,
    'total_kobo', v_product.price_kobo + (v_math ->> 'buyer_tax_kobo')::bigint,
    'currency', 'NGN',
    'reference', pg_catalog.btrim(p_reference),
    'expires_at', v_expires_at,
    'affiliate_applied', v_affiliate IS NOT NULL
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 18. public.rollup_affiliate_stats(date, date) -> int
--
-- Rebuilds the daily statistics for a range of Lagos days from the clicks and
-- the paid orders. The counters for the range are zeroed first and then set from
-- the recomputed rows, so running it twice gives the same numbers as running it
-- once, and a corrected or deleted click is reflected on the next run.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollup_affiliate_stats(p_from date, p_to date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_written int;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  UPDATE public.affiliate_daily_stats s
     SET clicks = 0,
         unique_clicks = 0,
         orders = 0,
         order_revenue_kobo = 0,
         commission_kobo = 0
   WHERE s.day BETWEEN p_from AND p_to;

  WITH click_rows AS (
    SELECT (c.created_at AT TIME ZONE 'Africa/Lagos')::date AS day,
           c.affiliate_id,
           c.product_id,
           c.link_id,
           count(*)::int AS clicks,
           count(*) FILTER (WHERE c.is_unique)::int AS unique_clicks
    FROM public.affiliate_clicks c
    WHERE (c.created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2, 3, 4
  ),
  order_rows AS (
    SELECT (o.paid_at AT TIME ZONE 'Africa/Lagos')::date AS day,
           i.affiliate_id,
           i.product_id,
           k.link_id,
           count(*)::int AS orders,
           sum(i.unit_price_kobo)::bigint AS revenue_kobo,
           sum(coalesce(i.affiliate_commission_kobo, 0))::bigint AS commission_kobo
    FROM public.order_items i
    JOIN public.orders o ON o.id = i.order_id
    LEFT JOIN public.affiliate_clicks k ON k.id = o.click_id
    WHERE o.status = 'paid'
      AND o.paid_at IS NOT NULL
      AND i.affiliate_id IS NOT NULL
      AND (o.paid_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2, 3, 4
  ),
  merged AS (
    SELECT
      coalesce(c.day, r.day) AS day,
      coalesce(c.affiliate_id, r.affiliate_id) AS affiliate_id,
      coalesce(c.product_id, r.product_id) AS product_id,
      coalesce(c.link_id, r.link_id) AS link_id,
      coalesce(c.clicks, 0) AS clicks,
      coalesce(c.unique_clicks, 0) AS unique_clicks,
      coalesce(r.orders, 0) AS orders,
      coalesce(r.revenue_kobo, 0) AS revenue_kobo,
      coalesce(r.commission_kobo, 0) AS commission_kobo
    FROM click_rows c
    FULL OUTER JOIN order_rows r
      ON r.day = c.day
     AND r.affiliate_id = c.affiliate_id
     AND r.product_id = c.product_id
     AND r.link_id IS NOT DISTINCT FROM c.link_id
  )
  INSERT INTO public.affiliate_daily_stats (
    day, affiliate_id, product_id, link_id,
    clicks, unique_clicks, orders, order_revenue_kobo, commission_kobo
  )
  SELECT day, affiliate_id, product_id, link_id,
         clicks, unique_clicks, orders, revenue_kobo, commission_kobo
  FROM merged
  ON CONFLICT (
    day, affiliate_id, product_id,
    coalesce(link_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  DO UPDATE SET
    clicks = EXCLUDED.clicks,
    unique_clicks = EXCLUDED.unique_clicks,
    orders = EXCLUDED.orders,
    order_revenue_kobo = EXCLUDED.order_revenue_kobo,
    commission_kobo = EXCLUDED.commission_kobo;

  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN v_written;
END;
$$;

-- ----------------------------------------------------------------------------
-- 19. public.scan_click_anomalies() -> int
--
-- Two shapes worth a human look:
--   click_burst            one link, one ip_hash, more than 200 clicks in an hour
--   clicks_without_sales   more than 500 unique clicks in 24 hours, no paid order
--
-- A flag is written at most once per affiliate, kind and Lagos day, so an
-- hourly run does not pile up duplicates of the same finding.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_click_anomalies()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   date := (pg_catalog.now() AT TIME ZONE 'Africa/Lagos')::date;
  v_created int := 0;
  v_row     record;
BEGIN
  FOR v_row IN
    SELECT c.affiliate_id, c.link_id, count(*)::int AS hits
    FROM public.affiliate_clicks c
    WHERE c.created_at > pg_catalog.now() - interval '1 hour'
      AND c.ip_hash IS NOT NULL
    GROUP BY c.affiliate_id, c.link_id, c.ip_hash,
             pg_catalog.date_trunc('hour', c.created_at)
    HAVING count(*) > 200
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.risk_flags f
      WHERE f.affiliate_id = v_row.affiliate_id
        AND f.kind = 'click_burst'
        AND (f.created_at AT TIME ZONE 'Africa/Lagos')::date = v_today
    ) THEN
      INSERT INTO public.risk_flags (affiliate_id, kind, details)
      VALUES (
        v_row.affiliate_id,
        'click_burst',
        pg_catalog.jsonb_build_object('link_id', v_row.link_id, 'clicks', v_row.hits)
      );

      v_created := v_created + 1;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT c.affiliate_id, count(*) FILTER (WHERE c.is_unique)::int AS unique_clicks
    FROM public.affiliate_clicks c
    WHERE c.created_at > pg_catalog.now() - interval '24 hours'
    GROUP BY c.affiliate_id
    HAVING count(*) FILTER (WHERE c.is_unique) > 500
       AND NOT EXISTS (
         SELECT 1
         FROM public.orders o
         WHERE o.affiliate_id = c.affiliate_id
           AND o.status = 'paid'
           AND o.paid_at > pg_catalog.now() - interval '24 hours'
       )
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.risk_flags f
      WHERE f.affiliate_id = v_row.affiliate_id
        AND f.kind = 'clicks_without_sales'
        AND (f.created_at AT TIME ZONE 'Africa/Lagos')::date = v_today
    ) THEN
      INSERT INTO public.risk_flags (affiliate_id, kind, details)
      VALUES (
        v_row.affiliate_id,
        'clicks_without_sales',
        pg_catalog.jsonb_build_object('unique_clicks', v_row.unique_clicks)
      );

      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

-- ----------------------------------------------------------------------------
-- 20. public.purge_old_clicks(int) -> int
--
-- Clicks are kept for 13 months, which is long enough for a year-on-year
-- comparison and short enough that a click table stays a working set. The window
-- is clamped, so a caller cannot delete a year of history by passing 0.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_clicks(p_months int DEFAULT 13)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_months int := coalesce(p_months, 13);
  v_deleted int;
BEGIN
  IF v_months < 1 THEN
    v_months := 1;
  END IF;

  IF v_months > 120 THEN
    v_months := 120;
  END IF;

  DELETE FROM public.affiliate_clicks c
   WHERE c.created_at < pg_catalog.now() - pg_catalog.make_interval(months => v_months);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

-- ----------------------------------------------------------------------------
-- 21. Row level security
--
-- Every table is closed to the browser roles first, then opened only for the
-- reads listed below. There is no client write anywhere: links, clicks, access
-- rows, invites, statistics and flags are all written by the functions above,
-- which only the service role may call.
--
-- affiliate_clicks has no policy and no grant at all: it is not readable by a
-- signed-in person, not even by the affiliate it belongs to, because a row of
-- click hashes is exactly the data a person should not be able to browse.
-- ----------------------------------------------------------------------------
ALTER TABLE public.affiliate_product_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_invites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_clicks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_daily_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_flags               ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_product_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_invites        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_links          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_clicks         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_daily_stats    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.risk_flags               FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.affiliate_product_access TO authenticated;
GRANT SELECT ON TABLE public.affiliate_invites        TO authenticated;
GRANT SELECT ON TABLE public.affiliate_links          TO authenticated;
GRANT SELECT ON TABLE public.affiliate_daily_stats    TO authenticated;
GRANT SELECT ON TABLE public.risk_flags               TO authenticated;

-- Links: the affiliate sees their own; admin and moderator see all.
DROP POLICY IF EXISTS affiliate_links_select_own ON public.affiliate_links;
CREATE POLICY affiliate_links_select_own
  ON public.affiliate_links
  FOR SELECT
  TO authenticated
  USING (affiliate_id = (select auth.uid()));

DROP POLICY IF EXISTS affiliate_links_select_staff ON public.affiliate_links;
CREATE POLICY affiliate_links_select_staff
  ON public.affiliate_links
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'moderator')
  );

-- Access rows: the affiliate sees their own, the product's vendor sees the ones
-- for their products, admin and moderator see all.
DROP POLICY IF EXISTS affiliate_product_access_select_own ON public.affiliate_product_access;
CREATE POLICY affiliate_product_access_select_own
  ON public.affiliate_product_access
  FOR SELECT
  TO authenticated
  USING (affiliate_id = (select auth.uid()));

DROP POLICY IF EXISTS affiliate_product_access_select_vendor ON public.affiliate_product_access;
CREATE POLICY affiliate_product_access_select_vendor
  ON public.affiliate_product_access
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = affiliate_product_access.product_id
        AND p.vendor_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS affiliate_product_access_select_staff ON public.affiliate_product_access;
CREATE POLICY affiliate_product_access_select_staff
  ON public.affiliate_product_access
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'moderator')
  );

-- Invites: the product's vendor sees them; admin and moderator see all. The
-- token hash is readable by the vendor, which is useless without the token.
DROP POLICY IF EXISTS affiliate_invites_select_vendor ON public.affiliate_invites;
CREATE POLICY affiliate_invites_select_vendor
  ON public.affiliate_invites
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = affiliate_invites.product_id
        AND p.vendor_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS affiliate_invites_select_staff ON public.affiliate_invites;
CREATE POLICY affiliate_invites_select_staff
  ON public.affiliate_invites
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'moderator')
  );

-- Daily statistics: the affiliate sees their own; admin and moderator see all.
DROP POLICY IF EXISTS affiliate_daily_stats_select_own ON public.affiliate_daily_stats;
CREATE POLICY affiliate_daily_stats_select_own
  ON public.affiliate_daily_stats
  FOR SELECT
  TO authenticated
  USING (affiliate_id = (select auth.uid()));

DROP POLICY IF EXISTS affiliate_daily_stats_select_staff ON public.affiliate_daily_stats;
CREATE POLICY affiliate_daily_stats_select_staff
  ON public.affiliate_daily_stats
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'moderator')
  );

-- Risk flags: admin and moderator only. Support and finance deliberately cannot
-- read them.
DROP POLICY IF EXISTS risk_flags_select_staff ON public.risk_flags;
CREATE POLICY risk_flags_select_staff
  ON public.risk_flags
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'moderator')
  );

-- ----------------------------------------------------------------------------
-- 22. Function privileges
--
-- Nothing here is callable by a browser role. The server calls these with the
-- service role key, and every one of them re-checks the actor it was given.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.affiliate_can_promote(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_affiliate_link(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_affiliate_link(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_product_access(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_product_access(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_affiliate_invite(uuid, uuid, text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_affiliate_invite(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_link_target(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_click(uuid, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_click_attribution(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_order(uuid, text, text, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollup_affiliate_stats(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_click_anomalies() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_clicks(int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.affiliate_can_promote(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_affiliate_link(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_affiliate_link(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_product_access(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_product_access(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_affiliate_invite(uuid, uuid, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_affiliate_invite(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_link_target(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_click(uuid, text, text, text, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_click_attribution(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, text, uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollup_affiliate_stats(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_click_anomalies() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_clicks(int) TO service_role;

-- ----------------------------------------------------------------------------
-- 23. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261118000200', 'affiliate_tracking')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Links, clicks, access rows, invites and flags are
-- real records of what happened, so they go with the tables: keeping a click log
-- with nothing to attribute it to is not a kindness. The daily statistics are
-- derived data and are rebuilt by rollup_affiliate_stats() if the migration is
-- applied again.
--
-- create_order is NOT dropped here: the previous definition lives in
-- 20261116000200_commerce_core.sql, so re-running that file restores it. Dropping
-- it would leave checkout with no function at all.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.purge_old_clicks(int);
-- DROP FUNCTION IF EXISTS public.scan_click_anomalies();
-- DROP FUNCTION IF EXISTS public.rollup_affiliate_stats(date, date);
-- DROP FUNCTION IF EXISTS public.get_click_attribution(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.record_click(uuid, text, text, text, text, text, text, text, text, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.get_link_target(text);
-- DROP FUNCTION IF EXISTS public.accept_affiliate_invite(uuid, text);
-- DROP FUNCTION IF EXISTS public.create_affiliate_invite(uuid, uuid, text, int, int);
-- DROP FUNCTION IF EXISTS public.decide_product_access(uuid, uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.request_product_access(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.archive_affiliate_link(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.create_affiliate_link(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.affiliate_can_promote(uuid, uuid);
--
-- DROP TABLE IF EXISTS public.risk_flags;
-- DROP TABLE IF EXISTS public.affiliate_daily_stats;
-- DROP TABLE IF EXISTS public.affiliate_clicks;
-- DROP TABLE IF EXISTS public.affiliate_links;
-- DROP TABLE IF EXISTS public.affiliate_invites;
-- DROP TABLE IF EXISTS public.affiliate_product_access;
--
-- DELETE FROM public.app_migrations WHERE version = '20261118000200';
--
-- COMMIT;
-- ============================================================================
