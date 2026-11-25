-- ============================================================================
-- Migration 20261123000100_payout_controls
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: step-up codes (a short code emailed before a bank change or a
--        withdrawal), a validated update_setting for the payout and fee
--        settings, list_blackout_dates, and the two read models the payout
--        screens use (the user screen and the admin queue). Database only.
-- Depends on: 20261112000100_foundation (settings, settings_history, audit_log,
--        profiles, has_role), 20261116000200_commerce_core (commerce_setting*,
--        payout_blackout_dates, is_payout_day, get_party_balance),
--        20261122000100_payouts (payout_now, payout_next_day, payout_accounts,
--        payout_preferences, withdrawals).
-- This file is idempotent: running it twice must not raise an error.
--
-- Step-up codes: the server stores only an HMAC of the code, never the code.
-- Every time decision reads public.payout_now() so the harness can place the
-- clock; production leaves the override unset.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.step_up_codes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.step_up_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('bank_change', 'withdrawal')),
  code_hash  text        NOT NULL CHECK (char_length(code_hash) BETWEEN 16 AND 200),
  expires_at timestamptz NOT NULL,
  attempts   int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS step_up_codes_user_purpose_idx
  ON public.step_up_codes (user_id, purpose, created_at DESC);

ALTER TABLE public.step_up_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.step_up_codes FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. public.create_step_up_code(uuid, text, text, int)
-- 60 second cooldown, at most 5 codes per hour per user and purpose, and every
-- older unused code is invalidated when a new one is issued.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_step_up_code(
  p_user               uuid,
  p_purpose            text,
  p_code_hash          text,
  p_expires_in_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now      timestamptz := public.payout_now();
  v_last     timestamptz;
  v_oldest   timestamptz;
  v_count    int;
  v_retry    int := 0;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user) THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  IF p_purpose IS NULL OR p_purpose NOT IN ('bank_change', 'withdrawal') THEN
    RAISE EXCEPTION 'invalid_purpose';
  END IF;

  IF p_code_hash IS NULL OR char_length(p_code_hash) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'invalid_code_hash';
  END IF;

  IF p_expires_in_seconds IS NULL OR p_expires_in_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'invalid_expiry';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('stepup:' || p_user::text || ':' || p_purpose)::bigint
  );

  SELECT max(c.created_at) INTO v_last
    FROM public.step_up_codes c
   WHERE c.user_id = p_user AND c.purpose = p_purpose;

  IF v_last IS NOT NULL AND v_last + interval '60 seconds' > v_now THEN
    v_retry := greatest(
      v_retry,
      pg_catalog.ceil(extract(epoch FROM (v_last + interval '60 seconds' - v_now)))::int
    );
  END IF;

  SELECT count(*), min(c.created_at)
    INTO v_count, v_oldest
    FROM (
      SELECT c2.created_at
        FROM public.step_up_codes c2
       WHERE c2.user_id = p_user
         AND c2.purpose = p_purpose
         AND c2.created_at > v_now - interval '1 hour'
       ORDER BY c2.created_at DESC
       LIMIT 5
    ) c;

  IF v_count >= 5 THEN
    v_retry := greatest(
      v_retry,
      pg_catalog.ceil(extract(epoch FROM (v_oldest + interval '1 hour' - v_now)))::int
    );
  END IF;

  IF v_retry > 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'retry_after_seconds', v_retry);
  END IF;

  UPDATE public.step_up_codes c
     SET used_at = v_now
   WHERE c.user_id = p_user
     AND c.purpose = p_purpose
     AND c.used_at IS NULL;

  INSERT INTO public.step_up_codes (user_id, purpose, code_hash, expires_at, created_at)
  VALUES (p_user, p_purpose, p_code_hash, v_now + pg_catalog.make_interval(secs => p_expires_in_seconds), v_now);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'retry_after_seconds', 0);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. public.verify_step_up_code(uuid, text, text)
-- Only the newest unused, unexpired code of that user and purpose is checked.
-- A wrong guess counts; the fifth wrong guess voids the code. A right guess
-- uses the code up.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_step_up_code(
  p_user      uuid,
  p_purpose   text,
  p_code_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now  timestamptz := public.payout_now();
  v_code public.step_up_codes%ROWTYPE;
BEGIN
  IF p_user IS NULL OR p_purpose IS NULL OR p_code_hash IS NULL
     OR p_purpose NOT IN ('bank_change', 'withdrawal') THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('stepup:' || p_user::text || ':' || p_purpose)::bigint
  );

  SELECT * INTO v_code
    FROM public.step_up_codes c
   WHERE c.user_id = p_user
     AND c.purpose = p_purpose
     AND c.used_at IS NULL
     AND c.expires_at > v_now
   ORDER BY c.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_code.attempts >= 5 THEN
    UPDATE public.step_up_codes c SET used_at = v_now WHERE c.id = v_code.id;
    RETURN false;
  END IF;

  IF v_code.code_hash = p_code_hash THEN
    UPDATE public.step_up_codes c SET used_at = v_now WHERE c.id = v_code.id;
    RETURN true;
  END IF;

  UPDATE public.step_up_codes c
     SET attempts = c.attempts + 1,
         used_at = CASE WHEN c.attempts + 1 >= 5 THEN v_now ELSE NULL END
   WHERE c.id = v_code.id;

  RETURN false;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. public.update_setting(uuid, text, jsonb)
-- Admin or finance only, and only these keys. Type and range are checked here,
-- not just in the form. The actor is placed on the transaction so the existing
-- settings trigger records who changed it in settings_history.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_setting(
  p_actor uuid,
  p_key   text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_num    numeric;
  v_old    jsonb;
  v_prev   text;
  v_other  bigint;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_key IS NULL OR p_key NOT IN (
    'withdrawal_fee_bps', 'withdrawal_fee_min_kobo', 'withdrawal_fee_cap_kobo',
    'min_withdrawal_kobo', 'payout_auto_approve_max_kobo', 'payout_dual_approval_kobo',
    'payout_first_requires_approval', 'withdrawal_daily_limit_kobo',
    'platform_fee_bps', 'commission_hold_days', 'auto_payout_default'
  ) THEN
    RAISE EXCEPTION 'setting_not_allowed';
  END IF;

  IF p_value IS NULL THEN
    RAISE EXCEPTION 'invalid_value';
  END IF;

  IF p_key IN ('payout_first_requires_approval', 'auto_payout_default') THEN
    IF pg_catalog.jsonb_typeof(p_value) <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_value';
    END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(p_value) <> 'number' THEN
      RAISE EXCEPTION 'invalid_value';
    END IF;

    v_num := (p_value #>> '{}')::numeric;

    IF v_num <> pg_catalog.trunc(v_num) THEN
      RAISE EXCEPTION 'invalid_value';
    END IF;

    IF p_key = 'withdrawal_fee_bps' AND v_num NOT BETWEEN 0 AND 1000 THEN
      RAISE EXCEPTION 'out_of_range';
    ELSIF p_key = 'platform_fee_bps' AND v_num NOT BETWEEN 0 AND 3000 THEN
      RAISE EXCEPTION 'out_of_range';
    ELSIF p_key = 'commission_hold_days' AND v_num NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION 'out_of_range';
    ELSIF p_key = 'min_withdrawal_kobo' AND v_num NOT BETWEEN 1 AND 1000000000000 THEN
      RAISE EXCEPTION 'out_of_range';
    ELSIF p_key IN (
      'withdrawal_fee_min_kobo', 'withdrawal_fee_cap_kobo',
      'payout_auto_approve_max_kobo', 'payout_dual_approval_kobo',
      'withdrawal_daily_limit_kobo'
    ) AND v_num NOT BETWEEN 0 AND 1000000000000 THEN
      RAISE EXCEPTION 'out_of_range';
    END IF;

    -- Pairs that must stay in order, checked against the stored counterpart.
    IF p_key = 'withdrawal_fee_min_kobo' THEN
      v_other := public.commerce_setting_bigint('withdrawal_fee_cap_kobo', 200000);
      IF v_num > v_other THEN RAISE EXCEPTION 'invalid_combination'; END IF;
    ELSIF p_key = 'withdrawal_fee_cap_kobo' THEN
      v_other := public.commerce_setting_bigint('withdrawal_fee_min_kobo', 5000);
      IF v_num < v_other THEN RAISE EXCEPTION 'invalid_combination'; END IF;
    ELSIF p_key = 'payout_dual_approval_kobo' THEN
      v_other := public.commerce_setting_bigint('payout_auto_approve_max_kobo', 10000000);
      IF v_num < v_other THEN RAISE EXCEPTION 'invalid_combination'; END IF;
    ELSIF p_key = 'payout_auto_approve_max_kobo' THEN
      v_other := public.commerce_setting_bigint('payout_dual_approval_kobo', 50000000);
      IF v_num > v_other THEN RAISE EXCEPTION 'invalid_combination'; END IF;
    END IF;
  END IF;

  SELECT s.value INTO v_old FROM public.settings s WHERE s.key = p_key;

  IF v_old IS NOT DISTINCT FROM p_value THEN
    RETURN;
  END IF;

  v_prev := pg_catalog.current_setting('request.jwt.claim.sub', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);

  INSERT INTO public.settings (key, value, updated_by)
  VALUES (p_key, p_value, p_actor)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (
    p_actor, 'setting.updated', 'setting', p_key,
    pg_catalog.jsonb_build_object('value', v_old),
    pg_catalog.jsonb_build_object('value', p_value)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. public.list_blackout_dates(date, date)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_blackout_dates(p_from date, p_to date)
RETURNS TABLE (day date, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  RETURN QUERY
    SELECT b.day, b.reason
      FROM public.payout_blackout_dates b
     WHERE b.day BETWEEN p_from AND p_to
     ORDER BY b.day;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. public.get_payout_screen_data(uuid)
-- One round trip for the payout screens. Never returns a recipient code, a
-- Paystack reference or an admin's private note; the rejection reason is the
-- only free text and it is written for the user.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payout_screen_data(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now      timestamptz := public.payout_now();
  v_today    date := (public.payout_now() AT TIME ZONE 'Africa/Lagos')::date;
  v_account  jsonb;
  v_auto     boolean;
  v_balance  jsonb;
  v_is_day   boolean;
  v_reason   text;
  v_list     jsonb;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user) THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'bank_name', a.bank_name,
           'account_last4', a.account_last4,
           'account_name', a.account_name,
           'frozen_until', CASE WHEN a.frozen_until > v_now THEN a.frozen_until ELSE NULL END
         )
    INTO v_account
    FROM public.payout_accounts a
   WHERE a.user_id = p_user AND a.status = 'active'
   ORDER BY a.created_at DESC
   LIMIT 1;

  SELECT coalesce(
           (SELECT pp.auto_payout FROM public.payout_preferences pp WHERE pp.user_id = p_user),
           public.commerce_setting_bool('auto_payout_default', true)
         )
    INTO v_auto;

  v_balance := public.get_party_balance(p_user);
  v_is_day := public.is_payout_day(v_now);

  SELECT b.reason INTO v_reason
    FROM public.payout_blackout_dates b
   WHERE b.day = v_today;

  SELECT coalesce(pg_catalog.jsonb_agg(x.row ORDER BY x.requested_at DESC), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT w.requested_at,
             pg_catalog.jsonb_build_object(
               'id', w.id,
               'kind', w.kind,
               'status', w.status,
               'gross_kobo', w.gross_kobo,
               'fee_kobo', w.fee_kobo,
               'net_kobo', w.net_kobo,
               'requested_at', w.requested_at,
               'paid_at', w.paid_at,
               'reason', CASE WHEN w.status = 'rejected' THEN w.note ELSE NULL END
             ) AS row
        FROM public.withdrawals w
       WHERE w.user_id = p_user
       ORDER BY w.requested_at DESC
       LIMIT 20
    ) x;

  RETURN pg_catalog.jsonb_build_object(
    'account', v_account,
    'auto_payout', v_auto,
    'available_kobo', (v_balance ->> 'available_kobo')::bigint,
    'pending_kobo', (v_balance ->> 'pending_kobo')::bigint,
    'total_kobo', (v_balance ->> 'total_kobo')::bigint,
    'today', v_today,
    'next_payout_day', public.payout_next_day(v_now),
    'today_is_payout_day', v_is_day,
    'blackout_reason', CASE WHEN v_is_day THEN NULL ELSE v_reason END,
    'settings', pg_catalog.jsonb_build_object(
      'min_withdrawal_kobo', public.commerce_setting_bigint('min_withdrawal_kobo', 500000),
      'withdrawal_fee_bps', public.commerce_setting_bigint('withdrawal_fee_bps', 200),
      'withdrawal_fee_min_kobo', public.commerce_setting_bigint('withdrawal_fee_min_kobo', 5000),
      'withdrawal_fee_cap_kobo', public.commerce_setting_bigint('withdrawal_fee_cap_kobo', 200000),
      'commission_hold_days', public.commerce_setting_int('commission_hold_days', 7)
    ),
    'withdrawals', v_list
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. public.admin_withdrawal_queue(uuid, text, int, jsonb)
-- The admin queue with everything a decision needs in one page: the bank (name,
-- last four, account name), whether it is the user's first withdrawal, an
-- unresolved risk flag, and the approvals so far. Admin or finance only. The
-- tab is one of needs_approval, processing, paid, closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_withdrawal_queue(
  p_actor  uuid,
  p_tab    text,
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
  v_limit    int := least(greatest(1, coalesce(p_limit, 50)), 100);
  v_statuses text[];
  v_dual     bigint;
  v_rows     jsonb;
  v_next     jsonb;
  v_ts       timestamptz;
  v_id       uuid;
BEGIN
  IF p_actor IS NULL
     OR NOT (public.has_role(p_actor, 'admin') OR public.has_role(p_actor, 'finance')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_statuses := CASE p_tab
    WHEN 'needs_approval' THEN ARRAY['requested']
    WHEN 'processing'     THEN ARRAY['approved', 'processing']
    WHEN 'paid'           THEN ARRAY['paid']
    WHEN 'closed'         THEN ARRAY['failed', 'reversed', 'rejected', 'cancelled']
    ELSE NULL
  END;

  IF v_statuses IS NULL THEN
    RAISE EXCEPTION 'invalid_tab';
  END IF;

  v_dual := public.commerce_setting_bigint('payout_dual_approval_kobo', 50000000);

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'requested_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT w.id, w.user_id, w.kind, w.status, w.gross_kobo, w.fee_kobo, w.net_kobo,
           w.requested_at, w.paid_at, w.failure_reason,
           a.bank_name, a.account_last4, a.account_name,
           NOT EXISTS (
             SELECT 1 FROM public.withdrawals e
              WHERE e.user_id = w.user_id
                AND (e.requested_at, e.id) < (w.requested_at, w.id)
           ) AS is_first,
           EXISTS (
             SELECT 1 FROM public.risk_flags f
              WHERE f.affiliate_id = w.user_id AND f.resolved_at IS NULL
           ) AS has_risk_flag,
           (SELECT count(DISTINCT ap.approver)::int
              FROM public.withdrawal_approvals ap
             WHERE ap.withdrawal_id = w.id AND ap.decision = 'approved') AS approvals,
           w.gross_kobo > v_dual AS needs_two_approvers,
           w.status = 'requested' AND w.gross_kobo > v_dual
             AND w.approved_by IS NOT NULL AND w.second_approver IS NULL AS needs_second_approver,
           w.approved_by AS first_approver
      FROM public.withdrawals w
      JOIN public.payout_accounts a ON a.id = w.payout_account_id
     WHERE w.status = ANY (v_statuses)
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

-- ----------------------------------------------------------------------------
-- 7b. email_log can now hold a withdrawal notice
-- A withdrawal notice (paid, failed, reversed, rejected) is claimed in the same
-- table as the order emails so a retried job can never send it twice. The row
-- points at a withdrawal instead of an order: exactly one of the two is set.
-- Existing rows all have an order and are untouched.
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_log ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS withdrawal_id uuid
  REFERENCES public.withdrawals (id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.email_log'::regclass AND conname = 'email_log_one_subject'
  ) THEN
    ALTER TABLE public.email_log
      ADD CONSTRAINT email_log_one_subject
      CHECK (num_nonnulls(order_id, withdrawal_id) = 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS email_log_withdrawal_one_per_recipient
  ON public.email_log (kind, withdrawal_id, recipient_hash)
  WHERE withdrawal_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. Privileges: service_role only
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_step_up_code(uuid, text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_step_up_code(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_setting(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_blackout_dates(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payout_screen_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_withdrawal_queue(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_step_up_code(uuid, text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_step_up_code(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_setting(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_blackout_dates(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_screen_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_queue(uuid, text, int, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 9. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261123000100', 'payout_controls')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops every step-up code and every withdrawal notice claim. Settings changes already made through
-- update_setting stay (they are rows in settings, settings_history, audit_log).
-- ============================================================================
--
-- BEGIN;
--
-- DELETE FROM public.email_log WHERE withdrawal_id IS NOT NULL;
-- DROP INDEX IF EXISTS public.email_log_withdrawal_one_per_recipient;
-- ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_one_subject;
-- ALTER TABLE public.email_log DROP COLUMN IF EXISTS withdrawal_id;
-- ALTER TABLE public.email_log ALTER COLUMN order_id SET NOT NULL;
--
-- DROP FUNCTION IF EXISTS public.admin_withdrawal_queue(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.get_payout_screen_data(uuid);
-- DROP FUNCTION IF EXISTS public.list_blackout_dates(date, date);
-- DROP FUNCTION IF EXISTS public.update_setting(uuid, text, jsonb);
-- DROP FUNCTION IF EXISTS public.verify_step_up_code(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.create_step_up_code(uuid, text, text, int);
-- DROP TABLE IF EXISTS public.step_up_codes;
--
-- DELETE FROM public.app_migrations WHERE version = '20261123000100';
--
-- COMMIT;
-- ============================================================================
