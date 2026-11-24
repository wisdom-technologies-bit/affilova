-- ============================================================================
-- Migration 20261122000100_payouts
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: payout accounts, payout preferences, withdrawals, withdrawal
--        approvals, the payout ledger postings and the service_role functions
--        that drive them. Database and documentation only: no page, no
--        component and no application code is created or changed here.
-- Depends on: 20261112000100_foundation (settings, audit_log, profiles,
--        user_roles, has_role, set_updated_at),
--        20261116000200_commerce_core (ledger_accounts, ledger_transactions,
--        ledger_entries, payout_blackout_dates, compute_withdrawal_fee,
--        is_payout_day, commerce_setting*, get_party_balance),
--        20261118000200_affiliate_tracking (risk_flags).
-- This file is idempotent: running it twice must not raise an error.
--
-- All money is an integer number of kobo (bigint). The full bank account number
-- is never stored: only the last four digits, the bank code, the account name
-- and the Paystack recipient code.
--
-- The "now" used by every payout decision is public.payout_now(), which reads
-- the optional settings key payout_clock_override_iso. The key exists so the
-- harness can place the clock on a weekday, a weekend or a blackout date; it
-- must be absent (or null) in production.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Settings seeds
-- Every value is inserted with ON CONFLICT DO NOTHING, so an owner decision
-- that is already stored is never overwritten by re-running this file.
-- ----------------------------------------------------------------------------
INSERT INTO public.settings (key, value, description) VALUES
  ('payout_auto_approve_max_kobo',      '10000000'::jsonb,      'A withdrawal above this needs admin approval (100,000 NGN).'),
  ('payout_dual_approval_kobo',         '50000000'::jsonb,      'A withdrawal above this needs two different approvers (500,000 NGN).'),
  ('payout_first_requires_approval',    'true'::jsonb,          'Whether a user''s first withdrawal needs admin approval.'),
  ('payout_account_min_age_days',       '7'::jsonb,             'Days a user account must exist before it may withdraw.'),
  ('withdrawal_daily_limit_kobo',       '100000000'::jsonb,     'Most a user may request in one Lagos day (1,000,000 NGN).'),
  ('payout_bank_change_freeze_hours',   '72'::jsonb,            'Hours payouts stay frozen after a payout account is added or changed.'),
  ('payout_processing_hours_lagos',     '[8,18]'::jsonb,        'Lagos hours the transfer window is open: from 08:00 up to 18:00.'),
  ('paystack_transfer_fee_bands',       '[{"up_to_kobo":500000,"fee_kobo":1000},{"up_to_kobo":5000000,"fee_kobo":2500},{"up_to_kobo":null,"fee_kobo":5000}]'::jsonb,
                                        'Paystack transfer fee bands, used only when the API does not report fee_charged.')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. public.payout_now()
-- The single clock every payout decision reads. The override is a settings row
-- so the harness can choose the day; production leaves it unset.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payout_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT CASE
               WHEN pg_catalog.jsonb_typeof(s.value) = 'string'
                    AND (s.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
               THEN (s.value #>> '{}')::timestamptz
               ELSE NULL
             END
      FROM public.settings s
      WHERE s.key = 'payout_clock_override_iso'
    ),
    pg_catalog.now()
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Tables
-- ----------------------------------------------------------------------------

-- 3.1 public.payout_accounts
--
-- One row per payout account a user has ever given us. Only one may be active:
-- the partial unique index is what enforces it. account_last4 is exactly four
-- digits; the full number is never written anywhere.
CREATE TABLE IF NOT EXISTS public.payout_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  bank_code       text        NOT NULL CHECK (char_length(bank_code) BETWEEN 1 AND 20),
  bank_name       text        NOT NULL CHECK (char_length(bank_name) BETWEEN 1 AND 120),
  account_last4   text        NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  account_name    text        NOT NULL CHECK (char_length(account_name) BETWEEN 1 AND 120),
  recipient_code  text        NOT NULL CHECK (char_length(recipient_code) BETWEEN 1 AND 120),
  name_match      boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'replaced', 'disabled')),
  frozen_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payout_accounts_one_active_idx
  ON public.payout_accounts (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS payout_accounts_user_idx
  ON public.payout_accounts (user_id, created_at DESC);

-- 3.2 public.payout_preferences
--
-- A user without a row uses the auto_payout_default setting.
CREATE TABLE IF NOT EXISTS public.payout_preferences (
  user_id     uuid        PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  auto_payout boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS payout_preferences_set_updated_at ON public.payout_preferences;
CREATE TRIGGER payout_preferences_set_updated_at
  BEFORE UPDATE ON public.payout_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.3 public.withdrawals
--
-- gross = fee + net, always, and every part is positive. reference is unique and
-- is what makes a retried Paystack call safe: Paystack accepts a reference once.
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  payout_account_id     uuid        NOT NULL REFERENCES public.payout_accounts (id) ON DELETE RESTRICT,
  kind                  text        NOT NULL CHECK (kind IN ('auto', 'manual')),
  status                text        NOT NULL DEFAULT 'requested'
                                    CHECK (status IN ('requested', 'approved', 'processing',
                                                      'paid', 'failed', 'reversed', 'rejected',
                                                      'cancelled')),
  gross_kobo            bigint      NOT NULL CHECK (gross_kobo > 0),
  fee_kobo              bigint      NOT NULL CHECK (fee_kobo >= 0),
  net_kobo              bigint      NOT NULL CHECK (net_kobo > 0),
  reference             text        NOT NULL UNIQUE
                                    CHECK (reference ~ '^[a-z0-9_-]{16,50}$'),
  paystack_transfer_code text,
  paystack_transfer_id  bigint,
  failure_reason        text        CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 300),
  transfer_fee_kobo     bigint      CHECK (transfer_fee_kobo IS NULL OR transfer_fee_kobo >= 0),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  approved_by           uuid,
  approved_at           timestamptz,
  second_approver       uuid,
  processed_at          timestamptz,
  paid_at               timestamptz,
  note                  text,
  CONSTRAINT withdrawals_amounts_balance CHECK (gross_kobo = fee_kobo + net_kobo)
);

CREATE INDEX IF NOT EXISTS withdrawals_user_requested_idx
  ON public.withdrawals (user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS withdrawals_status_requested_idx
  ON public.withdrawals (status, requested_at);

CREATE INDEX IF NOT EXISTS withdrawals_processing_idx
  ON public.withdrawals (processed_at)
  WHERE status = 'processing';

-- 3.4 public.withdrawal_approvals
--
-- Every approval decision, so a dual-approval withdrawal shows two rows by two
-- different people.
CREATE TABLE IF NOT EXISTS public.withdrawal_approvals (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  withdrawal_id uuid        NOT NULL REFERENCES public.withdrawals (id) ON DELETE CASCADE,
  approver      uuid        NOT NULL,
  decision      text        NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS withdrawal_approvals_withdrawal_idx
  ON public.withdrawal_approvals (withdrawal_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. Pure and near-pure helpers
-- ----------------------------------------------------------------------------

-- 4.1 public.payout_transfer_fee(bigint)
-- The Paystack transfer fee for an amount, from the configured bands. Used only
-- as a fallback: the API reports fee_charged, which is the real number.
CREATE OR REPLACE FUNCTION public.payout_transfer_fee(p_amount_kobo bigint)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bands jsonb;
  v_band  jsonb;
  v_up_to bigint;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN 0;
  END IF;

  v_bands := public.commerce_setting('paystack_transfer_fee_bands');

  IF v_bands IS NULL OR pg_catalog.jsonb_typeof(v_bands) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_band IN SELECT * FROM pg_catalog.jsonb_array_elements(v_bands) LOOP
    IF pg_catalog.jsonb_typeof(v_band -> 'up_to_kobo') = 'number' THEN
      v_up_to := (v_band ->> 'up_to_kobo')::bigint;

      IF p_amount_kobo <= v_up_to THEN
        RETURN greatest(0, coalesce((v_band ->> 'fee_kobo')::bigint, 0));
      END IF;
    ELSE
      RETURN greatest(0, coalesce((v_band ->> 'fee_kobo')::bigint, 0));
    END IF;
  END LOOP;

  RETURN 0;
END;
$$;

-- 4.2 public.payout_processing_window(timestamptz)
-- A payout day (weekday, not blacked out) whose Lagos hour is inside
-- payout_processing_hours_lagos, read as [open, close): 08:00 up to 18:00.
CREATE OR REPLACE FUNCTION public.payout_processing_window(p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hours jsonb;
  v_open  int;
  v_close int;
  v_hour  int;
BEGIN
  IF p_at IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_payout_day(p_at) THEN
    RETURN false;
  END IF;

  v_hours := public.commerce_setting('payout_processing_hours_lagos');

  IF v_hours IS NULL OR pg_catalog.jsonb_typeof(v_hours) <> 'array' THEN
    v_hours := '[8,18]'::jsonb;
  END IF;

  v_open  := coalesce((v_hours ->> 0)::int, 8);
  v_close := coalesce((v_hours ->> 1)::int, 18);
  v_hour  := extract(hour FROM (p_at AT TIME ZONE 'Africa/Lagos'))::int;

  RETURN v_hour >= v_open AND v_hour < v_close;
END;
$$;

-- 4.3 public.payout_next_day(timestamptz)
-- The first payout day on or after the Lagos date of p_at, searching 14 days
-- ahead. Null when the calendar is blocked that far out.
CREATE OR REPLACE FUNCTION public.payout_next_day(p_at timestamptz)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start date;
  v_i     int;
  v_day   date;
BEGIN
  IF p_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_start := (p_at AT TIME ZONE 'Africa/Lagos')::date;

  FOR v_i IN 0..13 LOOP
    v_day := v_start + v_i;

    IF public.is_payout_day((v_day::timestamp AT TIME ZONE 'Africa/Lagos')) THEN
      RETURN v_day;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 4.4 public.payout_available_by_account(uuid)
-- The available balance per payable account for one party, using the same rule
-- as public.get_party_balance: a credit whose available_at is in the future is
-- pending, not available.
CREATE OR REPLACE FUNCTION public.payout_available_by_account(p_user uuid)
RETURNS TABLE (account_id smallint, available_kobo bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.account_id,
         greatest(
           0::bigint,
           coalesce(pg_catalog.sum(e.credit_kobo), 0)
           - coalesce(pg_catalog.sum(e.debit_kobo), 0)
           - coalesce(pg_catalog.sum(
               CASE WHEN e.credit_kobo > 0
                         AND e.available_at IS NOT NULL
                         AND e.available_at > public.payout_now()
                    THEN e.credit_kobo ELSE 0 END
             ), 0)
         )
    FROM public.ledger_entries e
   WHERE e.party_id = p_user
     AND e.account_id IN (3, 4)
   GROUP BY e.account_id;
$$;

-- 4.5 public.payout_needs_approval(uuid, bigint)
-- The three safety defaults that put a withdrawal in front of a person: the
-- user's first withdrawal, an amount above payout_auto_approve_max_kobo, and an
-- unresolved risk flag.
CREATE OR REPLACE FUNCTION public.payout_needs_approval(p_user uuid, p_gross_kobo bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max    bigint;
  v_first  boolean;
  v_risk   boolean;
BEGIN
  v_max := public.commerce_setting_bigint('payout_auto_approve_max_kobo', 10000000);

  IF p_gross_kobo > v_max THEN
    RETURN true;
  END IF;

  IF public.commerce_setting_bool('payout_first_requires_approval', true) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.withdrawals w WHERE w.user_id = p_user
    ) INTO v_first;

    IF v_first THEN
      RETURN true;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.risk_flags f
     WHERE f.affiliate_id = p_user
       AND f.resolved_at IS NULL
  ) INTO v_risk;

  RETURN v_risk;
END;
$$;

-- 4.6 public.payout_evaluate(uuid, bigint)
-- Every rule the preview reports and the request enforces, in one place, so the
-- two can never drift apart. The reason order is the order a request raises:
-- a suspended user is told that first, then the account, then the money.
CREATE OR REPLACE FUNCTION public.payout_evaluate(p_user uuid, p_amount_kobo bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now        timestamptz := public.payout_now();
  v_profile    public.profiles%ROWTYPE;
  v_account    public.payout_accounts%ROWTYPE;
  v_has_acct   boolean := false;
  v_min        bigint;
  v_min_age    int;
  v_daily      bigint;
  v_today      bigint;
  v_available  bigint;
  v_gross      bigint;
  v_fee        bigint;
  v_net        bigint;
  v_reasons    text[] := ARRAY[]::text[];
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  v_min     := public.commerce_setting_bigint('min_withdrawal_kobo', 500000);
  v_min_age := public.commerce_setting_int('payout_account_min_age_days', 7);
  v_daily   := public.commerce_setting_bigint('withdrawal_daily_limit_kobo', 100000000);
  v_gross   := coalesce(p_amount_kobo, 0);

  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_user;

  IF NOT FOUND OR v_profile.status <> 'active' THEN
    v_reasons := v_reasons || 'user_not_active'::text;
  END IF;

  SELECT * INTO v_account
    FROM public.payout_accounts a
   WHERE a.user_id = p_user
     AND a.status = 'active'
   ORDER BY a.created_at DESC
   LIMIT 1;

  v_has_acct := FOUND;

  IF NOT v_has_acct THEN
    v_reasons := v_reasons || 'no_account'::text;
  ELSIF v_account.frozen_until IS NOT NULL AND v_account.frozen_until > v_now THEN
    v_reasons := v_reasons || 'account_frozen'::text;
  END IF;

  IF v_profile.id IS NOT NULL
     AND v_profile.created_at IS NOT NULL
     AND v_profile.created_at > v_now - pg_catalog.make_interval(days => greatest(v_min_age, 0)) THEN
    v_reasons := v_reasons || 'account_too_new'::text;
  END IF;

  IF v_gross < v_min THEN
    v_reasons := v_reasons || 'below_minimum'::text;
  END IF;

  SELECT coalesce(pg_catalog.sum(x.available_kobo), 0)
    INTO v_available
    FROM public.payout_available_by_account(p_user) x;

  IF v_available < v_gross THEN
    v_reasons := v_reasons || 'insufficient_balance'::text;
  END IF;

  SELECT coalesce(pg_catalog.sum(w.gross_kobo), 0)
    INTO v_today
    FROM public.withdrawals w
   WHERE w.user_id = p_user
     AND w.status NOT IN ('failed', 'rejected', 'cancelled')
     AND (w.requested_at AT TIME ZONE 'Africa/Lagos')::date
         = (v_now AT TIME ZONE 'Africa/Lagos')::date;

  IF v_today + v_gross > v_daily THEN
    v_reasons := v_reasons || 'daily_limit'::text;
  END IF;

  IF NOT public.is_payout_day(v_now) THEN
    v_reasons := v_reasons || 'not_payout_day'::text;
  END IF;

  IF v_gross >= v_min THEN
    v_fee := public.compute_withdrawal_fee(v_gross);
  ELSE
    v_fee := 0;
  END IF;

  v_net := v_gross - v_fee;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', pg_catalog.cardinality(v_reasons) = 0,
    'reasons', pg_catalog.to_jsonb(v_reasons),
    'gross_kobo', v_gross,
    'fee_kobo', v_fee,
    'net_kobo', v_net,
    'available_kobo', v_available,
    'next_payout_day', public.payout_next_day(v_now),
    'needs_approval', CASE
                        WHEN v_gross <= 0 THEN false
                        ELSE public.payout_needs_approval(p_user, v_gross)
                      END
  );
END;
$$;

-- 4.7 public.payout_debit_split(uuid, bigint)
-- How a gross amount comes out of the two payable accounts: vendor_payable
-- first, then affiliate_payable, and never more than that account holds as
-- available. Raises insufficient_balance when the two cannot cover it.
CREATE OR REPLACE FUNCTION public.payout_debit_split(p_user uuid, p_gross_kobo bigint)
RETURNS TABLE (account_id smallint, amount_kobo bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor    bigint := 0;
  v_affiliate bigint := 0;
  v_remaining bigint;
BEGIN
  SELECT coalesce(pg_catalog.max(x.available_kobo) FILTER (WHERE x.account_id = 3), 0),
         coalesce(pg_catalog.max(x.available_kobo) FILTER (WHERE x.account_id = 4), 0)
    INTO v_vendor, v_affiliate
    FROM public.payout_available_by_account(p_user) x;

  IF v_vendor + v_affiliate < p_gross_kobo THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  v_remaining := p_gross_kobo;

  IF v_vendor > 0 AND v_remaining > 0 THEN
    account_id := 3;
    amount_kobo := least(v_vendor, v_remaining);
    v_remaining := v_remaining - amount_kobo;
    RETURN NEXT;
  END IF;

  IF v_remaining > 0 THEN
    account_id := 4;
    amount_kobo := least(v_affiliate, v_remaining);
    v_remaining := v_remaining - amount_kobo;
    RETURN NEXT;
  END IF;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;
END;
$$;

-- 4.8 public.payout_post_request(uuid)
-- The request posting: debit the payable accounts for the gross, credit
-- payouts_in_transit. One transaction, keyed on the withdrawal, so a retried
-- call posts nothing.
CREATE OR REPLACE FUNCTION public.payout_post_request(p_withdrawal uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w    public.withdrawals%ROWTYPE;
  v_txn  uuid;
  v_part record;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.ledger_transactions (kind, ref_type, ref_id, description, idempotency_key)
  VALUES ('withdrawal_request', 'withdrawal', v_w.id,
          'Withdrawal ' || v_w.reference || ' requested',
          'withdrawal_request:' || v_w.id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_txn;

  IF v_txn IS NULL THEN
    RETURN;
  END IF;

  FOR v_part IN SELECT * FROM public.payout_debit_split(v_w.user_id, v_w.gross_kobo) LOOP
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, v_part.account_id, v_w.user_id, v_part.amount_kobo, 0);
  END LOOP;

  INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
  VALUES (v_txn, 8, v_w.user_id, 0, v_w.gross_kobo);
END;
$$;

-- 4.9 public.payout_post_paid(uuid, bigint)
-- The success posting: payouts_in_transit out, Paystack balance in at the net,
-- the withdrawal fee as revenue, and the Paystack transfer fee as an expense
-- against the same balance.
CREATE OR REPLACE FUNCTION public.payout_post_paid(p_withdrawal uuid, p_transfer_fee_kobo bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w    public.withdrawals%ROWTYPE;
  v_txn  uuid;
  v_fee  bigint;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_fee := greatest(0, coalesce(p_transfer_fee_kobo, 0));

  INSERT INTO public.ledger_transactions (kind, ref_type, ref_id, description, idempotency_key)
  VALUES ('withdrawal_paid', 'withdrawal', v_w.id,
          'Withdrawal ' || v_w.reference || ' paid',
          'withdrawal_paid:' || v_w.id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_txn;

  IF v_txn IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
  VALUES (v_txn, 8, v_w.user_id, v_w.gross_kobo, 0);

  INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
  VALUES (v_txn, 1, NULL, 0, v_w.net_kobo);

  IF v_w.fee_kobo > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 6, NULL, 0, v_w.fee_kobo);
  END IF;

  IF v_fee > 0 THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 2, NULL, v_fee, 0);

    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 1, NULL, 0, v_fee);
  END IF;
END;
$$;

-- 4.10 public.payout_post_return(uuid)
-- The money comes back to the user. Before a transfer was paid the gross is
-- still in payouts_in_transit, so it is debited. After a paid transfer the gross
-- left the Paystack balance and came back to it, so the balance and the fee
-- revenue are debited instead. Either way the same payable accounts the request
-- debited are credited, with available_at = now(), so the money is withdrawable
-- immediately.
CREATE OR REPLACE FUNCTION public.payout_post_return(p_withdrawal uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w       public.withdrawals%ROWTYPE;
  v_txn     uuid;
  v_request uuid;
  v_part    record;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.ledger_transactions (kind, ref_type, ref_id, description, idempotency_key)
  VALUES ('withdrawal_return', 'withdrawal', v_w.id,
          'Withdrawal ' || v_w.reference || ' returned',
          'withdrawal_return:' || v_w.id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_txn;

  IF v_txn IS NULL THEN
    RETURN;
  END IF;

  IF v_w.paid_at IS NOT NULL THEN
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 1, NULL, v_w.net_kobo, 0);

    IF v_w.fee_kobo > 0 THEN
      INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
      VALUES (v_txn, 6, NULL, v_w.fee_kobo, 0);
    END IF;
  ELSE
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
    VALUES (v_txn, 8, v_w.user_id, v_w.gross_kobo, 0);
  END IF;

  SELECT t.id INTO v_request
    FROM public.ledger_transactions t
   WHERE t.idempotency_key = 'withdrawal_request:' || v_w.id::text;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'request_posting_missing';
  END IF;

  FOR v_part IN
    SELECT e.account_id, e.debit_kobo AS amount_kobo
      FROM public.ledger_entries e
     WHERE e.txn_id = v_request
       AND e.account_id IN (3, 4)
       AND e.debit_kobo > 0
     ORDER BY e.account_id
  LOOP
    INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
    VALUES (v_txn, v_part.account_id, v_w.user_id, 0, v_part.amount_kobo,
            least(public.payout_now(), pg_catalog.now()));
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Functions the application calls
-- ----------------------------------------------------------------------------

-- 5.1 public.set_payout_account(...) -> uuid
--
-- Stores a resolved payout account and makes it the active one. A previous
-- account becomes 'replaced' and the freeze clock starts, because a new account
-- is the moment a payout can be redirected. A name that does not match the
-- profile never becomes an account at all: the function raises name_mismatch and
-- writes nothing, so there is no disabled row a later call could re-enable.
CREATE OR REPLACE FUNCTION public.set_payout_account(
  p_user           uuid,
  p_bank_code      text,
  p_bank_name      text,
  p_account_last4  text,
  p_account_name   text,
  p_recipient_code text,
  p_name_match     boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_freeze_hours int;
  v_had_previous boolean;
  v_id           uuid;
  v_frozen_until timestamptz;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user) THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  IF p_account_last4 IS NULL OR p_account_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid_account_last4';
  END IF;

  IF coalesce(pg_catalog.btrim(p_bank_code), '') = ''
     OR coalesce(pg_catalog.btrim(p_bank_name), '') = ''
     OR coalesce(pg_catalog.btrim(p_account_name), '') = ''
     OR coalesce(pg_catalog.btrim(p_recipient_code), '') = '' THEN
    RAISE EXCEPTION 'invalid_account';
  END IF;

  IF p_name_match IS NOT TRUE THEN
    RAISE EXCEPTION 'name_mismatch';
  END IF;

  v_freeze_hours := greatest(0, public.commerce_setting_int('payout_bank_change_freeze_hours', 72));

  SELECT EXISTS (
    SELECT 1 FROM public.payout_accounts a WHERE a.user_id = p_user
  ) INTO v_had_previous;

  v_frozen_until := CASE
                      WHEN v_had_previous AND v_freeze_hours > 0
                      THEN public.payout_now() + pg_catalog.make_interval(hours => v_freeze_hours)
                      ELSE NULL
                    END;

  UPDATE public.payout_accounts a
     SET status = 'replaced'
   WHERE a.user_id = p_user
     AND a.status = 'active';

  INSERT INTO public.payout_accounts (
    user_id, bank_code, bank_name, account_last4, account_name,
    recipient_code, name_match, status, frozen_until
  )
  VALUES (
    p_user, pg_catalog.btrim(p_bank_code), pg_catalog.btrim(p_bank_name),
    p_account_last4, pg_catalog.btrim(p_account_name),
    pg_catalog.btrim(p_recipient_code), true, 'active', v_frozen_until
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_user, 'payout_account.set', 'payout_account', v_id::text,
    pg_catalog.jsonb_build_object(
      'bank_code', pg_catalog.btrim(p_bank_code),
      'bank_name', pg_catalog.btrim(p_bank_name),
      'account_last4', p_account_last4,
      'name_match', true,
      'replaced_previous', v_had_previous,
      'frozen_until', v_frozen_until
    )
  );

  RETURN v_id;
END;
$$;

-- 5.2 public.set_auto_payout(uuid, boolean)
CREATE OR REPLACE FUNCTION public.set_auto_payout(p_user uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user IS NULL OR p_enabled IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user) THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  INSERT INTO public.payout_preferences (user_id, auto_payout)
  VALUES (p_user, p_enabled)
  ON CONFLICT (user_id) DO UPDATE
    SET auto_payout = EXCLUDED.auto_payout;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_user, 'payout_preference.set', 'payout_preference', p_user::text,
    pg_catalog.jsonb_build_object('auto_payout', p_enabled)
  );
END;
$$;

-- 5.3 public.withdrawal_preview(uuid, bigint)
CREATE OR REPLACE FUNCTION public.withdrawal_preview(p_user uuid, p_amount_kobo bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.payout_evaluate(p_user, p_amount_kobo);
END;
$$;

-- 5.4 public.request_withdrawal(uuid, bigint, text, text)
--
-- One advisory lock per user is what makes two concurrent requests safe: the
-- balance is re-read after the lock is held, so exactly one of two racing calls
-- for the same money can pass.
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user      uuid,
  p_amount_kobo bigint,
  p_kind      text,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eval       jsonb;
  v_reasons    jsonb;
  v_reason     text;
  v_account    public.payout_accounts%ROWTYPE;
  v_id         uuid;
  v_status     text;
  v_needs      boolean;
  v_gross      bigint;
  v_fee        bigint;
  v_net        bigint;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  IF p_reference IS NULL OR p_reference !~ '^[a-z0-9_-]{16,50}$' THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;

  -- One lock per user for the whole transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('payout:' || p_user::text)::bigint);

  -- The balance rows are locked too, so a concurrent posting cannot slip a
  -- debit in between the check and the write.
  PERFORM 1
     FROM public.ledger_entries e
    WHERE e.party_id = p_user
      AND e.account_id IN (3, 4)
      FOR UPDATE;

  v_eval := public.payout_evaluate(p_user, p_amount_kobo);
  v_reasons := v_eval -> 'reasons';

  IF pg_catalog.jsonb_array_length(v_reasons) > 0 THEN
    v_reason := v_reasons ->> 0;
    RAISE EXCEPTION '%', v_reason;
  END IF;

  SELECT * INTO v_account
    FROM public.payout_accounts a
   WHERE a.user_id = p_user
     AND a.status = 'active'
   ORDER BY a.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account';
  END IF;

  IF EXISTS (SELECT 1 FROM public.withdrawals w WHERE w.reference = p_reference) THEN
    RAISE EXCEPTION 'duplicate_reference';
  END IF;

  v_gross := (v_eval ->> 'gross_kobo')::bigint;
  v_fee   := (v_eval ->> 'fee_kobo')::bigint;
  v_net   := (v_eval ->> 'net_kobo')::bigint;
  v_needs := coalesce((v_eval ->> 'needs_approval')::boolean, false);
  v_status := CASE WHEN v_needs THEN 'requested' ELSE 'approved' END;

  INSERT INTO public.withdrawals (
    user_id, payout_account_id, kind, status, gross_kobo, fee_kobo, net_kobo,
    reference, requested_at,
    approved_at
  )
  VALUES (
    p_user, v_account.id, p_kind, v_status, v_gross, v_fee, v_net,
    p_reference, public.payout_now(),
    CASE WHEN v_needs THEN NULL ELSE public.payout_now() END
  )
  RETURNING id INTO v_id;

  PERFORM public.payout_post_request(v_id);

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_user, 'withdrawal.requested', 'withdrawal', v_id::text,
    pg_catalog.jsonb_build_object(
      'reference', p_reference,
      'kind', p_kind,
      'status', v_status,
      'gross_kobo', v_gross,
      'fee_kobo', v_fee,
      'net_kobo', v_net,
      'needs_approval', v_needs
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'withdrawal_id', v_id,
    'status', v_status,
    'needs_approval', v_needs
  );
END;
$$;

-- 5.5 public.approve_withdrawal(uuid, uuid, text)
CREATE OR REPLACE FUNCTION public.approve_withdrawal(
  p_actor      uuid,
  p_withdrawal uuid,
  p_note       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w        public.withdrawals%ROWTYPE;
  v_dual     bigint;
  v_is_dual  boolean;
  v_status   text;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_w.user_id = p_actor THEN
    RAISE EXCEPTION 'owner_cannot_approve';
  END IF;

  IF v_w.status <> 'requested' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF v_w.approved_by = p_actor THEN
    RAISE EXCEPTION 'already_approved_by_you';
  END IF;

  v_dual := public.commerce_setting_bigint('payout_dual_approval_kobo', 50000000);
  v_is_dual := v_w.gross_kobo > v_dual;

  INSERT INTO public.withdrawal_approvals (withdrawal_id, approver, decision, note)
  VALUES (p_withdrawal, p_actor, 'approved',
          nullif(pg_catalog.btrim(coalesce(p_note, '')), ''));

  IF v_is_dual AND v_w.approved_by IS NOT NULL THEN
    UPDATE public.withdrawals w
       SET second_approver = p_actor,
           status = 'approved',
           approved_at = public.payout_now()
     WHERE w.id = p_withdrawal;

    v_status := 'approved';
  ELSIF v_is_dual THEN
    UPDATE public.withdrawals w
       SET approved_by = p_actor
     WHERE w.id = p_withdrawal;

    v_status := 'requested';
  ELSE
    UPDATE public.withdrawals w
       SET approved_by = p_actor,
           status = 'approved',
           approved_at = public.payout_now()
     WHERE w.id = p_withdrawal;

    v_status := 'approved';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'withdrawal.approved', 'withdrawal', p_withdrawal::text,
    pg_catalog.jsonb_build_object('status', v_status, 'dual', v_is_dual)
  );

  RETURN pg_catalog.jsonb_build_object(
    'withdrawal_id', p_withdrawal,
    'status', v_status,
    'needs_second_approval', v_is_dual AND v_status = 'requested'
  );
END;
$$;

-- 5.6 public.reject_withdrawal(uuid, uuid, text)
CREATE OR REPLACE FUNCTION public.reject_withdrawal(
  p_actor      uuid,
  p_withdrawal uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w      public.withdrawals%ROWTYPE;
  v_reason text;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));

  IF char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;

  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_w.status NOT IN ('requested', 'approved') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  PERFORM public.payout_post_return(p_withdrawal);

  UPDATE public.withdrawals w
     SET status = 'rejected',
         failure_reason = pg_catalog.left(v_reason, 300),
         note = pg_catalog.left(v_reason, 300)
   WHERE w.id = p_withdrawal;

  INSERT INTO public.withdrawal_approvals (withdrawal_id, approver, decision, note)
  VALUES (p_withdrawal, p_actor, 'rejected', pg_catalog.left(v_reason, 300));

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor, 'withdrawal.rejected', 'withdrawal', p_withdrawal::text,
    pg_catalog.jsonb_build_object('reason', pg_catalog.left(v_reason, 300))
  );

  RETURN pg_catalog.jsonb_build_object('withdrawal_id', p_withdrawal, 'status', 'rejected');
END;
$$;

-- 5.7 public.cancel_withdrawal(uuid, uuid)
-- The user may withdraw the request while nobody has decided it.
CREATE OR REPLACE FUNCTION public.cancel_withdrawal(p_user uuid, p_withdrawal uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w public.withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals w WHERE w.id = p_withdrawal FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_w.user_id IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_w.status <> 'requested' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  PERFORM public.payout_post_return(p_withdrawal);

  UPDATE public.withdrawals w SET status = 'cancelled' WHERE w.id = p_withdrawal;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
  VALUES (p_user, 'withdrawal.cancelled', 'withdrawal', p_withdrawal::text);

  RETURN pg_catalog.jsonb_build_object('withdrawal_id', p_withdrawal, 'status', 'cancelled');
END;
$$;

-- 5.8 public.claim_withdrawals_for_transfer(int)
-- Hands out approved withdrawals for one transfer pass. FOR UPDATE SKIP LOCKED
-- so two workers never take the same row, and nothing at all outside the Lagos
-- payout window.
CREATE OR REPLACE FUNCTION public.claim_withdrawals_for_transfer(p_limit int DEFAULT 20)
RETURNS TABLE (
  id             uuid,
  reference      text,
  net_kobo       bigint,
  recipient_code text,
  user_id        uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := greatest(1, coalesce(p_limit, 20));
BEGIN
  IF NOT public.payout_processing_window(public.payout_now()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT w.id
      FROM public.withdrawals w
     WHERE w.status = 'approved'
     ORDER BY w.requested_at, w.id
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.withdrawals w
       SET status = 'processing',
           processed_at = public.payout_now()
      FROM picked
     WHERE w.id = picked.id
    RETURNING w.id, w.reference, w.net_kobo, w.user_id, w.payout_account_id
  )
  SELECT u.id, u.reference, u.net_kobo, a.recipient_code, u.user_id
    FROM updated u
    JOIN public.payout_accounts a ON a.id = u.payout_account_id;
END;
$$;

-- 5.9 public.release_claimed_withdrawals(uuid[])
-- Puts a claimed batch back when the Paystack balance cannot cover it. Only a
-- withdrawal with no transfer code is released: once Paystack has the request,
-- the transfer is real and only a result can settle it.
CREATE OR REPLACE FUNCTION public.release_claimed_withdrawals(p_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_ids IS NULL OR pg_catalog.cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  WITH released AS (
    UPDATE public.withdrawals w
       SET status = 'approved',
           processed_at = NULL
     WHERE w.id = ANY (p_ids)
       AND w.status = 'processing'
       AND w.paystack_transfer_code IS NULL
    RETURNING w.id
  )
  SELECT pg_catalog.count(*) INTO v_count FROM released;

  RETURN coalesce(v_count, 0);
END;
$$;

-- 5.10 public.mark_transfer_submitted(uuid, text, bigint)
CREATE OR REPLACE FUNCTION public.mark_transfer_submitted(
  p_withdrawal    uuid,
  p_transfer_code text,
  p_transfer_id   bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_withdrawal IS NULL
     OR coalesce(pg_catalog.btrim(p_transfer_code), '') = '' THEN
    RAISE EXCEPTION 'invalid_transfer';
  END IF;

  UPDATE public.withdrawals w
     SET paystack_transfer_code = pg_catalog.btrim(p_transfer_code),
         paystack_transfer_id = p_transfer_id,
         status = CASE WHEN w.status = 'approved' THEN 'processing' ELSE w.status END,
         processed_at = coalesce(w.processed_at, public.payout_now())
   WHERE w.id = p_withdrawal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$$;

-- 5.11 public.record_transfer_result(text, text, text, text, bigint)
-- The one place a Paystack result changes a withdrawal. Idempotent: the second
-- delivery of the same event returns applied = false and posts nothing.
CREATE OR REPLACE FUNCTION public.record_transfer_result(
  p_reference     text,
  p_event         text,
  p_transfer_code text DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_fee_kobo      bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w      public.withdrawals%ROWTYPE;
  v_fee    bigint;
  v_reason text;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('success', 'failed', 'reversed') THEN
    RAISE EXCEPTION 'invalid_event';
  END IF;

  SELECT * INTO v_w FROM public.withdrawals w WHERE w.reference = p_reference FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found', 'applied', false);
  END IF;

  IF coalesce(pg_catalog.btrim(p_transfer_code), '') <> ''
     AND v_w.paystack_transfer_code IS NOT NULL
     AND v_w.paystack_transfer_code <> pg_catalog.btrim(p_transfer_code) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'mismatch', 'applied', false);
  END IF;

  IF p_event = 'success' THEN
    IF v_w.status = 'paid' THEN
      RETURN pg_catalog.jsonb_build_object('status', 'paid', 'applied', false);
    END IF;

    IF v_w.status NOT IN ('processing', 'approved') THEN
      RETURN pg_catalog.jsonb_build_object('status', v_w.status, 'applied', false);
    END IF;

    v_fee := CASE
               WHEN p_fee_kobo IS NOT NULL AND p_fee_kobo > 0 THEN p_fee_kobo
               ELSE public.payout_transfer_fee(v_w.net_kobo)
             END;

    PERFORM public.payout_post_paid(v_w.id, v_fee);

    UPDATE public.withdrawals w
       SET status = 'paid',
           paid_at = public.payout_now(),
           transfer_fee_kobo = v_fee,
           paystack_transfer_code = coalesce(w.paystack_transfer_code,
                                             nullif(pg_catalog.btrim(p_transfer_code), ''))
     WHERE w.id = v_w.id;

    RETURN pg_catalog.jsonb_build_object('status', 'paid', 'applied', true);
  END IF;

  IF p_event = 'failed' THEN
    IF v_w.status IN ('failed', 'rejected', 'cancelled') THEN
      RETURN pg_catalog.jsonb_build_object('status', v_w.status, 'applied', false);
    END IF;

    IF v_w.status IN ('paid', 'reversed') THEN
      RETURN pg_catalog.jsonb_build_object('status', v_w.status, 'applied', false);
    END IF;

    v_reason := pg_catalog.left(
      nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
      300
    );

    PERFORM public.payout_post_return(v_w.id);

    UPDATE public.withdrawals w
       SET status = 'failed',
           failure_reason = v_reason,
           paystack_transfer_code = coalesce(w.paystack_transfer_code,
                                             nullif(pg_catalog.btrim(p_transfer_code), ''))
     WHERE w.id = v_w.id;

    RETURN pg_catalog.jsonb_build_object('status', 'failed', 'applied', true);
  END IF;

  -- reversed
  IF v_w.status = 'reversed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'reversed', 'applied', false);
  END IF;

  IF v_w.status IN ('failed', 'rejected', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('status', v_w.status, 'applied', false);
  END IF;

  PERFORM public.payout_post_return(v_w.id);

  UPDATE public.withdrawals w
     SET status = 'reversed',
         failure_reason = pg_catalog.left(
           coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
                    'reversed by Paystack'),
           300),
         paystack_transfer_code = coalesce(w.paystack_transfer_code,
                                           nullif(pg_catalog.btrim(p_transfer_code), ''))
   WHERE w.id = v_w.id;

  RETURN pg_catalog.jsonb_build_object('status', 'reversed', 'applied', true);
END;
$$;

-- 5.12 public.list_auto_payout_candidates(int)
CREATE OR REPLACE FUNCTION public.list_auto_payout_candidates(p_limit int DEFAULT 50)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now      timestamptz := public.payout_now();
  v_min      bigint;
  v_min_age  int;
  v_default  boolean;
  v_limit    int := greatest(1, coalesce(p_limit, 50));
BEGIN
  IF NOT public.is_payout_day(v_now) THEN
    RETURN;
  END IF;

  v_min     := public.commerce_setting_bigint('min_withdrawal_kobo', 500000);
  v_min_age := greatest(0, public.commerce_setting_int('payout_account_min_age_days', 7));
  v_default := public.commerce_setting_bool('auto_payout_default', true);

  RETURN QUERY
  SELECT a.user_id
    FROM public.payout_accounts a
    JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN public.payout_preferences pref ON pref.user_id = a.user_id
   WHERE a.status = 'active'
     AND (a.frozen_until IS NULL OR a.frozen_until <= v_now)
     AND coalesce(pref.auto_payout, v_default)
     AND p.status = 'active'
     AND p.created_at <= v_now - pg_catalog.make_interval(days => v_min_age)
     AND NOT EXISTS (
       SELECT 1
         FROM public.withdrawals w
        WHERE w.user_id = a.user_id
          AND w.status NOT IN ('failed', 'rejected', 'cancelled')
          AND (w.requested_at AT TIME ZONE 'Africa/Lagos')::date
              = (v_now AT TIME ZONE 'Africa/Lagos')::date
     )
     AND (
       SELECT coalesce(pg_catalog.sum(x.available_kobo), 0)
         FROM public.payout_available_by_account(a.user_id) x
     ) >= v_min
   ORDER BY a.user_id
   LIMIT v_limit;
END;
$$;

-- 5.13 public.list_stuck_withdrawals(interval)
CREATE OR REPLACE FUNCTION public.list_stuck_withdrawals(p_older_than interval DEFAULT '15 minutes')
RETURNS TABLE (
  id                    uuid,
  reference             text,
  status                text,
  paystack_transfer_code text,
  net_kobo              bigint,
  user_id               uuid,
  processed_at          timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.id, w.reference, w.status, w.paystack_transfer_code, w.net_kobo,
         w.user_id, w.processed_at
    FROM public.withdrawals w
   WHERE w.status = 'processing'
     AND coalesce(w.processed_at, w.requested_at)
         < public.payout_now() - coalesce(p_older_than, '15 minutes'::interval)
   ORDER BY coalesce(w.processed_at, w.requested_at)
   LIMIT 100;
$$;

-- 5.14 public.get_withdrawal_for_approval(text)
-- What the transfer-approval endpoint compares against. The recipient code and
-- the net amount only: nothing that identifies the bank account.
CREATE OR REPLACE FUNCTION public.get_withdrawal_for_approval(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_w public.withdrawals%ROWTYPE;
  v_a public.payout_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals w WHERE w.reference = p_reference;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_a FROM public.payout_accounts a WHERE a.id = v_w.payout_account_id;

  RETURN pg_catalog.jsonb_build_object(
    'found', true,
    'status', v_w.status,
    'net_kobo', v_w.net_kobo,
    'recipient_code', coalesce(v_a.recipient_code, ''),
    'transfer_code', v_w.paystack_transfer_code
  );
END;
$$;

-- 5.15 public.admin_withdrawals(uuid, text, int, jsonb)
CREATE OR REPLACE FUNCTION public.admin_withdrawals(
  p_actor  uuid,
  p_status text DEFAULT NULL,
  p_limit  int DEFAULT 50,
  p_cursor jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit   int := least(greatest(1, coalesce(p_limit, 50)), 100);
  v_rows    jsonb;
  v_next    jsonb;
  v_ts      timestamptz;
  v_id      uuid;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'requested_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT w.id, w.user_id, w.reference, w.kind, w.status, w.gross_kobo,
           w.fee_kobo, w.net_kobo, w.requested_at, w.paid_at, w.failure_reason,
           w.approved_at, w.second_approver IS NOT NULL AS dual_approved
      FROM public.withdrawals w
     WHERE (p_status IS NULL OR w.status = p_status)
       AND (
         v_ts IS NULL
         OR w.requested_at < v_ts
         OR (w.requested_at = v_ts AND w.id < v_id)
       )
     ORDER BY w.requested_at DESC, w.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) ORDER BY page.requested_at DESC, page.id DESC), '[]'::jsonb),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'requested_at', pg_catalog.min(page.requested_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_rows, v_next
    FROM page;

  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'next_cursor', v_next);
END;
$$;

-- 5.16 public.payout_overview(uuid)
CREATE OR REPLACE FUNCTION public.payout_overview(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now      timestamptz := public.payout_now();
  v_counts   jsonb := '{}'::jsonb;
  v_kobo     jsonb := '{}'::jsonb;
  v_status   text;
  v_oldest   numeric;
  v_failed   int;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOREACH v_status IN ARRAY ARRAY[
    'requested', 'approved', 'processing', 'paid', 'failed', 'reversed', 'rejected', 'cancelled'
  ] LOOP
    v_counts := v_counts || pg_catalog.jsonb_build_object(
      v_status,
      (SELECT pg_catalog.count(*) FROM public.withdrawals w WHERE w.status = v_status)
    );

    v_kobo := v_kobo || pg_catalog.jsonb_build_object(
      v_status,
      (SELECT coalesce(pg_catalog.sum(w.gross_kobo), 0) FROM public.withdrawals w WHERE w.status = v_status)
    );
  END LOOP;

  SELECT pg_catalog.max(
           extract(epoch FROM (v_now - w.requested_at))
         )
    INTO v_oldest
    FROM public.withdrawals w
   WHERE w.status = 'requested';

  SELECT pg_catalog.count(*)
    INTO v_failed
    FROM public.withdrawals w
   WHERE w.status IN ('failed', 'reversed')
     AND coalesce(w.processed_at, w.requested_at) > v_now - '7 days'::interval;

  RETURN pg_catalog.jsonb_build_object(
    'counts', v_counts,
    'gross_kobo', v_kobo,
    'oldest_requested_seconds', coalesce(v_oldest, 0),
    'failed_last_7_days', v_failed
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row level security
-- No client role may write any table here. A user reads their own payout
-- account through the view, which has no recipient_code column, and their own
-- preferences and withdrawals.
-- ----------------------------------------------------------------------------
ALTER TABLE public.payout_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_approvals  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_accounts_select_owner ON public.payout_accounts;
CREATE POLICY payout_accounts_select_owner
  ON public.payout_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS payout_accounts_select_admin_finance ON public.payout_accounts;
CREATE POLICY payout_accounts_select_admin_finance
  ON public.payout_accounts
  FOR SELECT
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin') OR public.has_role((select auth.uid()), 'finance'));

DROP POLICY IF EXISTS payout_preferences_select_owner ON public.payout_preferences;
CREATE POLICY payout_preferences_select_owner
  ON public.payout_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS payout_preferences_select_admin_finance ON public.payout_preferences;
CREATE POLICY payout_preferences_select_admin_finance
  ON public.payout_preferences
  FOR SELECT
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin') OR public.has_role((select auth.uid()), 'finance'));

DROP POLICY IF EXISTS withdrawals_select_owner ON public.withdrawals;
CREATE POLICY withdrawals_select_owner
  ON public.withdrawals
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS withdrawals_select_admin_finance ON public.withdrawals;
CREATE POLICY withdrawals_select_admin_finance
  ON public.withdrawals
  FOR SELECT
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin') OR public.has_role((select auth.uid()), 'finance'));

DROP POLICY IF EXISTS withdrawal_approvals_select_admin_finance ON public.withdrawal_approvals;
CREATE POLICY withdrawal_approvals_select_admin_finance
  ON public.withdrawal_approvals
  FOR SELECT
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin') OR public.has_role((select auth.uid()), 'finance'));

-- 6.1 public.payout_accounts_safe
-- The only way a signed-in user reads a payout account. security_invoker makes
-- the view run with the caller's rights, so the policy above decides which rows
-- it sees; the view itself never exposes recipient_code.
DROP VIEW IF EXISTS public.payout_accounts_safe;
CREATE VIEW public.payout_accounts_safe
WITH (security_invoker = true)
AS
  SELECT a.id,
         a.user_id,
         a.bank_code,
         a.bank_name,
         a.account_last4,
         a.account_name,
         a.name_match,
         a.status,
         a.frozen_until,
         a.created_at
    FROM public.payout_accounts a;

-- ----------------------------------------------------------------------------
-- 7. Privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.payout_accounts, public.payout_preferences, public.withdrawals,
  public.withdrawal_approvals
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.payout_accounts_safe FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.payout_preferences   TO authenticated;
GRANT SELECT ON TABLE public.withdrawals          TO authenticated;
GRANT SELECT ON TABLE public.withdrawal_approvals TO authenticated;
GRANT SELECT ON TABLE public.payout_accounts_safe TO authenticated;

-- Column privileges, not table privileges: the view runs with the caller's
-- rights (security_invoker), so it needs SELECT on the columns it projects, and
-- recipient_code is deliberately not one of them. A direct SELECT of
-- recipient_code is refused by the grant, not by a policy.
GRANT SELECT (
  id, user_id, bank_code, bank_name, account_last4, account_name,
  name_match, status, frozen_until, created_at
) ON TABLE public.payout_accounts TO authenticated;

REVOKE ALL ON FUNCTION public.payout_now() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_transfer_fee(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_processing_window(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_next_day(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_available_by_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_needs_approval(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_evaluate(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_debit_split(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_post_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_post_paid(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_post_return(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_payout_account(uuid, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_auto_payout(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdrawal_preview(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_withdrawal(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_withdrawal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_withdrawals_for_transfer(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_claimed_withdrawals(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_transfer_submitted(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_transfer_result(text, text, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_auto_payout_candidates(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_stuck_withdrawals(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_withdrawal_for_approval(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_withdrawals(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_overview(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payout_now() TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_transfer_fee(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_processing_window(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_next_day(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_available_by_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_needs_approval(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_evaluate(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_debit_split(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_post_request(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_post_paid(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_post_return(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_payout_account(uuid, text, text, text, text, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_auto_payout(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_preview(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_withdrawal(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_withdrawals_for_transfer(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_claimed_withdrawals(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_transfer_submitted(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_transfer_result(text, text, text, text, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_auto_payout_candidates(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_stuck_withdrawals(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_for_approval(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_withdrawals(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_overview(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261122000100', 'payouts')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops every payout account, preference and withdrawal, and the
-- ledger entries those withdrawals posted stay behind (the ledger is append-only
-- and is not touched). Take a backup first.
-- ============================================================================
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS withdrawal_approvals_select_admin_finance ON public.withdrawal_approvals;
-- DROP POLICY IF EXISTS withdrawals_select_admin_finance ON public.withdrawals;
-- DROP POLICY IF EXISTS withdrawals_select_owner ON public.withdrawals;
-- DROP POLICY IF EXISTS payout_preferences_select_admin_finance ON public.payout_preferences;
-- DROP POLICY IF EXISTS payout_preferences_select_owner ON public.payout_preferences;
-- DROP POLICY IF EXISTS payout_accounts_select_admin_finance ON public.payout_accounts;
-- DROP POLICY IF EXISTS payout_accounts_select_owner ON public.payout_accounts;
--
-- DROP VIEW IF EXISTS public.payout_accounts_safe;
-- DROP TABLE IF EXISTS public.withdrawal_approvals;
-- DROP TABLE IF EXISTS public.withdrawals;
-- DROP TABLE IF EXISTS public.payout_preferences;
-- DROP TABLE IF EXISTS public.payout_accounts;
--
-- DROP FUNCTION IF EXISTS public.payout_overview(uuid);
-- DROP FUNCTION IF EXISTS public.admin_withdrawals(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.get_withdrawal_for_approval(text);
-- DROP FUNCTION IF EXISTS public.list_stuck_withdrawals(interval);
-- DROP FUNCTION IF EXISTS public.list_auto_payout_candidates(int);
-- DROP FUNCTION IF EXISTS public.record_transfer_result(text, text, text, text, bigint);
-- DROP FUNCTION IF EXISTS public.mark_transfer_submitted(uuid, text, bigint);
-- DROP FUNCTION IF EXISTS public.release_claimed_withdrawals(uuid[]);
-- DROP FUNCTION IF EXISTS public.claim_withdrawals_for_transfer(int);
-- DROP FUNCTION IF EXISTS public.cancel_withdrawal(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.reject_withdrawal(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.approve_withdrawal(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.request_withdrawal(uuid, bigint, text, text);
-- DROP FUNCTION IF EXISTS public.withdrawal_preview(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.set_auto_payout(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.set_payout_account(uuid, text, text, text, text, text, boolean);
-- DROP FUNCTION IF EXISTS public.payout_post_return(uuid);
-- DROP FUNCTION IF EXISTS public.payout_post_paid(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.payout_post_request(uuid);
-- DROP FUNCTION IF EXISTS public.payout_debit_split(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.payout_evaluate(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.payout_needs_approval(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.payout_available_by_account(uuid);
-- DROP FUNCTION IF EXISTS public.payout_next_day(timestamptz);
-- DROP FUNCTION IF EXISTS public.payout_processing_window(timestamptz);
-- DROP FUNCTION IF EXISTS public.payout_transfer_fee(bigint);
-- DROP FUNCTION IF EXISTS public.payout_now();
--
-- DELETE FROM public.app_migrations WHERE version = '20261122000100';
--
-- COMMIT;
-- ============================================================================
