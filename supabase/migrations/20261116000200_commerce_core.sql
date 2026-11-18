-- ============================================================================
-- Migration 20261116000200_commerce_core
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: orders, entitlements, the double-entry ledger, refunds, disputes, VAT
--        periods and payout rules. Database and documentation only: no page, no
--        component, no route and no application code is created or changed.
-- Depends on: 20261112000100_foundation (settings, audit_log, profiles,
--        user_roles, has_role, is_staff, set_updated_at),
--        20261112000200_job_queue (enqueue_job),
--        20261113000100_roles_onboarding (vendor_profiles, affiliate_profiles),
--        20261114000100_catalog (products, product_files, product_status),
--        20261115000100_malware_scanning (product_files.scan_status).
-- This file is idempotent: running it twice must not raise an error.
--
-- All money is an integer number of kobo (bigint). Nothing here is numeric or
-- floating point: rates are integers in basis points and the only division is
-- done in numeric and floored straight back to bigint.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Settings seeds
-- Every value is inserted with ON CONFLICT DO NOTHING, so an owner decision
-- that is already stored is never overwritten by re-running this file.
-- ----------------------------------------------------------------------------
INSERT INTO public.settings (key, value, description) VALUES
  ('withdrawal_fee_bps',      '200'::jsonb,        'Withdrawal fee in basis points (2%).'),
  ('withdrawal_fee_min_kobo', '5000'::jsonb,       'Smallest withdrawal fee, in kobo (50 NGN).'),
  ('withdrawal_fee_cap_kobo', '200000'::jsonb,     'Largest withdrawal fee, in kobo (2,000 NGN).'),
  ('processor_fee_bearer',    '"platform"'::jsonb, 'Who absorbs the processor fee (placeholder: platform).'),
  ('auto_payout_default',     'true'::jsonb,       'Whether a new payout schedule starts on by default.'),
  ('payout_weekdays',         '[1,2,3,4,5]'::jsonb,'ISO weekdays a payout run may happen (Monday is 1).'),
  ('payout_run_hour_lagos',   '10'::jsonb,         'Hour of the day (Africa/Lagos) the payout run starts.'),
  ('order_expiry_hours',      '24'::jsonb,         'Hours before an unpaid order expires.'),
  ('guest_checkout_enabled',  'true'::jsonb,       'Whether an order may be created without a signed-in buyer.')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. public.order_status
-- Enums cannot use IF NOT EXISTS, so the type is created inside a DO block.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'order_status'
  ) THEN
    CREATE TYPE public.order_status AS ENUM
      ('pending', 'paid', 'expired', 'failed', 'refunded', 'disputed');
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. public.order_number_seq
-- One global sequence behind the AFV-<year>-<six digits> order number. The
-- sequence is never reset: a number is never reused, even after a rollback of
-- the order itself.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq AS bigint START WITH 1;

-- ----------------------------------------------------------------------------
-- 4. Settings readers
-- Small helpers so every function reads the same value the same way. Each one
-- falls back to the seeded default when the row is missing or holds the wrong
-- shape, so a bad settings row never breaks checkout.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commerce_setting(p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.value FROM public.settings s WHERE s.key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.commerce_setting_int(p_key text, p_fallback int)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN (s.value #>> '{}') ~ '^-?[0-9]{1,9}$' THEN (s.value #>> '{}')::int
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = p_key
    ),
    p_fallback
  );
$$;

CREATE OR REPLACE FUNCTION public.commerce_setting_bigint(p_key text, p_fallback bigint)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN (s.value #>> '{}') ~ '^-?[0-9]{1,18}$' THEN (s.value #>> '{}')::bigint
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = p_key
    ),
    p_fallback
  );
$$;

CREATE OR REPLACE FUNCTION public.commerce_setting_bool(p_key text, p_fallback boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN s.value = 'true'::jsonb  THEN true
               WHEN s.value = 'false'::jsonb THEN false
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = p_key
    ),
    p_fallback
  );
$$;

CREATE OR REPLACE FUNCTION public.commerce_setting_text(p_key text, p_fallback text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN pg_catalog.jsonb_typeof(s.value) = 'string' THEN s.value #>> '{}'
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = p_key
    ),
    p_fallback
  );
$$;

-- ----------------------------------------------------------------------------
-- 5. Tables
-- ----------------------------------------------------------------------------

-- 5.1 public.orders
--
-- tax_included records whether tax_kobo sits inside subtotal_kobo. The two
-- CHECKs below are the part of the total arithmetic that the database *can*
-- enforce; the rest (subtotal + tax when the tax is added on top) is computed in
-- create_order and proven by the tests.
CREATE TABLE IF NOT EXISTS public.orders (
  id                     uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 text               NOT NULL UNIQUE,
  buyer_user_id          uuid               REFERENCES public.profiles (id) ON DELETE SET NULL,
  buyer_email            extensions.citext  NOT NULL,
  buyer_name             text,
  status                 public.order_status NOT NULL DEFAULT 'pending',
  currency               text               NOT NULL DEFAULT 'NGN'
                                            CHECK (currency = 'NGN'),
  subtotal_kobo          bigint             NOT NULL CHECK (subtotal_kobo >= 0),
  tax_kobo               bigint             NOT NULL DEFAULT 0 CHECK (tax_kobo >= 0),
  tax_included           boolean            NOT NULL DEFAULT false,
  total_kobo             bigint             NOT NULL CHECK (total_kobo >= 0),
  paystack_reference     text               NOT NULL UNIQUE,
  paystack_access_code   text,
  paystack_transaction_id bigint,
  processor_fee_kobo     bigint             CHECK (processor_fee_kobo IS NULL OR processor_fee_kobo >= 0),
  channel                text,
  affiliate_id           uuid               REFERENCES public.profiles (id) ON DELETE SET NULL,
  click_id               uuid,
  ip_hash                text,
  expires_at             timestamptz        NOT NULL,
  paid_at                timestamptz,
  created_at             timestamptz        NOT NULL DEFAULT now(),
  updated_at             timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_at_least_subtotal
    CHECK (total_kobo >= subtotal_kobo),
  CONSTRAINT orders_total_with_exclusive_tax
    CHECK (tax_included OR total_kobo = subtotal_kobo + tax_kobo),
  CONSTRAINT orders_total_with_inclusive_tax
    CHECK ((NOT tax_included) OR total_kobo = subtotal_kobo),
  CONSTRAINT orders_paid_at_required
    CHECK (
      status NOT IN ('paid', 'refunded', 'disputed')
      OR paid_at IS NOT NULL
    )
);

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS orders_buyer_created_idx
  ON public.orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_expires_idx
  ON public.orders (status, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS orders_affiliate_idx
  ON public.orders (affiliate_id)
  WHERE affiliate_id IS NOT NULL;

-- 5.2 public.order_items
--
-- Every commercial term is snapshotted at order creation, because the vendor may
-- edit the product (or the owner may change the platform fee) while the buyer is
-- still on the payment page. One item per order at launch; the schema allows
-- several.
--
-- The three amount columns stay NULL until payment. Once all three are set the
-- split must add up to the unit price, with the tax that was carved out of the
-- vendor's share counted in.
CREATE TABLE IF NOT EXISTS public.order_items (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  uuid        NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  product_id                uuid        NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  vendor_id                 uuid        NOT NULL REFERENCES public.vendor_profiles (user_id) ON DELETE RESTRICT,
  affiliate_id              uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  title_snapshot            text        NOT NULL CHECK (char_length(title_snapshot) BETWEEN 1 AND 200),
  unit_price_kobo           bigint      NOT NULL CHECK (unit_price_kobo > 0),
  commission_bps            int         NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  platform_fee_bps          int         NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  refund_window_hours       int         NOT NULL CHECK (refund_window_hours > 0),
  max_downloads             int         NOT NULL CHECK (max_downloads > 0),
  platform_fee_kobo         bigint      CHECK (platform_fee_kobo IS NULL OR platform_fee_kobo >= 0),
  affiliate_commission_kobo bigint      CHECK (affiliate_commission_kobo IS NULL OR affiliate_commission_kobo >= 0),
  vendor_net_kobo           bigint      CHECK (vendor_net_kobo IS NULL OR vendor_net_kobo >= 0),
  tax_deducted_kobo         bigint      NOT NULL DEFAULT 0 CHECK (tax_deducted_kobo >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_split_balances
    CHECK (
      platform_fee_kobo IS NULL
      OR affiliate_commission_kobo IS NULL
      OR vendor_net_kobo IS NULL
      OR platform_fee_kobo + affiliate_commission_kobo + vendor_net_kobo + tax_deducted_kobo
         = unit_price_kobo
    )
);

CREATE INDEX IF NOT EXISTS order_items_order_idx
  ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_vendor_idx
  ON public.order_items (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_affiliate_idx
  ON public.order_items (affiliate_id)
  WHERE affiliate_id IS NOT NULL;

-- 5.3 public.order_tax_lines
--
-- One row per VAT calculation. `included` is true when the tax was already
-- inside the amount the buyer paid (either carved out of the product price or
-- out of the platform fee); false when it was added on top of the price.
CREATE TABLE IF NOT EXISTS public.order_tax_lines (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid    NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  basis      text    NOT NULL CHECK (basis IN ('platform_fee', 'product_price')),
  rate_bps   int     NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  base_kobo  bigint  NOT NULL CHECK (base_kobo >= 0),
  tax_kobo   bigint  NOT NULL CHECK (tax_kobo >= 0),
  included   boolean NOT NULL,
  supplier   text    NOT NULL CHECK (supplier IN ('affilova', 'vendor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_tax_lines_order_idx
  ON public.order_tax_lines (order_id);

-- 5.4 public.entitlements
--
-- One row per file the buyer may download. The download limit is snapshotted
-- from the product, so a later edit to the product does not change what was
-- already sold. The storage key is deliberately NOT here: the file row holds it
-- and only claim_download returns it.
CREATE TABLE IF NOT EXISTS public.entitlements (
  id             uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  uuid              NOT NULL REFERENCES public.order_items (id) ON DELETE CASCADE,
  product_id     uuid              NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  file_id        uuid              NOT NULL REFERENCES public.product_files (id) ON DELETE CASCADE,
  buyer_user_id  uuid              REFERENCES public.profiles (id) ON DELETE SET NULL,
  buyer_email    extensions.citext NOT NULL,
  downloads_used int               NOT NULL DEFAULT 0 CHECK (downloads_used >= 0),
  max_downloads  int               NOT NULL CHECK (max_downloads > 0),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_one_per_file UNIQUE (order_item_id, file_id)
);

CREATE INDEX IF NOT EXISTS entitlements_order_item_idx
  ON public.entitlements (order_item_id);
CREATE INDEX IF NOT EXISTS entitlements_buyer_idx
  ON public.entitlements (buyer_user_id, created_at DESC);

-- 5.5 public.download_log
-- Append-only by convention: nothing in this migration updates or deletes it.
CREATE TABLE IF NOT EXISTS public.download_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entitlement_id uuid        NOT NULL REFERENCES public.entitlements (id) ON DELETE CASCADE,
  ip_hash        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS download_log_entitlement_idx
  ON public.download_log (entitlement_id, created_at DESC);

-- 5.6 public.ledger_accounts
-- The chart of accounts. Fixed ids so a posting reads clearly in a review.
--   asset      what the platform holds
--   liability  what the platform owes someone else
--   revenue    what the platform earned
--   expense    what the platform paid away
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id   smallint PRIMARY KEY,
  code text     NOT NULL UNIQUE,
  name text     NOT NULL,
  kind text     NOT NULL CHECK (kind IN ('asset', 'liability', 'revenue', 'expense'))
);

INSERT INTO public.ledger_accounts (id, code, name, kind) VALUES
  (1, 'paystack_balance',       'Paystack balance',        'asset'),
  (2, 'processor_fees',         'Processor fees',          'expense'),
  (3, 'vendor_payable',         'Vendor payable',          'liability'),
  (4, 'affiliate_payable',      'Affiliate payable',       'liability'),
  (5, 'platform_revenue',       'Platform revenue',        'revenue'),
  (6, 'withdrawal_fee_revenue', 'Withdrawal fee revenue',  'revenue'),
  (7, 'vat_payable',            'VAT payable',             'liability'),
  (8, 'payouts_in_transit',     'Payouts in transit',      'liability')
ON CONFLICT (id) DO NOTHING;

-- 5.7 public.ledger_transactions and public.ledger_entries
--
-- Double entry: every transaction has entries whose debits equal their credits,
-- checked at COMMIT by a deferred constraint trigger so a multi-row posting can
-- be written in any order. Both tables are append-only.
--
-- party_id says who a payable belongs to (a vendor or an affiliate). It is only
-- meaningful on the two payable accounts.
--
-- available_at is only meaningful on credits to vendor_payable and
-- affiliate_payable: it is when the held commission becomes withdrawable.
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL,
  ref_type        text,
  ref_id          uuid,
  description     text,
  idempotency_key text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id       uuid        NOT NULL REFERENCES public.ledger_transactions (id) ON DELETE RESTRICT,
  account_id   smallint    NOT NULL REFERENCES public.ledger_accounts (id) ON DELETE RESTRICT,
  party_id     uuid,
  debit_kobo   bigint      NOT NULL DEFAULT 0 CHECK (debit_kobo >= 0),
  credit_kobo  bigint      NOT NULL DEFAULT 0 CHECK (credit_kobo >= 0),
  available_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_single_side
    CHECK ((debit_kobo > 0) <> (credit_kobo > 0))
);

CREATE INDEX IF NOT EXISTS ledger_entries_txn_idx
  ON public.ledger_entries (txn_id);
CREATE INDEX IF NOT EXISTS ledger_entries_party_idx
  ON public.ledger_entries (party_id, account_id)
  WHERE party_id IS NOT NULL;

-- 5.8 public.refund_requests
-- The state and the audit trail only. The Paystack API call is a later task.
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid        NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  requested_by       uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  reason             text        NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  status             text        NOT NULL DEFAULT 'requested'
                                 CHECK (status IN ('requested', 'approved', 'rejected', 'processed', 'failed')),
  auto_approved      boolean     NOT NULL DEFAULT false,
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  provider_reference text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- At most one open request per order.
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_open_idx
  ON public.refund_requests (order_id)
  WHERE status IN ('requested', 'approved');

CREATE INDEX IF NOT EXISTS refund_requests_order_idx
  ON public.refund_requests (order_id, created_at DESC);

-- 5.9 public.order_disputes
CREATE TABLE IF NOT EXISTS public.order_disputes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  note        text,
  outcome     text        NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS order_disputes_order_idx
  ON public.order_disputes (order_id, opened_at DESC);

-- 5.10 public.payout_blackout_dates
CREATE TABLE IF NOT EXISTS public.payout_blackout_dates (
  day        date        PRIMARY KEY,
  reason     text        NOT NULL CHECK (char_length(reason) >= 5),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5.11 public.vat_periods and public.vat_adjustments
CREATE TABLE IF NOT EXISTS public.vat_periods (
  period                date        PRIMARY KEY
                                    CHECK (extract(day FROM period) = 1),
  status                text        NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open', 'filed', 'remitted')),
  filed_at              timestamptz,
  remitted_at           timestamptz,
  remitted_amount_kobo  bigint      CHECK (remitted_amount_kobo IS NULL OR remitted_amount_kobo >= 0),
  payment_reference     text,
  receipt_key           text,
  note                  text,
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vat_adjustments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period      date        NOT NULL REFERENCES public.vat_periods (period) ON DELETE CASCADE,
  amount_kobo bigint      NOT NULL CHECK (amount_kobo <> 0),
  reason      text        NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vat_adjustments_period_idx
  ON public.vat_adjustments (period);

-- ----------------------------------------------------------------------------
-- 6. Ledger integrity
-- ----------------------------------------------------------------------------

-- 6.1 Append-only guard
-- A row trigger for UPDATE and DELETE, a statement trigger for TRUNCATE. The
-- same shape as the audit_log guard in the foundation, extended to TRUNCATE on
-- the table itself.
CREATE OR REPLACE FUNCTION public.ledger_entries_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries_append_only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_no_update_or_delete ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_update_or_delete
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_entries_block_mutation();

DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON public.ledger_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ledger_entries_block_mutation();

-- 6.2 Balanced transaction guard
-- Deferred to COMMIT so a posting can be written one entry at a time. A
-- transaction that never gets a second entry is caught here, not later.
CREATE OR REPLACE FUNCTION public.ledger_check_balanced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_debit  bigint;
  v_credit bigint;
BEGIN
  SELECT coalesce(pg_catalog.sum(e.debit_kobo), 0),
         coalesce(pg_catalog.sum(e.credit_kobo), 0)
    INTO v_debit, v_credit
    FROM public.ledger_entries e
   WHERE e.txn_id = NEW.txn_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'unbalanced_transaction'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT OR UPDATE ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_check_balanced();

-- ----------------------------------------------------------------------------
-- 7. Pure functions
-- ----------------------------------------------------------------------------

-- 7.1 public.commerce_round_half_up(bigint, int)
-- Integer arithmetic only: the rate is basis points, the result is kobo.
-- IMMUTABLE because it reads nothing.
CREATE OR REPLACE FUNCTION public.commerce_round_half_up(p_value_kobo bigint, p_rate_bps int)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.floor(
           (p_value_kobo::numeric * p_rate_bps::numeric) / 10000::numeric + 0.5
         )::bigint;
$$;

-- 7.2 public.compute_split(bigint, int, int, boolean)
-- platform_fee = floor(price * platform_fee_bps / 10000)
-- affiliate    = 0 without an affiliate, else floor(price * commission_bps / 10000)
-- vendor_net   = price - platform_fee - affiliate   (the vendor absorbs rounding)
-- The three parts always sum to the price, which is what the property test
-- proves over 2,000 random inputs.
CREATE OR REPLACE FUNCTION public.compute_split(
  p_price_kobo        bigint,
  p_commission_bps    int,
  p_platform_fee_bps  int,
  p_has_affiliate     boolean
)
RETURNS TABLE (
  platform_fee_kobo         bigint,
  affiliate_commission_kobo bigint,
  vendor_net_kobo           bigint
)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_platform  bigint;
  v_affiliate bigint;
  v_vendor    bigint;
BEGIN
  IF p_price_kobo IS NULL OR p_price_kobo < 0 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  IF p_commission_bps IS NULL OR p_commission_bps < 0 OR p_commission_bps > 10000 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  IF p_platform_fee_bps IS NULL OR p_platform_fee_bps < 0 OR p_platform_fee_bps > 10000 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  v_platform := pg_catalog.floor(
    (p_price_kobo::numeric * p_platform_fee_bps::numeric) / 10000::numeric
  )::bigint;

  IF coalesce(p_has_affiliate, false) THEN
    v_affiliate := pg_catalog.floor(
      (p_price_kobo::numeric * p_commission_bps::numeric) / 10000::numeric
    )::bigint;
  ELSE
    v_affiliate := 0;
  END IF;

  v_vendor := p_price_kobo - v_platform - v_affiliate;

  IF v_platform < 0 OR v_affiliate < 0 OR v_vendor < 0 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  platform_fee_kobo         := v_platform;
  affiliate_commission_kobo := v_affiliate;
  vendor_net_kobo           := v_vendor;

  RETURN NEXT;
END;
$$;

-- 7.3 public.compute_withdrawal_fee(bigint)
-- LEAST(cap, GREATEST(min, floor(amount * bps / 10000))), read from settings.
-- An amount below min_withdrawal_kobo is refused before any fee is computed.
CREATE OR REPLACE FUNCTION public.compute_withdrawal_fee(p_amount_kobo bigint)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bps  bigint;
  v_min  bigint;
  v_cap  bigint;
  v_floor_amount bigint;
  v_fee  bigint;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  v_floor_amount := public.commerce_setting_bigint('min_withdrawal_kobo', 500000);

  IF p_amount_kobo < v_floor_amount THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  v_bps := public.commerce_setting_bigint('withdrawal_fee_bps', 200);
  v_min := public.commerce_setting_bigint('withdrawal_fee_min_kobo', 5000);
  v_cap := public.commerce_setting_bigint('withdrawal_fee_cap_kobo', 200000);

  v_fee := pg_catalog.floor(
    (p_amount_kobo::numeric * v_bps::numeric) / 10000::numeric
  )::bigint;

  v_fee := greatest(v_min, v_fee);
  v_fee := least(v_cap, v_fee);

  RETURN v_fee;
END;
$$;

-- 7.4 public.is_payout_day(timestamptz)
-- The Africa/Lagos weekday of the instant must be in payout_weekdays (ISO:
-- Monday is 1) and the Africa/Lagos date must not be a blackout date.
CREATE OR REPLACE FUNCTION public.is_payout_day(p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_local    timestamp;
  v_dow      int;
  v_weekdays jsonb;
BEGIN
  IF p_at IS NULL THEN
    RETURN false;
  END IF;

  v_local := p_at AT TIME ZONE 'Africa/Lagos';
  v_dow   := extract(isodow FROM v_local)::int;
  v_weekdays := coalesce(
    public.commerce_setting('payout_weekdays'),
    '[1,2,3,4,5]'::jsonb
  );

  IF pg_catalog.jsonb_typeof(v_weekdays) <> 'array' THEN
    v_weekdays := '[1,2,3,4,5]'::jsonb;
  END IF;

  IF NOT (v_weekdays @> pg_catalog.to_jsonb(v_dow)) THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.payout_blackout_dates b
    WHERE b.day = v_local::date
  );
END;
$$;

-- 7.5 public.next_order_number()
-- AFV-<Lagos year>-<six digits from the global sequence>.
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year text;
  v_seq  bigint;
BEGIN
  v_year := pg_catalog.to_char(
    (pg_catalog.now() AT TIME ZONE 'Africa/Lagos'), 'YYYY'
  );

  v_seq := pg_catalog.nextval('public.order_number_seq');

  RETURN 'AFV-' || v_year || '-' || pg_catalog.lpad(v_seq::text, 6, '0');
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Order functions
-- ----------------------------------------------------------------------------

-- 8.1 public.commerce_order_math(bigint, int, int, boolean)
-- The one place the split and the VAT rules are combined, shared by
-- create_order (which stores the tax lines) and process_paid_order (which stores
-- the item amounts). Returns:
--   base_kobo                  the amount the split is computed on
--   platform_fee_kobo          the platform's share
--   affiliate_commission_kobo  the affiliate's share (0 without one)
--   vendor_net_kobo            the vendor's share after the platform fee, the
--                              affiliate commission and any VAT carved out of it
--   tax_deducted_kobo          VAT carved out of the item price (vendor's share)
--   buyer_tax_kobo             VAT added on top of the price
--   tax_included               true when the buyer pays exactly the price
--   lines                      the tax lines to store
--
-- VAT rules (all switched off while vat_enabled is false):
--   basis platform_fee  tax = round_half_up(platform_fee * rate / 10000), carved
--                       out of the vendor's share, supplier 'affilova'
--   basis product_price, prices_include_vat true
--                       tax = price - floor(price * 10000 / (10000 + rate)),
--                       the split runs on price - tax, supplier 'vendor',
--                       the buyer pays the listed price
--   basis product_price, prices_include_vat false
--                       tax = floor(price * rate / 10000), the split runs on the
--                       price, supplier 'vendor', the buyer pays price + tax
--   basis both          both of the above, each on its own basis
CREATE OR REPLACE FUNCTION public.commerce_order_math(
  p_price_kobo       bigint,
  p_commission_bps   int,
  p_platform_fee_bps int,
  p_has_affiliate    boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vat_enabled boolean;
  v_rate        int;
  v_applies     text;
  v_inclusive   boolean;
  v_base        bigint;
  v_incl_tax    bigint := 0;
  v_excl_tax    bigint := 0;
  v_pf_tax      bigint := 0;
  v_split       record;
  v_vendor      bigint;
  v_lines       jsonb := '[]'::jsonb;
BEGIN
  v_vat_enabled := public.commerce_setting_bool('vat_enabled', false);
  v_rate        := public.commerce_setting_int('vat_rate_bps', 750);
  v_applies     := public.commerce_setting_text('vat_applies_to', 'platform_fee');
  v_inclusive   := public.commerce_setting_bool('prices_include_vat', false);

  IF v_rate < 0 OR v_rate > 10000 THEN
    RAISE EXCEPTION 'invalid_vat_rate';
  END IF;

  v_base := p_price_kobo;

  -- Product price VAT first: it decides the base the split runs on.
  IF v_vat_enabled AND v_applies IN ('product_price', 'both') THEN
    IF v_inclusive THEN
      v_incl_tax := p_price_kobo - pg_catalog.floor(
        (p_price_kobo::numeric * 10000::numeric)
        / (10000::numeric + v_rate::numeric)
      )::bigint;
      v_base := p_price_kobo - v_incl_tax;
    ELSE
      v_excl_tax := pg_catalog.floor(
        (p_price_kobo::numeric * v_rate::numeric) / 10000::numeric
      )::bigint;
    END IF;
  END IF;

  SELECT * INTO v_split
  FROM public.compute_split(
    v_base, p_commission_bps, p_platform_fee_bps, p_has_affiliate
  );

  v_vendor := v_split.vendor_net_kobo;

  -- Platform fee VAT is carved out of the vendor's share.
  IF v_vat_enabled AND v_applies IN ('platform_fee', 'both') THEN
    v_pf_tax := public.commerce_round_half_up(v_split.platform_fee_kobo, v_rate);
    v_vendor := v_vendor - v_pf_tax;
  END IF;

  IF v_vendor < 0 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  IF v_vat_enabled AND v_applies IN ('platform_fee', 'both') THEN
    v_lines := v_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'basis', 'platform_fee',
        'rate_bps', v_rate,
        'base_kobo', v_split.platform_fee_kobo,
        'tax_kobo', v_pf_tax,
        'included', true,
        'supplier', 'affilova'
      )
    );
  END IF;

  IF v_vat_enabled AND v_applies IN ('product_price', 'both') THEN
    v_lines := v_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'basis', 'product_price',
        'rate_bps', v_rate,
        'base_kobo', p_price_kobo,
        'tax_kobo', CASE WHEN v_inclusive THEN v_incl_tax ELSE v_excl_tax END,
        'included', v_inclusive,
        'supplier', 'vendor'
      )
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'base_kobo', v_base,
    'platform_fee_kobo', v_split.platform_fee_kobo,
    'affiliate_commission_kobo', v_split.affiliate_commission_kobo,
    'vendor_net_kobo', v_vendor,
    'tax_deducted_kobo', v_incl_tax + v_pf_tax,
    'buyer_tax_kobo', v_excl_tax,
    'tax_included', v_excl_tax = 0,
    'lines', v_lines
  );
END;
$$;

-- 8.2 public.create_order(...)
--
-- Creates the pending order, its single item and its tax lines. The product
-- terms are snapshotted here; nothing is posted to the ledger until the payment
-- is confirmed.
--
-- The affiliate attribution is applied only when all of these hold: an active
-- affiliate profile and the affiliate role, a different person from the buyer, a
-- different person from the vendor, and a product that accepts open attribution.
-- Anything else quietly creates the order with no affiliate, which is what the
-- buyer expects: a broken referral link must never block a sale.
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
     AND v_product.affiliate_approval = 'open'
     AND EXISTS (
       SELECT 1
       FROM public.affiliate_profiles ap
       WHERE ap.user_id = p_affiliate
         AND ap.status = 'active'
     )
     AND public.has_role(p_affiliate, 'affiliate')
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

-- 8.3 public.attach_paystack_init(uuid, text)
-- Stores the access code Paystack returned for an initialised transaction. Only
-- a pending order accepts one; a repeated call with the same code is a no-op.
CREATE OR REPLACE FUNCTION public.attach_paystack_init(p_order uuid, p_access_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  IF p_access_code IS NULL OR pg_catalog.btrim(p_access_code) = '' THEN
    RAISE EXCEPTION 'invalid_access_code';
  END IF;

  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  UPDATE public.orders
     SET paystack_access_code = pg_catalog.btrim(p_access_code)
   WHERE id = p_order;
END;
$$;

-- 8.4 public.process_paid_order(...)
--
-- The single place a payment becomes money in the ledger. It is safe to call
-- twice and safe to call concurrently: the order row is locked first, so the
-- second caller either sees the paid status or waits for the first to commit and
-- then sees it.
--
-- The split is rebuilt from the item's snapshots and the order's stored tax
-- lines, never from the current settings, so a settings change between checkout
-- and payment cannot alter what was already quoted.
CREATE OR REPLACE FUNCTION public.process_paid_order(
  p_reference         text,
  p_paystack_txn_id   bigint,
  p_amount_kobo       bigint,
  p_currency          text,
  p_fees_kobo         bigint,
  p_channel           text,
  p_paid_at           timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order        public.orders;
  v_item         public.order_items;
  v_tax_incl_prod bigint;
  v_pf_tax       bigint;
  v_vat_total    bigint;
  v_base         bigint;
  v_split        record;
  v_vendor_net   bigint;
  v_tax_deducted bigint;
  v_credits      bigint;
  v_txn          uuid;
  v_paid_at      timestamptz;
  v_fees         bigint;
  v_hold_days    int;
  v_available_at timestamptz;
  v_items        jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.paystack_reference = pg_catalog.btrim(p_reference)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF v_order.status IN ('paid', 'refunded', 'disputed') THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_paid',
      'order_id', v_order.id,
      'number', v_order.number
    );
  END IF;

  IF v_order.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_amount_kobo IS DISTINCT FROM v_order.total_kobo
     OR p_currency IS DISTINCT FROM v_order.currency THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
    VALUES (
      NULL, 'order.mismatch', 'order', v_order.id::text,
      pg_catalog.jsonb_build_object(
        'expected_amount_kobo', v_order.total_kobo,
        'received_amount_kobo', p_amount_kobo,
        'expected_currency', v_order.currency,
        'received_currency', p_currency,
        'reference', v_order.paystack_reference
      )
    );

    RETURN pg_catalog.jsonb_build_object(
      'status', 'mismatch',
      'order_id', v_order.id,
      'number', v_order.number,
      'expected_amount_kobo', v_order.total_kobo,
      'received_amount_kobo', p_amount_kobo
    );
  END IF;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = v_order.id
  ORDER BY i.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_item_missing';
  END IF;

  SELECT
    coalesce(pg_catalog.sum(
      CASE WHEN l.included AND l.basis = 'product_price' THEN l.tax_kobo ELSE 0 END
    ), 0),
    coalesce(pg_catalog.sum(
      CASE WHEN l.basis = 'platform_fee' THEN l.tax_kobo ELSE 0 END
    ), 0),
    coalesce(pg_catalog.sum(l.tax_kobo), 0)
    INTO v_tax_incl_prod, v_pf_tax, v_vat_total
    FROM public.order_tax_lines l
   WHERE l.order_id = v_order.id;

  v_base := v_item.unit_price_kobo - v_tax_incl_prod;

  SELECT * INTO v_split
  FROM public.compute_split(
    v_base,
    v_item.commission_bps,
    v_item.platform_fee_bps,
    v_item.affiliate_id IS NOT NULL
  );

  v_vendor_net := v_split.vendor_net_kobo - v_pf_tax;
  v_tax_deducted := v_tax_incl_prod + v_pf_tax;

  IF v_vendor_net < 0 THEN
    RAISE EXCEPTION 'invalid_split';
  END IF;

  v_credits := v_split.platform_fee_kobo
               + v_split.affiliate_commission_kobo
               + v_vendor_net
               + v_vat_total;

  IF v_credits <> v_order.total_kobo THEN
    RAISE EXCEPTION 'unbalanced_split';
  END IF;

  v_fees := coalesce(p_fees_kobo, 0);

  IF v_fees < 0 OR v_fees > v_order.total_kobo THEN
    RAISE EXCEPTION 'invalid_processor_fee';
  END IF;

  v_paid_at := coalesce(p_paid_at, pg_catalog.now());
  v_hold_days := public.commerce_setting_int('commission_hold_days', 7);

  IF v_hold_days < 0 THEN
    v_hold_days := 0;
  END IF;

  v_available_at := v_paid_at + pg_catalog.make_interval(days => v_hold_days);

  UPDATE public.orders
     SET status = 'paid',
         paid_at = v_paid_at,
         channel = nullif(pg_catalog.btrim(coalesce(p_channel, '')), ''),
         processor_fee_kobo = v_fees,
         paystack_transaction_id = p_paystack_txn_id
   WHERE id = v_order.id;

  UPDATE public.order_items
     SET platform_fee_kobo = v_split.platform_fee_kobo,
         affiliate_commission_kobo = v_split.affiliate_commission_kobo,
         vendor_net_kobo = v_vendor_net,
         tax_deducted_kobo = v_tax_deducted
   WHERE id = v_item.id;

  INSERT INTO public.ledger_transactions (
    kind, ref_type, ref_id, description, idempotency_key
  )
  VALUES (
    'order_paid', 'order', v_order.id,
    'Order ' || v_order.number || ' paid',
    'order_paid:' || v_order.id::text
  )
  RETURNING id INTO v_txn;

  -- A zero amount is never posted: an entry is a debit or a credit, so a zero
  -- line would have neither side and break the single-side check. A fee-less
  -- payment simply has no processor_fees row.
  IF v_order.total_kobo - v_fees > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 1, NULL, v_order.total_kobo - v_fees, 0, NULL);
  END IF;

  IF v_fees > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 2, NULL, v_fees, 0, NULL);
  END IF;

  IF v_vendor_net > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 3, v_item.vendor_id, 0, v_vendor_net, v_available_at);
  END IF;

  IF v_split.affiliate_commission_kobo > 0 AND v_item.affiliate_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 4, v_item.affiliate_id, 0, v_split.affiliate_commission_kobo, v_available_at);
  END IF;

  IF v_split.platform_fee_kobo > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 5, NULL, 0, v_split.platform_fee_kobo, NULL);
  END IF;

  IF v_vat_total > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, 7, NULL, 0, v_vat_total, NULL);
  END IF;

  INSERT INTO public.entitlements (
    order_item_id, product_id, file_id, buyer_user_id, buyer_email, max_downloads
  )
  SELECT
    v_item.id, v_item.product_id, f.id, v_order.buyer_user_id, v_order.buyer_email,
    v_item.max_downloads
  FROM public.product_files f
  WHERE f.product_id = v_item.product_id
    AND f.status = 'uploaded'
  ON CONFLICT (order_item_id, file_id) DO NOTHING;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL, 'order.paid', 'order', v_order.id::text,
    pg_catalog.jsonb_build_object(
      'number', v_order.number,
      'total_kobo', v_order.total_kobo,
      'processor_fee_kobo', v_fees,
      'paystack_transaction_id', p_paystack_txn_id,
      'channel', p_channel,
      'paid_at', v_paid_at
    )
  );

  PERFORM public.enqueue_job(
    'order_paid',
    pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'number', v_order.number,
      'buyer_email', v_order.buyer_email
    ),
    pg_catalog.now(),
    'order_paid:' || v_order.id::text
  );

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'product_id', i.product_id,
             'title', i.title_snapshot,
             'unit_price_kobo', i.unit_price_kobo,
             'max_downloads', i.max_downloads
           )
         )
    INTO v_items
    FROM public.order_items i
   WHERE i.order_id = v_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'processed',
    'order_id', v_order.id,
    'number', v_order.number,
    'buyer_email', v_order.buyer_email,
    'buyer_name', v_order.buyer_name,
    'total_kobo', v_order.total_kobo,
    'currency', v_order.currency,
    'reference', v_order.paystack_reference,
    'paid_at', v_paid_at,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

-- 8.5 public.expire_pending_orders(int)
-- A bounded sweep so one call never holds a long lock. Returns how many orders
-- it expired.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_limit int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_count int;
BEGIN
  WITH due AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.status = 'pending'
      AND o.expires_at < pg_catalog.now()
    ORDER BY o.expires_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.orders o
     SET status = 'expired'
    FROM due
   WHERE o.id = due.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. VAT
-- ----------------------------------------------------------------------------

-- 9.1 public.vat_period_summary(date)
--
-- Output VAT is attributed to the Lagos month the order was PAID in (the
-- order's paid_at, falling back to the entry's created_at). A credit note is
-- attributed to the Lagos month the refund was posted in, because a refund
-- reduces the VAT of the period it happened in.
--
-- The Lagos month boundary matters: an order paid at 23:30 UTC on 31 January is
-- 00:30 on 1 February in Lagos, so it belongs to February.
CREATE OR REPLACE FUNCTION public.vat_period_summary(p_period date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month        date;
  v_start        timestamptz;
  v_end          timestamptz;
  v_output       bigint;
  v_credit_notes bigint;
  v_adjustments  bigint;
  v_net          bigint;
  v_due          date;
  v_row          public.vat_periods;
BEGIN
  IF p_period IS NULL THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_month := pg_catalog.date_trunc('month', p_period)::date;
  v_start := (v_month::timestamp) AT TIME ZONE 'Africa/Lagos';
  v_end   := ((v_month + pg_catalog.make_interval(months => 1))::timestamp)
             AT TIME ZONE 'Africa/Lagos';

  SELECT coalesce(pg_catalog.sum(e.credit_kobo), 0)
    INTO v_output
    FROM public.ledger_entries e
    JOIN public.ledger_transactions t ON t.id = e.txn_id
    LEFT JOIN public.orders o ON t.ref_type = 'order' AND o.id = t.ref_id
   WHERE e.account_id = 7
     AND coalesce(o.paid_at, e.created_at) >= v_start
     AND coalesce(o.paid_at, e.created_at) <  v_end;

  SELECT coalesce(pg_catalog.sum(e.debit_kobo), 0)
    INTO v_credit_notes
    FROM public.ledger_entries e
   WHERE e.account_id = 7
     AND e.created_at >= v_start
     AND e.created_at <  v_end;

  SELECT coalesce(pg_catalog.sum(a.amount_kobo), 0)
    INTO v_adjustments
    FROM public.vat_adjustments a
   WHERE a.period = v_month;

  v_net := v_output - v_credit_notes + v_adjustments;
  v_due := (v_month + pg_catalog.make_interval(months => 1, days => 20))::date;

  SELECT * INTO v_row FROM public.vat_periods v WHERE v.period = v_month;

  RETURN pg_catalog.jsonb_build_object(
    'period', v_month,
    'output_vat_kobo', v_output,
    'credit_notes_kobo', v_credit_notes,
    'adjustments_kobo', v_adjustments,
    'net_payable_kobo', v_net,
    'due_date', v_due,
    'status', coalesce(v_row.status, 'open'),
    'filed_at', v_row.filed_at,
    'remitted_at', v_row.remitted_at,
    'remitted_amount_kobo', v_row.remitted_amount_kobo
  );
END;
$$;

-- 9.2 public.set_vat_period_status(...)
-- open -> filed -> remitted, and nothing else. A remitted period is closed: it
-- can only be corrected through add_vat_adjustment, which leaves the original
-- figures and the correction side by side.
CREATE OR REPLACE FUNCTION public.set_vat_period_status(
  p_actor                 uuid,
  p_period                date,
  p_status                text,
  p_remitted_amount_kobo  bigint,
  p_payment_reference     text,
  p_receipt_key           text,
  p_note                  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month  date;
  v_row    public.vat_periods;
  v_status text;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_period IS NULL THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_month := pg_catalog.date_trunc('month', p_period)::date;

  IF p_status NOT IN ('filed', 'remitted') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT * INTO v_row FROM public.vat_periods v WHERE v.period = v_month FOR UPDATE;

  v_status := coalesce(v_row.status, 'open');

  IF v_status = 'remitted' THEN
    RAISE EXCEPTION 'period_closed';
  END IF;

  IF p_status = 'filed' AND v_status <> 'open' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_status = 'remitted' THEN
    IF v_status <> 'filed' THEN
      RAISE EXCEPTION 'bad_state';
    END IF;

    IF p_remitted_amount_kobo IS NULL OR p_remitted_amount_kobo < 0 THEN
      RAISE EXCEPTION 'invalid_amount';
    END IF;

    IF p_payment_reference IS NULL OR pg_catalog.btrim(p_payment_reference) = '' THEN
      RAISE EXCEPTION 'invalid_payment_reference';
    END IF;
  END IF;

  INSERT INTO public.vat_periods (period, status, filed_at, remitted_at, remitted_amount_kobo,
                                  payment_reference, receipt_key, note, updated_by, updated_at)
  VALUES (
    v_month,
    p_status,
    CASE WHEN p_status = 'filed' THEN pg_catalog.now() ELSE NULL END,
    CASE WHEN p_status = 'remitted' THEN pg_catalog.now() ELSE NULL END,
    CASE WHEN p_status = 'remitted' THEN p_remitted_amount_kobo ELSE NULL END,
    CASE WHEN p_status = 'remitted' THEN pg_catalog.btrim(p_payment_reference) ELSE NULL END,
    nullif(pg_catalog.btrim(coalesce(p_receipt_key, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    p_actor,
    pg_catalog.now()
  )
  ON CONFLICT (period) DO UPDATE
    SET status = EXCLUDED.status,
        filed_at = coalesce(public.vat_periods.filed_at, EXCLUDED.filed_at),
        remitted_at = EXCLUDED.remitted_at,
        remitted_amount_kobo = EXCLUDED.remitted_amount_kobo,
        payment_reference = EXCLUDED.payment_reference,
        receipt_key = coalesce(EXCLUDED.receipt_key, public.vat_periods.receipt_key),
        note = coalesce(EXCLUDED.note, public.vat_periods.note),
        updated_by = p_actor,
        updated_at = pg_catalog.now();

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor, 'vat_period.' || p_status, 'vat_period', v_month::text,
    CASE WHEN v_row.period IS NULL THEN NULL ELSE pg_catalog.to_jsonb(v_row) END,
    pg_catalog.jsonb_build_object(
      'period', v_month,
      'status', p_status,
      'remitted_amount_kobo', p_remitted_amount_kobo,
      'payment_reference', p_payment_reference
    )
  );
END;
$$;

-- 9.3 public.add_vat_adjustment(...)
-- The only way to change a remitted period's figure. A signed amount: a positive
-- correction adds to what is owed, a negative one reduces it.
CREATE OR REPLACE FUNCTION public.add_vat_adjustment(
  p_actor       uuid,
  p_period      date,
  p_amount_kobo bigint,
  p_reason      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date;
  v_id    uuid;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_period IS NULL THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_month := pg_catalog.date_trunc('month', p_period)::date;

  IF p_amount_kobo IS NULL OR p_amount_kobo = 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  IF p_reason IS NULL OR char_length(pg_catalog.btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vat_periods v WHERE v.period = v_month) THEN
    RAISE EXCEPTION 'period_not_found';
  END IF;

  INSERT INTO public.vat_adjustments (period, amount_kobo, reason, created_by)
  VALUES (v_month, p_amount_kobo, pg_catalog.btrim(p_reason), p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'vat_period.adjustment', 'vat_period', v_month::text,
    pg_catalog.jsonb_build_object('amount_kobo', p_amount_kobo, 'reason', pg_catalog.btrim(p_reason))
  );

  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Refunds and disputes
-- State and ledger only. The Paystack refund call is a later task; this
-- migration records what was decided and posts what it costs.
-- ----------------------------------------------------------------------------

-- 10.1 public.request_refund(uuid, uuid, text)
-- Only the buyer of a paid order may ask. Inside the item's refund window the
-- request is approved on the spot; after it, the vendor or staff decide.
CREATE OR REPLACE FUNCTION public.request_refund(
  p_actor  uuid,
  p_order  uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order      public.orders;
  v_item       public.order_items;
  v_reason     text;
  v_auto       boolean;
  v_id         uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));

  IF char_length(v_reason) < 10 OR char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'not_refundable';
  END IF;

  IF v_order.buyer_user_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'forbidden';
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
      p_order, p_actor, v_reason,
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
    p_actor, 'refund.requested', 'refund_request', v_id::text,
    pg_catalog.jsonb_build_object(
      'order_id', p_order,
      'auto_approved', v_auto,
      'reason', v_reason
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'request_id', v_id,
    'auto_approved', v_auto
  );
END;
$$;

-- 10.2 public.decide_refund(uuid, uuid, text, text)
-- The product's vendor, or staff with admin or finance, decides a request that
-- was not auto-approved. Nobody decides on their own purchase.
CREATE OR REPLACE FUNCTION public.decide_refund(
  p_actor    uuid,
  p_request  uuid,
  p_decision text,
  p_note     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.refund_requests;
  v_order   public.orders;
  v_item    public.order_items;
  v_note    text;
  v_is_vendor boolean;
  v_is_staff  boolean;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');

  IF p_decision = 'reject' AND (v_note IS NULL OR char_length(v_note) < 10) THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT * INTO v_request
  FROM public.refund_requests r
  WHERE r.id = p_request
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_request.status <> 'requested' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = v_request.order_id;

  IF v_order.buyer_user_id = p_actor THEN
    RAISE EXCEPTION 'self_decision';
  END IF;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = v_order.id
  ORDER BY i.created_at
  LIMIT 1;

  v_is_vendor := v_item.vendor_id = p_actor;
  v_is_staff  := public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance');

  IF NOT v_is_vendor AND NOT v_is_staff THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.refund_requests
     SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by = p_actor,
         decided_at = pg_catalog.now(),
         decision_note = v_note
   WHERE id = p_request;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'refund.' || p_decision || 'd', 'refund_request', p_request::text,
    pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'decision', p_decision,
      'note', v_note
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'order_reference', v_order.paystack_reference,
    'amount_kobo', v_order.total_kobo
  );
END;
$$;

-- 10.3 public.process_refund(uuid, text, bigint)
-- Reverses the sale in the ledger and revokes the downloads. Full refunds only
-- at launch. Idempotent on the order, not on the request: a second call after the
-- first committed returns already_processed.
CREATE OR REPLACE FUNCTION public.process_refund(
  p_request            uuid,
  p_provider_reference text,
  p_amount_kobo        bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request  public.refund_requests;
  v_order    public.orders;
  v_item     public.order_items;
  v_vat_total bigint;
  v_txn      uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_request
  FROM public.refund_requests r
  WHERE r.id = p_request
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = v_request.order_id FOR UPDATE;

  IF v_order.status = 'refunded' AND v_request.status = 'processed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_processed',
      'order_id', v_order.id,
      'amount_kobo', v_order.total_kobo
    );
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF p_amount_kobo IS NULL OR p_amount_kobo <> v_order.total_kobo THEN
    RAISE EXCEPTION 'partial_refund_unsupported';
  END IF;

  SELECT t.id INTO v_existing
  FROM public.ledger_transactions t
  WHERE t.idempotency_key = 'order_refund:' || v_order.id::text;

  IF v_existing IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_processed',
      'order_id', v_order.id,
      'amount_kobo', v_order.total_kobo
    );
  END IF;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = v_order.id
  ORDER BY i.created_at
  LIMIT 1;

  SELECT coalesce(pg_catalog.sum(l.tax_kobo), 0)
    INTO v_vat_total
    FROM public.order_tax_lines l
   WHERE l.order_id = v_order.id;

  INSERT INTO public.ledger_transactions (
    kind, ref_type, ref_id, description, idempotency_key
  )
  VALUES (
    'order_refund', 'order', v_order.id,
    'Order ' || v_order.number || ' refunded',
    'order_refund:' || v_order.id::text
  )
  RETURNING id INTO v_txn;

  INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
  VALUES (v_txn, 1, NULL, 0, v_order.total_kobo);

  IF v_item.vendor_net_kobo > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 3, v_item.vendor_id, v_item.vendor_net_kobo, 0);
  END IF;

  IF v_item.affiliate_commission_kobo > 0 AND v_item.affiliate_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 4, v_item.affiliate_id, v_item.affiliate_commission_kobo, 0);
  END IF;

  IF v_item.platform_fee_kobo > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 5, NULL, v_item.platform_fee_kobo, 0);
  END IF;

  IF v_vat_total > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 7, NULL, v_vat_total, 0);
  END IF;

  UPDATE public.entitlements e
     SET revoked_at = pg_catalog.now(),
         revoked_reason = 'refund'
   WHERE e.order_item_id = v_item.id
     AND e.revoked_at IS NULL;

  UPDATE public.orders
     SET status = 'refunded'
   WHERE id = v_order.id;

  UPDATE public.refund_requests
     SET status = 'processed',
         provider_reference = nullif(pg_catalog.btrim(coalesce(p_provider_reference, '')), '')
   WHERE id = p_request;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL, 'order.refunded', 'order', v_order.id::text,
    pg_catalog.jsonb_build_object(
      'number', v_order.number,
      'amount_kobo', v_order.total_kobo,
      'provider_reference', p_provider_reference
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'processed',
    'order_id', v_order.id,
    'number', v_order.number,
    'amount_kobo', v_order.total_kobo,
    'provider_reference', p_provider_reference
  );
END;
$$;

-- 10.4 public.open_dispute(text, text)
-- A paid order is frozen: the buyer keeps the order but loses the downloads for
-- as long as the dispute is open.
CREATE OR REPLACE FUNCTION public.open_dispute(p_reference text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order    public.orders;
  v_item     public.order_items;
  v_dispute  uuid;
BEGIN
  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.paystack_reference = pg_catalog.btrim(p_reference)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_disputes d
    WHERE d.order_id = v_order.id AND d.outcome = 'open'
  ) THEN
    RAISE EXCEPTION 'dispute_exists';
  END IF;

  UPDATE public.orders SET status = 'disputed' WHERE id = v_order.id;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = v_order.id
  ORDER BY i.created_at
  LIMIT 1;

  UPDATE public.entitlements e
     SET revoked_at = pg_catalog.now(),
         revoked_reason = 'dispute'
   WHERE e.order_item_id = v_item.id
     AND e.revoked_at IS NULL;

  INSERT INTO public.order_disputes (order_id, note)
  VALUES (v_order.id, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_dispute;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL, 'order.disputed', 'order', v_order.id::text,
    pg_catalog.jsonb_build_object('number', v_order.number, 'note', p_note)
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'disputed',
    'order_id', v_order.id,
    'dispute_id', v_dispute,
    'number', v_order.number
  );
END;
$$;

-- 10.5 public.resolve_dispute(uuid, text)
-- won  the money stays with the platform: the downloads come back, the order
--      returns to paid
-- lost the money goes back: the same reversal a refund posts, under its own
--      idempotency key
CREATE OR REPLACE FUNCTION public.resolve_dispute(p_order uuid, p_outcome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order    public.orders;
  v_dispute  public.order_disputes;
  v_item     public.order_items;
  v_vat_total bigint;
  v_txn      uuid;
BEGIN
  IF p_outcome NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_dispute
  FROM public.order_disputes d
  WHERE d.order_id = p_order AND d.outcome = 'open'
  ORDER BY d.opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_dispute';
  END IF;

  SELECT * INTO v_item
  FROM public.order_items i
  WHERE i.order_id = p_order
  ORDER BY i.created_at
  LIMIT 1;

  IF p_outcome = 'won' THEN
    UPDATE public.entitlements e
       SET revoked_at = NULL,
           revoked_reason = NULL
     WHERE e.order_item_id = v_item.id
       AND e.revoked_reason = 'dispute';

    UPDATE public.orders SET status = 'paid' WHERE id = p_order;
  ELSE
    SELECT coalesce(pg_catalog.sum(l.tax_kobo), 0)
      INTO v_vat_total
      FROM public.order_tax_lines l
     WHERE l.order_id = p_order;

    INSERT INTO public.ledger_transactions (
      kind, ref_type, ref_id, description, idempotency_key
    )
    VALUES (
      'order_dispute_lost', 'order', p_order,
      'Order ' || v_order.number || ' lost to a dispute',
      'order_dispute_lost:' || p_order::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_txn;

    IF v_txn IS NOT NULL THEN
      INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
      VALUES (v_txn, 1, NULL, 0, v_order.total_kobo);

      IF v_item.vendor_net_kobo > 0 THEN
        INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
        VALUES (v_txn, 3, v_item.vendor_id, v_item.vendor_net_kobo, 0);
      END IF;

      IF v_item.affiliate_commission_kobo > 0 AND v_item.affiliate_id IS NOT NULL THEN
        INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
        VALUES (v_txn, 4, v_item.affiliate_id, v_item.affiliate_commission_kobo, 0);
      END IF;

      IF v_item.platform_fee_kobo > 0 THEN
        INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
        VALUES (v_txn, 5, NULL, v_item.platform_fee_kobo, 0);
      END IF;

      IF v_vat_total > 0 THEN
        INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
        VALUES (v_txn, 7, NULL, v_vat_total, 0);
      END IF;
    END IF;

    -- The entitlement was already revoked when the dispute opened; keep that
    -- reason so the history reads "revoked for a dispute", not "refunded".
    UPDATE public.entitlements e
       SET revoked_at = coalesce(e.revoked_at, pg_catalog.now()),
           revoked_reason = coalesce(e.revoked_reason, 'dispute')
     WHERE e.order_item_id = v_item.id;

    UPDATE public.orders SET status = 'refunded' WHERE id = p_order;
  END IF;

  UPDATE public.order_disputes
     SET outcome = p_outcome,
         resolved_at = pg_catalog.now()
   WHERE id = v_dispute.id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL, 'order.dispute_' || p_outcome, 'order', p_order::text,
    pg_catalog.jsonb_build_object(
      'number', v_order.number,
      'outcome', p_outcome
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', p_outcome,
    'order_id', p_order,
    'order_status', CASE WHEN p_outcome = 'won' THEN 'paid' ELSE 'refunded' END
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Downloads and balances
-- ----------------------------------------------------------------------------

-- 11.1 public.claim_download(uuid, uuid, text, text)
-- Returns the storage key and the original file name only to someone who proves
-- ownership. The application verifies the email token before it passes
-- p_buyer_email; this function never trusts the address on its own for a
-- signed-in claim, it compares it with the entitlement.
--
-- The row is locked before the counter is read, so two simultaneous claims at
-- the limit boundary cannot both pass.
CREATE OR REPLACE FUNCTION public.claim_download(
  p_entitlement uuid,
  p_buyer_user  uuid,
  p_buyer_email text,
  p_ip_hash     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ent   public.entitlements;
  v_file  public.product_files;
  v_order public.order_status;
  v_owner boolean := false;
BEGIN
  SELECT * INTO v_ent
  FROM public.entitlements e
  WHERE e.id = p_entitlement
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p_buyer_user IS NOT NULL
     AND v_ent.buyer_user_id IS NOT NULL
     AND v_ent.buyer_user_id = p_buyer_user THEN
    v_owner := true;
  END IF;

  IF NOT v_owner
     AND p_buyer_email IS NOT NULL
     AND pg_catalog.lower(pg_catalog.btrim(p_buyer_email))
         = pg_catalog.lower(v_ent.buyer_email::text) THEN
    v_owner := true;
  END IF;

  IF NOT v_owner THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_ent.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'revoked';
  END IF;

  IF v_ent.expires_at IS NOT NULL AND v_ent.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'expired';
  END IF;

  IF v_ent.downloads_used >= v_ent.max_downloads THEN
    RAISE EXCEPTION 'download_limit';
  END IF;

  SELECT * INTO v_file FROM public.product_files f WHERE f.id = v_ent.file_id;

  IF NOT FOUND OR v_file.scan_status <> 'clean' THEN
    RAISE EXCEPTION 'file_not_clean';
  END IF;

  SELECT o.status INTO v_order
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.id = v_ent.order_item_id;

  IF v_order IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid';
  END IF;

  UPDATE public.entitlements
     SET downloads_used = downloads_used + 1
   WHERE id = v_ent.id;

  INSERT INTO public.download_log (entitlement_id, ip_hash)
  VALUES (v_ent.id, nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), ''));

  RETURN pg_catalog.jsonb_build_object(
    'storage_key', v_file.storage_key,
    'filename', v_file.original_name
  );
END;
$$;

-- 11.2 public.get_party_balance(uuid)
-- One number for a vendor or an affiliate, across both payable accounts.
--   total     every credit minus every debit
--   pending   credits that are still inside the hold
--   available total minus pending, reported as zero when it would be negative
--   negative  true when the party owes the platform (a refunded sale that was
--             already earned)
CREATE OR REPLACE FUNCTION public.get_party_balance(p_party uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_credits   bigint;
  v_debits    bigint;
  v_pending   bigint;
  v_total     bigint;
  v_available bigint;
BEGIN
  IF p_party IS NULL THEN
    RAISE EXCEPTION 'invalid_party';
  END IF;

  SELECT coalesce(pg_catalog.sum(e.credit_kobo), 0),
         coalesce(pg_catalog.sum(e.debit_kobo), 0),
         coalesce(pg_catalog.sum(
           CASE WHEN e.credit_kobo > 0 AND e.available_at > pg_catalog.now()
                THEN e.credit_kobo ELSE 0 END
         ), 0)
    INTO v_credits, v_debits, v_pending
    FROM public.ledger_entries e
   WHERE e.party_id = p_party
     AND e.account_id IN (3, 4);

  v_total := v_credits - v_debits;
  v_available := greatest(0::bigint, v_total - v_pending);

  RETURN pg_catalog.jsonb_build_object(
    'pending_kobo', v_pending,
    'available_kobo', v_available,
    'total_kobo', v_total,
    'negative', v_total < 0
  );
END;
$$;

-- 11.3 public.add_payout_blackout(uuid, date, text) and remove_payout_blackout
CREATE OR REPLACE FUNCTION public.add_payout_blackout(
  p_actor  uuid,
  p_day    date,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_day IS NULL THEN
    RAISE EXCEPTION 'invalid_day';
  END IF;

  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));

  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;

  INSERT INTO public.payout_blackout_dates (day, reason, created_by)
  VALUES (p_day, v_reason, p_actor)
  ON CONFLICT (day) DO UPDATE
    SET reason = EXCLUDED.reason,
        created_by = EXCLUDED.created_by;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'payout_blackout.added', 'payout_blackout', p_day::text,
    pg_catalog.jsonb_build_object('day', p_day, 'reason', v_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_payout_blackout(p_actor uuid, p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_day IS NULL THEN
    RAISE EXCEPTION 'invalid_day';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payout_blackout_dates b WHERE b.day = p_day) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  DELETE FROM public.payout_blackout_dates b WHERE b.day = p_day;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
  VALUES (p_actor, 'payout_blackout.removed', 'payout_blackout', p_day::text);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Row level security
-- Enabled on every table this migration creates. No client role may write any
-- of them; the policies below are SELECT-only by design.
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tax_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_disputes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_blackout_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_adjustments      ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 13. Privileges
-- Pattern: revoke everything from clients, then grant only SELECT where a
-- policy allows it. anon gets nothing at all.
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.orders, public.order_items, public.order_tax_lines, public.entitlements,
  public.download_log, public.ledger_accounts, public.ledger_transactions,
  public.ledger_entries, public.refund_requests, public.order_disputes,
  public.payout_blackout_dates, public.vat_periods, public.vat_adjustments
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.orders          TO authenticated;
GRANT SELECT ON TABLE public.order_items     TO authenticated;
GRANT SELECT ON TABLE public.entitlements    TO authenticated;
GRANT SELECT ON TABLE public.refund_requests TO authenticated;
GRANT SELECT ON TABLE public.order_disputes  TO authenticated;
GRANT SELECT ON TABLE public.ledger_accounts TO authenticated;
GRANT SELECT ON TABLE public.ledger_transactions TO authenticated;
GRANT SELECT ON TABLE public.ledger_entries  TO authenticated;
GRANT SELECT ON TABLE public.payout_blackout_dates TO authenticated;
GRANT SELECT ON TABLE public.vat_periods     TO authenticated;
GRANT SELECT ON TABLE public.vat_adjustments TO authenticated;

REVOKE ALL ON SEQUENCE public.order_number_seq FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 14. Policies
-- ----------------------------------------------------------------------------

-- orders: the buyer sees their own; staff in admin, finance or support see all.
DROP POLICY IF EXISTS orders_select_buyer ON public.orders;
CREATE POLICY orders_select_buyer
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (buyer_user_id = (select auth.uid()));

DROP POLICY IF EXISTS orders_select_staff ON public.orders;
CREATE POLICY orders_select_staff
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
    OR public.has_role((select auth.uid()), 'support')
  );

-- order_items: the buyer of the order, the vendor who sold it, the affiliate
-- who earned on it, and staff.
DROP POLICY IF EXISTS order_items_select_buyer ON public.order_items;
CREATE POLICY order_items_select_buyer
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.buyer_user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS order_items_select_vendor ON public.order_items;
CREATE POLICY order_items_select_vendor
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (vendor_id = (select auth.uid()));

DROP POLICY IF EXISTS order_items_select_affiliate ON public.order_items;
CREATE POLICY order_items_select_affiliate
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (affiliate_id = (select auth.uid()));

DROP POLICY IF EXISTS order_items_select_staff ON public.order_items;
CREATE POLICY order_items_select_staff
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
    OR public.has_role((select auth.uid()), 'support')
  );

-- entitlements: the buyer, by user id or by the email the entitlement was sold
-- with. Staff do not read entitlements.
DROP POLICY IF EXISTS entitlements_select_buyer ON public.entitlements;
CREATE POLICY entitlements_select_buyer
  ON public.entitlements
  FOR SELECT
  TO authenticated
  USING (
    buyer_user_id = (select auth.uid())
    OR pg_catalog.lower(buyer_email::text) = pg_catalog.lower(
         coalesce(
           (SELECT p.email::text FROM public.profiles p WHERE p.id = (select auth.uid())),
           ''
         )
       )
  );

-- refund_requests: the requester, the vendor of the order, and admin or finance.
DROP POLICY IF EXISTS refund_requests_select_requester ON public.refund_requests;
CREATE POLICY refund_requests_select_requester
  ON public.refund_requests
  FOR SELECT
  TO authenticated
  USING (requested_by = (select auth.uid()));

DROP POLICY IF EXISTS refund_requests_select_vendor ON public.refund_requests;
CREATE POLICY refund_requests_select_vendor
  ON public.refund_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.order_items i
      WHERE i.order_id = refund_requests.order_id
        AND i.vendor_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS refund_requests_select_admin_finance ON public.refund_requests;
CREATE POLICY refund_requests_select_admin_finance
  ON public.refund_requests
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

-- order_disputes: the buyer of the order and staff.
DROP POLICY IF EXISTS order_disputes_select_buyer ON public.order_disputes;
CREATE POLICY order_disputes_select_buyer
  ON public.order_disputes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_disputes.order_id
        AND o.buyer_user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS order_disputes_select_staff ON public.order_disputes;
CREATE POLICY order_disputes_select_staff
  ON public.order_disputes
  FOR SELECT
  TO authenticated
  USING (public.is_staff((select auth.uid())));

-- Ledger, VAT and payout calendars: admin and finance only.
DROP POLICY IF EXISTS ledger_accounts_select_admin_finance ON public.ledger_accounts;
CREATE POLICY ledger_accounts_select_admin_finance
  ON public.ledger_accounts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS ledger_transactions_select_admin_finance ON public.ledger_transactions;
CREATE POLICY ledger_transactions_select_admin_finance
  ON public.ledger_transactions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS ledger_entries_select_admin_finance ON public.ledger_entries;
CREATE POLICY ledger_entries_select_admin_finance
  ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS payout_blackout_dates_select_admin_finance ON public.payout_blackout_dates;
CREATE POLICY payout_blackout_dates_select_admin_finance
  ON public.payout_blackout_dates
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS vat_periods_select_admin_finance ON public.vat_periods;
CREATE POLICY vat_periods_select_admin_finance
  ON public.vat_periods
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

DROP POLICY IF EXISTS vat_adjustments_select_admin_finance ON public.vat_adjustments;
CREATE POLICY vat_adjustments_select_admin_finance
  ON public.vat_adjustments
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin')
    OR public.has_role((select auth.uid()), 'finance')
  );

-- ----------------------------------------------------------------------------
-- 15. Vendor and affiliate read models
-- Both views are owned by the migration role and filter by auth.uid() inside
-- the view, so the caller never needs a policy on the tables behind them. They
-- deliberately expose no buyer email and no buyer name.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.vendor_sales;
CREATE VIEW public.vendor_sales AS
SELECT
  o.number            AS order_number,
  o.status::text      AS status,
  i.product_id        AS product_id,
  i.title_snapshot    AS product_title,
  i.unit_price_kobo   AS unit_price_kobo,
  i.platform_fee_kobo AS platform_fee_kobo,
  i.vendor_net_kobo   AS vendor_net_kobo,
  o.paid_at           AS paid_at,
  o.created_at        AS ordered_at
FROM public.order_items i
JOIN public.orders o ON o.id = i.order_id
WHERE i.vendor_id = (SELECT auth.uid());

DROP VIEW IF EXISTS public.affiliate_commissions;
CREATE VIEW public.affiliate_commissions AS
SELECT
  o.number                        AS order_number,
  o.status::text                  AS status,
  i.product_id                    AS product_id,
  i.title_snapshot                AS product_title,
  i.affiliate_commission_kobo     AS commission_kobo,
  o.paid_at                       AS paid_at,
  o.created_at                    AS ordered_at
FROM public.order_items i
JOIN public.orders o ON o.id = i.order_id
WHERE i.affiliate_id = (SELECT auth.uid());

REVOKE ALL ON TABLE public.vendor_sales, public.affiliate_commissions
  FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.vendor_sales, public.affiliate_commissions
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 16. Server role (service_role) privileges
-- ----------------------------------------------------------------------------
GRANT ALL ON TABLE
  public.orders, public.order_items, public.order_tax_lines, public.entitlements,
  public.download_log, public.ledger_accounts, public.refund_requests,
  public.order_disputes, public.payout_blackout_dates, public.vat_periods,
  public.vat_adjustments
TO service_role;

-- The ledger is append-only for the server too: no UPDATE, no DELETE, no
-- TRUNCATE, on either table.
GRANT SELECT, INSERT ON TABLE public.ledger_transactions TO service_role;
GRANT SELECT, INSERT ON TABLE public.ledger_entries TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.order_number_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ledger_entries_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.download_log_id_seq TO service_role;

-- Strip mutating privileges on the ledger from every role except postgres,
-- including any role this file has not heard of.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname <> 'postgres'
      AND rolname NOT LIKE 'pg\_%'
  LOOP
    EXECUTE format(
      'REVOKE UPDATE, DELETE, TRUNCATE ON public.ledger_entries FROM %I', r.rolname
    );
    EXECUTE format(
      'REVOKE UPDATE, DELETE, TRUNCATE ON public.ledger_transactions FROM %I', r.rolname
    );
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- 17. Functions are not callable from a browser
-- Revoked from PUBLIC, anon and authenticated; granted to service_role only.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.commerce_setting(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_setting_int(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_setting_bigint(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_setting_bool(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_setting_text(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_round_half_up(bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_split(bigint, int, int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_withdrawal_fee(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_payout_day(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_order_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_order_math(bigint, int, int, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_order(uuid, text, text, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_paystack_init(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_paid_order(text, bigint, bigint, text, bigint, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_pending_orders(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vat_period_summary(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_vat_period_status(uuid, date, text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_vat_adjustment(uuid, date, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_refund(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_refund(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_dispute(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_dispute(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_download(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_party_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_payout_blackout(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_payout_blackout(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_entries_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_check_balanced() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commerce_setting(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_setting_int(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_setting_bigint(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_setting_bool(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_setting_text(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_round_half_up(bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_split(bigint, int, int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_withdrawal_fee(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_payout_day(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_order_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_order_math(bigint, int, int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, text, uuid, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_paystack_init(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_paid_order(text, bigint, bigint, text, bigint, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_pending_orders(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.vat_period_summary(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_vat_period_status(uuid, date, text, bigint, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_vat_adjustment(uuid, date, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_refund(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_refund(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_refund(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_dispute(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_dispute(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_download(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_party_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_payout_blackout(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_payout_blackout(uuid, date) TO service_role;

-- ----------------------------------------------------------------------------
-- 18. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261116000200', 'commerce_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops every order, entitlement, ledger entry, refund, dispute
-- and VAT period this migration created, and the ledger cannot be rebuilt from
-- the payment provider alone. Take a backup first. Nothing from another
-- migration is dropped: the settings rows, the products and the profiles stay.
--
-- The ledger's append-only trigger blocks DELETE, so the tables are dropped
-- rather than emptied, and they are dropped before the functions that the
-- constraint trigger depends on.
-- ============================================================================
--
-- BEGIN;
--
-- DROP VIEW IF EXISTS public.affiliate_commissions;
-- DROP VIEW IF EXISTS public.vendor_sales;
--
-- DROP POLICY IF EXISTS vat_adjustments_select_admin_finance ON public.vat_adjustments;
-- DROP POLICY IF EXISTS vat_periods_select_admin_finance ON public.vat_periods;
-- DROP POLICY IF EXISTS payout_blackout_dates_select_admin_finance ON public.payout_blackout_dates;
-- DROP POLICY IF EXISTS ledger_entries_select_admin_finance ON public.ledger_entries;
-- DROP POLICY IF EXISTS ledger_transactions_select_admin_finance ON public.ledger_transactions;
-- DROP POLICY IF EXISTS ledger_accounts_select_admin_finance ON public.ledger_accounts;
-- DROP POLICY IF EXISTS order_disputes_select_staff ON public.order_disputes;
-- DROP POLICY IF EXISTS order_disputes_select_buyer ON public.order_disputes;
-- DROP POLICY IF EXISTS refund_requests_select_admin_finance ON public.refund_requests;
-- DROP POLICY IF EXISTS refund_requests_select_vendor ON public.refund_requests;
-- DROP POLICY IF EXISTS refund_requests_select_requester ON public.refund_requests;
-- DROP POLICY IF EXISTS entitlements_select_buyer ON public.entitlements;
-- DROP POLICY IF EXISTS order_items_select_staff ON public.order_items;
-- DROP POLICY IF EXISTS order_items_select_affiliate ON public.order_items;
-- DROP POLICY IF EXISTS order_items_select_vendor ON public.order_items;
-- DROP POLICY IF EXISTS order_items_select_buyer ON public.order_items;
-- DROP POLICY IF EXISTS orders_select_staff ON public.orders;
-- DROP POLICY IF EXISTS orders_select_buyer ON public.orders;
--
-- DROP TABLE IF EXISTS public.vat_adjustments;
-- DROP TABLE IF EXISTS public.vat_periods;
-- DROP TABLE IF EXISTS public.payout_blackout_dates;
-- DROP TABLE IF EXISTS public.order_disputes;
-- DROP TABLE IF EXISTS public.refund_requests;
-- DROP TABLE IF EXISTS public.ledger_entries;
-- DROP TABLE IF EXISTS public.ledger_transactions;
-- DROP TABLE IF EXISTS public.ledger_accounts;
-- DROP TABLE IF EXISTS public.download_log;
-- DROP TABLE IF EXISTS public.entitlements;
-- DROP TABLE IF EXISTS public.order_tax_lines;
-- DROP TABLE IF EXISTS public.order_items;
-- DROP TABLE IF EXISTS public.orders;
--
-- DROP FUNCTION IF EXISTS public.remove_payout_blackout(uuid, date);
-- DROP FUNCTION IF EXISTS public.add_payout_blackout(uuid, date, text);
-- DROP FUNCTION IF EXISTS public.get_party_balance(uuid);
-- DROP FUNCTION IF EXISTS public.claim_download(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.resolve_dispute(uuid, text);
-- DROP FUNCTION IF EXISTS public.open_dispute(text, text);
-- DROP FUNCTION IF EXISTS public.process_refund(uuid, text, bigint);
-- DROP FUNCTION IF EXISTS public.decide_refund(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.request_refund(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.add_vat_adjustment(uuid, date, bigint, text);
-- DROP FUNCTION IF EXISTS public.set_vat_period_status(uuid, date, text, bigint, text, text, text);
-- DROP FUNCTION IF EXISTS public.vat_period_summary(date);
-- DROP FUNCTION IF EXISTS public.expire_pending_orders(int);
-- DROP FUNCTION IF EXISTS public.process_paid_order(text, bigint, bigint, text, bigint, text, timestamptz);
-- DROP FUNCTION IF EXISTS public.attach_paystack_init(uuid, text);
-- DROP FUNCTION IF EXISTS public.create_order(uuid, text, text, uuid, uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.commerce_order_math(bigint, int, int, boolean);
-- DROP FUNCTION IF EXISTS public.next_order_number();
-- DROP FUNCTION IF EXISTS public.is_payout_day(timestamptz);
-- DROP FUNCTION IF EXISTS public.compute_withdrawal_fee(bigint);
-- DROP FUNCTION IF EXISTS public.compute_split(bigint, int, int, boolean);
-- DROP FUNCTION IF EXISTS public.commerce_round_half_up(bigint, int);
-- DROP FUNCTION IF EXISTS public.ledger_check_balanced();
-- DROP FUNCTION IF EXISTS public.ledger_entries_block_mutation();
-- DROP FUNCTION IF EXISTS public.commerce_setting_text(text, text);
-- DROP FUNCTION IF EXISTS public.commerce_setting_bool(text, boolean);
-- DROP FUNCTION IF EXISTS public.commerce_setting_bigint(text, bigint);
-- DROP FUNCTION IF EXISTS public.commerce_setting_int(text, int);
-- DROP FUNCTION IF EXISTS public.commerce_setting(text);
--
-- DROP SEQUENCE IF EXISTS public.order_number_seq;
-- DROP TYPE IF EXISTS public.order_status;
--
-- DELETE FROM public.settings
--  WHERE key IN ('withdrawal_fee_bps', 'withdrawal_fee_min_kobo', 'withdrawal_fee_cap_kobo',
--                'processor_fee_bearer', 'auto_payout_default', 'payout_weekdays',
--                'payout_run_hour_lagos', 'order_expiry_hours', 'guest_checkout_enabled');
--
-- DELETE FROM public.app_migrations WHERE version = '20261116000200';
--
-- COMMIT;
