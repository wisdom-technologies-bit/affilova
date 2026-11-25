-- ============================================================================
-- Migration 20261124000100_admin_finance
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope: the read models behind the admin finance screens (overview, orders,
--        refunds, disputes, ledger, trial balance, reconciliation, VAT), the
--        dispute outcome record, the daily reconciliation run, and the VAT
--        reminder targets. Database only: no page, no component and no
--        application code is created or changed here.
-- Depends on: 20261112000100_foundation (settings, audit_log, profiles,
--        user_roles, has_role),
--        20261116000200_commerce_core (orders, order_items, order_tax_lines,
--        entitlements, refund_requests, order_disputes, ledger_accounts,
--        ledger_transactions, ledger_entries, vat_periods, vat_adjustments,
--        vat_period_summary, resolve_dispute),
--        20261117000100_checkout_support (webhook_events),
--        20261117000200_email_log (email_log),
--        20261122000100_payouts (withdrawals),
--        20261123000100_payout_controls (email_log.withdrawal_id).
-- This file is idempotent: running it twice must not raise an error.
--
-- Every read function takes the actor id first and checks the role inside, so a
-- caller that forgets the check in the application still cannot read money it
-- may not see. Money is an integer number of kobo (bigint) everywhere.
--
-- Two rules run through the whole file:
--   * a buyer's email leaves these functions masked (first letter and domain)
--     except in the order detail, for admin and support only, and that read
--     writes an audit row;
--   * nothing here moves money except resolve_dispute (existing) and
--     retry_refund_submission (which only re-queues an existing refund). A
--     provider's dispute outcome is recorded, never acted on: a person decides.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Dispute outcome columns
--
-- Paystack tells us how a dispute ended. That is evidence, not a decision: the
-- money moves only when a person calls resolve_dispute. provider_resolution
-- holds the provider's own word, provider_resolved_at when it arrived, and
-- needs_decision marks the row for the admin queue.
-- ----------------------------------------------------------------------------
ALTER TABLE public.order_disputes
  ADD COLUMN IF NOT EXISTS provider_resolution   text,
  ADD COLUMN IF NOT EXISTS provider_resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS needs_decision        boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.order_disputes'::regclass
       AND conname = 'order_disputes_provider_resolution_length'
  ) THEN
    ALTER TABLE public.order_disputes
      ADD CONSTRAINT order_disputes_provider_resolution_length
      CHECK (provider_resolution IS NULL OR char_length(provider_resolution) BETWEEN 1 AND 100);
  END IF;
END $$;

-- The admin queue asks for the rows that need a person, most urgent first.
CREATE INDEX IF NOT EXISTS order_disputes_needs_decision_idx
  ON public.order_disputes (opened_at DESC)
  WHERE needs_decision;

-- ----------------------------------------------------------------------------
-- 2. public.reconciliation_runs
--
-- One row per daily reconciliation: what our ledger says the Paystack balance
-- is, what Paystack says, and the difference. Append-only in practice: nothing
-- in the application updates or deletes a row. Service role only, no policies.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at                       timestamptz NOT NULL DEFAULT now(),
  ledger_paystack_balance_kobo bigint      NOT NULL,
  provider_balance_kobo        bigint      NOT NULL,
  diff_kobo                    bigint      NOT NULL,
  details                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT reconciliation_runs_diff_matches
    CHECK (diff_kobo = ledger_paystack_balance_kobo - provider_balance_kobo)
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_run_at_idx
  ON public.reconciliation_runs (run_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Helpers
-- ----------------------------------------------------------------------------

-- 3.1 public.staff_has_any_role(uuid, public.app_role[])
-- One role check, used by every function below. A revoked role does not count,
-- and a null actor never passes.
CREATE OR REPLACE FUNCTION public.staff_has_any_role(
  p_actor uuid,
  p_roles public.app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor IS NOT NULL
     AND p_roles IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
        WHERE ur.user_id = p_actor
          AND ur.status = 'active'
          AND ur.role = ANY (p_roles)
     );
$$;

-- 3.2 public.mask_email(text)
-- a***@gmail.com: the first letter and the domain, nothing else. Used by every
-- list, and by the order detail for a role that may not see the whole address.
CREATE OR REPLACE FUNCTION public.mask_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN p_email IS NULL OR pg_catalog.btrim(p_email) = '' THEN NULL
           WHEN pg_catalog.strpos(p_email, '@') = 0 THEN pg_catalog.left(pg_catalog.btrim(p_email), 1) || '***'
           ELSE pg_catalog.left(pg_catalog.btrim(p_email), 1) || '***@'
                || pg_catalog.split_part(pg_catalog.btrim(p_email), '@', 2)
         END;
$$;

-- 3.3 public.account_balance(bigint, timestamptz)
-- The signed balance of one account: debits minus credits, up to p_as_of.
--   asset, expense      positive means we hold or spent that much
--   liability, revenue  negative means we owe or earned that much
CREATE OR REPLACE FUNCTION public.account_balance(
  p_account_id smallint,
  p_as_of      timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
           pg_catalog.sum(e.debit_kobo) - pg_catalog.sum(e.credit_kobo),
           0
         )::bigint
    FROM public.ledger_entries e
   WHERE e.account_id = p_account_id
     AND (p_as_of IS NULL OR e.created_at < p_as_of);
$$;

-- 3.4 public.ledger_window(p_from, p_to)
-- Refuses a range that is missing, backwards, or longer than 366 days, with the
-- same error every read model uses.
CREATE OR REPLACE FUNCTION public.admin_finance_range_ok(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_from IS NOT NULL
     AND p_to IS NOT NULL
     AND p_from < p_to
     AND p_to - p_from <= pg_catalog.make_interval(days => 366);
$$;

-- ----------------------------------------------------------------------------
-- 4. Write functions
-- ----------------------------------------------------------------------------

-- 4.1 public.record_dispute_provider_outcome(text, text, text)
--
-- Called by the Paystack webhook when a dispute is resolved. It stores what the
-- provider said and flags the dispute for a person. It deliberately does not
-- touch the order, the entitlements or the ledger: resolve_dispute is the only
-- path that moves money, and only an admin or finance member may call it.
CREATE OR REPLACE FUNCTION public.record_dispute_provider_outcome(
  p_reference  text,
  p_resolution text,
  p_note       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reference  text := pg_catalog.btrim(coalesce(p_reference, ''));
  v_resolution text := pg_catalog.btrim(coalesce(p_resolution, ''));
  v_note       text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_order      public.orders;
  v_dispute    public.order_disputes;
BEGIN
  IF v_reference = '' THEN
    RAISE EXCEPTION 'invalid_reference';
  END IF;

  IF v_resolution = '' OR char_length(v_resolution) > 100 THEN
    RAISE EXCEPTION 'invalid_resolution';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.paystack_reference = v_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_dispute
    FROM public.order_disputes d
   WHERE d.order_id = v_order.id
     AND d.outcome = 'open'
   ORDER BY d.opened_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_dispute';
  END IF;

  UPDATE public.order_disputes
     SET provider_resolution  = v_resolution,
         provider_resolved_at = pg_catalog.now(),
         needs_decision       = true
   WHERE id = v_dispute.id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    NULL,
    'dispute.provider_outcome',
    'order',
    v_order.id::text,
    pg_catalog.jsonb_build_object(
      'order_number', v_order.number,
      'dispute_id', v_dispute.id,
      'provider_resolution', v_resolution,
      'note', v_note
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'recorded',
    'order_id', v_order.id,
    'dispute_id', v_dispute.id,
    'provider_resolution', v_resolution,
    'needs_decision', true
  );
END;
$$;

-- 4.2 public.record_reconciliation_run(bigint)
--
-- The daily job asks Paystack for its balance and records the difference against
-- the ledger's paystack_balance account. The application logs at error level
-- when the absolute difference is large; nothing here fails because of a
-- mismatch, because a mismatch is information, not an outage.
CREATE OR REPLACE FUNCTION public.record_reconciliation_run(
  p_provider_balance_kobo bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ledger   bigint;
  v_entries  bigint;
  v_id       bigint;
  v_run_at   timestamptz := pg_catalog.now();
  v_diff     bigint;
BEGIN
  IF p_provider_balance_kobo IS NULL THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT coalesce(pg_catalog.sum(e.debit_kobo) - pg_catalog.sum(e.credit_kobo), 0),
         pg_catalog.count(*)
    INTO v_ledger, v_entries
    FROM public.ledger_entries e
   WHERE e.account_id = 1;

  v_diff := v_ledger - p_provider_balance_kobo;

  INSERT INTO public.reconciliation_runs (
    run_at, ledger_paystack_balance_kobo, provider_balance_kobo, diff_kobo, details
  )
  VALUES (
    v_run_at,
    v_ledger,
    p_provider_balance_kobo,
    v_diff,
    pg_catalog.jsonb_build_object(
      'account', 'paystack_balance',
      'ledger_entries', v_entries
    )
  )
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id,
    'run_at', v_run_at,
    'ledger_paystack_balance_kobo', v_ledger,
    'provider_balance_kobo', p_provider_balance_kobo,
    'diff_kobo', v_diff
  );
END;
$$;

-- 4.3 public.retry_refund_submission(uuid, uuid)
--
-- A refund whose Paystack call failed can be sent again. Only a failed request
-- may be retried, and the row goes back to approved so the existing refund_submit
-- job picks it up. The function does not enqueue anything: the application does,
-- with the same de-duplication key it always uses.
CREATE OR REPLACE FUNCTION public.retry_refund_submission(
  p_actor   uuid,
  p_request uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.refund_requests;
  v_order   public.orders;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_request IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests r
   WHERE r.id = p_request
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_request.status <> 'failed' THEN
    RAISE EXCEPTION 'bad_state';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = v_request.order_id;

  UPDATE public.refund_requests
     SET status = 'approved',
         decided_by = coalesce(v_request.decided_by, p_actor)
   WHERE id = p_request
  RETURNING * INTO v_request;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, after)
  VALUES (
    p_actor,
    'refund.retry_requested',
    'refund_request',
    p_request::text,
    pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.number,
      'status', 'approved'
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'enqueue', true,
    'status', v_request.status,
    'request_id', p_request,
    'order_id', v_order.id,
    'order_reference', v_order.paystack_reference
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Overview and the daily series
-- ----------------------------------------------------------------------------

-- 5.1 public.admin_overview(uuid, timestamptz, timestamptz)
--
-- Every number the overview shows, in one call. Money in the range is read from
-- the ledger where the ledger is the truth (revenue, processor fees, refunds);
-- the order and dispute counters are read from the tables that own them. The two
-- payable figures are current balances, not range figures, and the response
-- says so in its own key names.
CREATE OR REPLACE FUNCTION public.admin_overview(
  p_actor uuid,
  p_from  timestamptz,
  p_to    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gmv              bigint := 0;
  v_orders           bigint := 0;
  v_refunds_count    bigint := 0;
  v_refunds_kobo     bigint := 0;
  v_revenue          bigint := 0;
  v_processor_fees   bigint := 0;
  v_vendor_payables  bigint := 0;
  v_aff_payables     bigint := 0;
  v_open_disputes    bigint := 0;
  v_needs_decision   bigint := 0;
  v_refunds_waiting  bigint := 0;
  v_failed_refunds   bigint := 0;
  v_withdrawals      bigint := 0;
  v_products         bigint := 0;
  v_files            bigint := 0;
  v_dead_jobs        bigint := 0;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.admin_finance_range_ok(p_from, p_to) THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT coalesce(pg_catalog.sum(o.total_kobo), 0), pg_catalog.count(*)
    INTO v_gmv, v_orders
    FROM public.orders o
   WHERE o.paid_at IS NOT NULL
     AND o.paid_at >= p_from
     AND o.paid_at < p_to
     AND o.status IN ('paid', 'refunded', 'disputed');

  -- A refund that moved money in the range: the reversal posting is the record.
  SELECT pg_catalog.count(*), coalesce(pg_catalog.sum(o.total_kobo), 0)
    INTO v_refunds_count, v_refunds_kobo
    FROM public.ledger_transactions t
    JOIN public.orders o ON o.id = t.ref_id
   WHERE t.kind = 'order_refund'
     AND t.ref_type = 'order'
     AND t.created_at >= p_from
     AND t.created_at < p_to;

  -- Platform revenue: the platform fee and the withdrawal fee accounts, net of
  -- the reversals a refund or a lost dispute posts against them.
  SELECT coalesce(pg_catalog.sum(e.credit_kobo - e.debit_kobo), 0)
    INTO v_revenue
    FROM public.ledger_entries e
   WHERE e.account_id IN (5, 6)
     AND e.created_at >= p_from
     AND e.created_at < p_to;

  SELECT coalesce(pg_catalog.sum(e.debit_kobo - e.credit_kobo), 0)
    INTO v_processor_fees
    FROM public.ledger_entries e
   WHERE e.account_id = 2
     AND e.created_at >= p_from
     AND e.created_at < p_to;

  -- Current balances: what is owed to vendors and affiliates right now.
  SELECT coalesce(pg_catalog.sum(e.credit_kobo - e.debit_kobo), 0)
    INTO v_vendor_payables
    FROM public.ledger_entries e
   WHERE e.account_id = 3;

  SELECT coalesce(pg_catalog.sum(e.credit_kobo - e.debit_kobo), 0)
    INTO v_aff_payables
    FROM public.ledger_entries e
   WHERE e.account_id = 4;

  SELECT pg_catalog.count(*) FILTER (WHERE d.outcome = 'open'),
         pg_catalog.count(*) FILTER (WHERE d.needs_decision)
    INTO v_open_disputes, v_needs_decision
    FROM public.order_disputes d;

  SELECT pg_catalog.count(*) INTO v_refunds_waiting
    FROM public.refund_requests r WHERE r.status = 'requested';

  SELECT pg_catalog.count(*) INTO v_failed_refunds
    FROM public.refund_requests r WHERE r.status = 'failed';

  SELECT pg_catalog.count(*) INTO v_withdrawals
    FROM public.withdrawals w WHERE w.status = 'requested';

  SELECT pg_catalog.count(*) INTO v_products
    FROM public.products p WHERE p.status = 'submitted';

  SELECT pg_catalog.count(*) INTO v_files
    FROM public.product_files f WHERE f.scan_status IN ('infected', 'error');

  SELECT pg_catalog.count(*) INTO v_dead_jobs
    FROM public.jobs j WHERE j.status = 'dead';

  RETURN pg_catalog.jsonb_build_object(
    'gmv_kobo', v_gmv,
    'orders', v_orders,
    'refunds_count', v_refunds_count,
    'refunds_kobo', v_refunds_kobo,
    'platform_revenue_kobo', v_revenue,
    'processor_fees_kobo', v_processor_fees,
    'net_margin_kobo', v_revenue - v_processor_fees,
    'vendor_payables_kobo', v_vendor_payables,
    'affiliate_payables_kobo', v_aff_payables,
    'open_disputes', v_open_disputes,
    'disputes_needing_decision', v_needs_decision,
    'refunds_awaiting_decision', v_refunds_waiting,
    'failed_refund_submissions', v_failed_refunds,
    'withdrawals_awaiting_approval', v_withdrawals,
    'products_awaiting_review', v_products,
    'files_needing_scan_review', v_files,
    'dead_jobs', v_dead_jobs
  );
END;
$$;

-- 5.2 public.admin_daily_series(uuid, date, date)
--
-- One row per Lagos day in the range, zero days included, so a quiet day is a
-- zero and not a gap in the chart.
CREATE OR REPLACE FUNCTION public.admin_daily_series(
  p_actor uuid,
  p_from  date,
  p_to    date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'day', (d.day)::date,
             'orders', x.orders,
             'gmv_kobo', x.gmv_kobo,
             'refunds_kobo', x.refunds_kobo,
             'platform_revenue_kobo', x.revenue_kobo
           )
           ORDER BY d.day
         )
    INTO v_rows
    FROM pg_catalog.generate_series(p_from, p_to, interval '1 day') AS d(day)
    CROSS JOIN LATERAL (
      SELECT
        (
          SELECT pg_catalog.count(*)
            FROM public.orders o
           WHERE o.paid_at IS NOT NULL
             AND o.paid_at >= (d.day::timestamp AT TIME ZONE 'Africa/Lagos')
             AND o.paid_at < (((d.day)::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
             AND o.status IN ('paid', 'refunded', 'disputed')
        ) AS orders,
        (
          SELECT coalesce(pg_catalog.sum(o.total_kobo), 0)
            FROM public.orders o
           WHERE o.paid_at IS NOT NULL
             AND o.paid_at >= (d.day::timestamp AT TIME ZONE 'Africa/Lagos')
             AND o.paid_at < (((d.day)::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
             AND o.status IN ('paid', 'refunded', 'disputed')
        ) AS gmv_kobo,
        (
          SELECT coalesce(pg_catalog.sum(o.total_kobo), 0)
            FROM public.ledger_transactions t
            JOIN public.orders o ON o.id = t.ref_id
           WHERE t.kind = 'order_refund'
             AND t.ref_type = 'order'
             AND t.created_at >= (d.day::timestamp AT TIME ZONE 'Africa/Lagos')
             AND t.created_at < (((d.day)::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
        ) AS refunds_kobo,
        (
          SELECT coalesce(pg_catalog.sum(e.credit_kobo - e.debit_kobo), 0)
            FROM public.ledger_entries e
           WHERE e.account_id IN (5, 6)
             AND e.created_at >= (d.day::timestamp AT TIME ZONE 'Africa/Lagos')
             AND e.created_at < (((d.day)::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
        ) AS revenue_kobo
    ) AS x;

  RETURN coalesce(v_rows, '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Orders
-- ----------------------------------------------------------------------------

-- 6.1 public.admin_orders_list(...)
--
-- Search by order number prefix, by Paystack reference (exact) or by the buyer's
-- address (exact, and only for admin and support: finance works from the masked
-- address, which is enough to recognise a buyer and not enough to contact them).
-- Keyset pagination on (created_at, id): no gap, no duplicate.
CREATE OR REPLACE FUNCTION public.admin_orders_list(
  p_actor  uuid,
  p_q      text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
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
  v_limit        int := least(greatest(1, coalesce(p_limit, 50)), 50);
  v_q            text := nullif(pg_catalog.btrim(coalesce(p_q, '')), '');
  v_status       text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_can_see_mail boolean;
  v_from_ts      timestamptz;
  v_to_ts        timestamptz;
  v_ts           timestamptz;
  v_id           uuid;
  v_rows         jsonb;
  v_next         jsonb;
BEGIN
  IF NOT public.staff_has_any_role(
           p_actor,
           ARRAY['admin', 'finance', 'support']::public.app_role[]
         ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'disputed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_can_see_mail := public.staff_has_any_role(
                      p_actor,
                      ARRAY['admin', 'support']::public.app_role[]
                    );

  IF p_from IS NOT NULL THEN
    v_from_ts := (p_from::timestamp AT TIME ZONE 'Africa/Lagos');
  END IF;

  IF p_to IS NOT NULL THEN
    v_to_ts := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos');
  END IF;

  IF v_from_ts IS NOT NULL AND v_to_ts IS NOT NULL AND v_from_ts >= v_to_ts THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'created_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT o.id,
           o.number,
           o.status::text AS status,
           o.total_kobo,
           o.paid_at,
           o.created_at,
           o.buyer_email::text AS buyer_email,
           public.mask_email(o.buyer_email::text) AS masked_email,
           o.affiliate_id IS NOT NULL AS has_affiliate,
           i.title_snapshot AS product_title,
           v.business_name AS vendor_name
      FROM public.orders o
      LEFT JOIN LATERAL (
        SELECT oi.title_snapshot, oi.vendor_id
          FROM public.order_items oi
         WHERE oi.order_id = o.id
         ORDER BY oi.created_at
         LIMIT 1
      ) AS i ON true
      LEFT JOIN public.vendor_profiles v ON v.user_id = i.vendor_id
     WHERE (v_status IS NULL OR o.status::text = v_status)
       AND (v_from_ts IS NULL OR coalesce(o.paid_at, o.created_at) >= v_from_ts)
       AND (v_to_ts IS NULL OR coalesce(o.paid_at, o.created_at) < v_to_ts)
       AND (
         v_ts IS NULL
         OR o.created_at < v_ts
         OR (o.created_at = v_ts AND o.id < v_id)
       )
       AND (
         v_q IS NULL
         OR o.number ILIKE v_q || '%'
         OR o.paystack_reference = v_q
         OR (v_can_see_mail AND pg_catalog.lower(o.buyer_email::text) = pg_catalog.lower(v_q))
       )
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', page.id,
               'number', page.number,
               'status', page.status,
               'total_kobo', page.total_kobo,
               'paid_at', page.paid_at,
               'created_at', page.created_at,
               'product_title', page.product_title,
               'vendor_name', page.vendor_name,
               'masked_email', page.masked_email,
               'has_affiliate', page.has_affiliate
             )
             ORDER BY page.created_at DESC, page.id DESC
           ),
           '[]'::jsonb
         ),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'created_at', pg_catalog.min(page.created_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_rows, v_next
    FROM page;

  RETURN pg_catalog.jsonb_build_object(
    'items', v_rows,
    'next_cursor', v_next,
    'can_see_full_email', v_can_see_mail
  );
END;
$$;

-- 6.2 public.admin_order_detail(uuid, uuid)
--
-- Everything about one order, including the split, the tax lines, the refunds,
-- the disputes, the webhook deliveries, the emails we sent and (for admin and
-- finance) the ledger postings.
--
-- The buyer's full address is returned to admin and support only, and that read
-- writes audit_log 'order.viewed_by_staff' with the actor and the order id and
-- nothing else. Finance sees the masked address.
CREATE OR REPLACE FUNCTION public.admin_order_detail(
  p_actor uuid,
  p_order uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order        public.orders;
  v_item         public.order_items;
  v_can_see_mail boolean;
  v_can_see_ledger boolean;
  v_result       jsonb;
BEGIN
  IF NOT public.staff_has_any_role(
           p_actor,
           ARRAY['admin', 'finance', 'support']::public.app_role[]
         ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_order IS NULL THEN
    RAISE EXCEPTION 'invalid_order';
  END IF;

  v_can_see_mail := public.staff_has_any_role(
                      p_actor,
                      ARRAY['admin', 'support']::public.app_role[]
                    );

  v_can_see_ledger := public.staff_has_any_role(
                        p_actor,
                        ARRAY['admin', 'finance']::public.app_role[]
                      );

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO v_item
    FROM public.order_items i
   WHERE i.order_id = v_order.id
   ORDER BY i.created_at
   LIMIT 1;

  IF v_can_see_mail THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id)
    VALUES (p_actor, 'order.viewed_by_staff', 'order', v_order.id::text);
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'number', v_order.number,
      'status', v_order.status::text,
      'currency', v_order.currency,
      'subtotal_kobo', v_order.subtotal_kobo,
      'tax_kobo', v_order.tax_kobo,
      'tax_included', v_order.tax_included,
      'total_kobo', v_order.total_kobo,
      'processor_fee_kobo', v_order.processor_fee_kobo,
      'channel', v_order.channel,
      'paystack_reference', v_order.paystack_reference,
      'paid_at', v_order.paid_at,
      'created_at', v_order.created_at
    ),
    'buyer', pg_catalog.jsonb_build_object(
      'user_id', v_order.buyer_user_id,
      'name', v_order.buyer_name,
      'masked_email', public.mask_email(v_order.buyer_email::text),
      'email', CASE WHEN v_can_see_mail THEN v_order.buyer_email::text ELSE NULL END,
      'full_email_visible', v_can_see_mail
    ),
    'items', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'title', i.title_snapshot,
                 'product_id', i.product_id,
                 'unit_price_kobo', i.unit_price_kobo,
                 'commission_bps', i.commission_bps,
                 'platform_fee_bps', i.platform_fee_bps,
                 'platform_fee_kobo', i.platform_fee_kobo,
                 'affiliate_commission_kobo', i.affiliate_commission_kobo,
                 'vendor_net_kobo', i.vendor_net_kobo,
                 'tax_deducted_kobo', i.tax_deducted_kobo
               )
               ORDER BY i.created_at
             )
        FROM public.order_items i
       WHERE i.order_id = v_order.id
    ), '[]'::jsonb),
    'tax_lines', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'basis', l.basis,
                 'rate_bps', l.rate_bps,
                 'base_kobo', l.base_kobo,
                 'tax_kobo', l.tax_kobo,
                 'included', l.included,
                 'supplier', l.supplier
               )
               ORDER BY l.created_at
             )
        FROM public.order_tax_lines l
       WHERE l.order_id = v_order.id
    ), '[]'::jsonb),
    'vendor', (
      SELECT pg_catalog.jsonb_build_object(
               'user_id', vp.user_id,
               'business_name', vp.business_name
             )
        FROM public.vendor_profiles vp
       WHERE vp.user_id = v_item.vendor_id
    ),
    'affiliate', (
      SELECT pg_catalog.jsonb_build_object(
               'user_id', ap.user_id,
               'username', ap.username
             )
        FROM public.affiliate_profiles ap
       WHERE ap.user_id = v_order.affiliate_id
    ),
    'entitlements', pg_catalog.jsonb_build_object(
      'files', coalesce((
        SELECT pg_catalog.count(*)
          FROM public.entitlements e
         WHERE e.order_item_id = v_item.id
      ), 0),
      'downloads_used', coalesce((
        SELECT pg_catalog.sum(e.downloads_used)
          FROM public.entitlements e
         WHERE e.order_item_id = v_item.id
      ), 0),
      'downloads_allowed', coalesce((
        SELECT pg_catalog.sum(e.max_downloads)
          FROM public.entitlements e
         WHERE e.order_item_id = v_item.id
      ), 0),
      'revoked', coalesce((
        SELECT pg_catalog.count(*)
          FROM public.entitlements e
         WHERE e.order_item_id = v_item.id
           AND e.revoked_at IS NOT NULL
      ), 0)
    ),
    'refund_requests', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', r.id,
                 'status', r.status,
                 'reason', r.reason,
                 'auto_approved', r.auto_approved,
                 'requested_at', r.created_at,
                 'decided_at', r.decided_at,
                 'decision_note', r.decision_note,
                 'has_provider_reference', r.provider_reference IS NOT NULL
               )
               ORDER BY r.created_at DESC
             )
        FROM public.refund_requests r
       WHERE r.order_id = v_order.id
    ), '[]'::jsonb),
    'disputes', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', d.id,
                 'outcome', d.outcome,
                 'note', d.note,
                 'opened_at', d.opened_at,
                 'resolved_at', d.resolved_at,
                 'provider_resolution', d.provider_resolution,
                 'provider_resolved_at', d.provider_resolved_at,
                 'needs_decision', d.needs_decision
               )
               ORDER BY d.opened_at DESC
             )
        FROM public.order_disputes d
       WHERE d.order_id = v_order.id
    ), '[]'::jsonb),
    'webhook_events', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'event_type', w.event_type,
                 'status', w.status,
                 'received_at', w.received_at,
                 'processed_at', w.processed_at,
                 'error', w.error
               )
               ORDER BY w.received_at DESC
             )
        FROM public.webhook_events w
       WHERE w.reference = v_order.paystack_reference
    ), '[]'::jsonb),
    'emails', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'kind', m.kind,
                 'status', m.status,
                 'created_at', m.created_at
               )
               ORDER BY m.created_at DESC
             )
        FROM public.email_log m
       WHERE m.order_id = v_order.id
    ), '[]'::jsonb),
    'ledger', CASE
      WHEN NOT v_can_see_ledger THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'transactions', coalesce((
          SELECT pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object(
                     'id', t.id,
                     'kind', t.kind,
                     'description', t.description,
                     'created_at', t.created_at,
                     'entries', coalesce((
                       SELECT pg_catalog.jsonb_agg(
                                pg_catalog.jsonb_build_object(
                                  'account_code', a.code,
                                  'party', CASE
                                             WHEN e.party_id IS NULL THEN NULL
                                             WHEN e.account_id = 3 THEN (
                                               SELECT vp.business_name
                                                 FROM public.vendor_profiles vp
                                                WHERE vp.user_id = e.party_id
                                             )
                                             WHEN e.account_id = 4 THEN (
                                               SELECT ap.username
                                                 FROM public.affiliate_profiles ap
                                                WHERE ap.user_id = e.party_id
                                             )
                                             ELSE NULL
                                           END,
                                  'debit_kobo', e.debit_kobo,
                                  'credit_kobo', e.credit_kobo,
                                  'available_at', e.available_at
                                )
                                ORDER BY e.account_id
                              )
                         FROM public.ledger_entries e
                         JOIN public.ledger_accounts a ON a.id = e.account_id
                        WHERE e.txn_id = t.id
                       ), '[]'::jsonb)
                   )
                   ORDER BY t.created_at DESC
                 )
            FROM public.ledger_transactions t
           WHERE t.ref_type = 'order'
             AND t.ref_id = v_order.id
        ), '[]'::jsonb)
      )
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Refunds and disputes
-- ----------------------------------------------------------------------------

-- 7.1 public.admin_refunds_list(uuid, text, int, jsonb)
CREATE OR REPLACE FUNCTION public.admin_refunds_list(
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
  v_limit  int := least(greatest(1, coalesce(p_limit, 50)), 50);
  v_status text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_ts     timestamptz;
  v_id     uuid;
  v_rows   jsonb;
  v_next   jsonb;
BEGIN
  IF NOT public.staff_has_any_role(
           p_actor,
           ARRAY['admin', 'finance', 'support']::public.app_role[]
         ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('requested', 'approved', 'processed', 'failed', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'requested_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT r.id,
           r.status,
           r.auto_approved,
           r.created_at AS requested_at,
           r.decided_at,
           r.provider_reference IS NOT NULL AS has_provider_reference,
           o.number AS order_number,
           o.total_kobo AS amount_kobo,
           i.title_snapshot AS product_title
      FROM public.refund_requests r
      JOIN public.orders o ON o.id = r.order_id
      LEFT JOIN LATERAL (
        SELECT oi.title_snapshot
          FROM public.order_items oi
         WHERE oi.order_id = o.id
         ORDER BY oi.created_at
         LIMIT 1
      ) AS i ON true
     WHERE (v_status IS NULL OR r.status = v_status)
       AND (
         v_ts IS NULL
         OR r.created_at < v_ts
         OR (r.created_at = v_ts AND r.id < v_id)
       )
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', page.id,
               'status', page.status,
               'auto_approved', page.auto_approved,
               'requested_at', page.requested_at,
               'decided_at', page.decided_at,
               'has_provider_reference', page.has_provider_reference,
               'order_number', page.order_number,
               'amount_kobo', page.amount_kobo,
               'product_title', page.product_title
             )
             ORDER BY page.requested_at DESC, page.id DESC
           ),
           '[]'::jsonb
         ),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'requested_at', pg_catalog.min(page.requested_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_rows, v_next
    FROM page;

  RETURN pg_catalog.jsonb_build_object('items', v_rows, 'next_cursor', v_next);
END;
$$;

-- 7.2 public.admin_disputes_list(uuid, text, int, jsonb)
--
-- p_status filters the outcome (open, won, lost) or asks for 'needs_decision'.
CREATE OR REPLACE FUNCTION public.admin_disputes_list(
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
  v_limit  int := least(greatest(1, coalesce(p_limit, 50)), 50);
  v_status text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_ts     timestamptz;
  v_id     uuid;
  v_rows   jsonb;
  v_next   jsonb;
BEGIN
  IF NOT public.staff_has_any_role(
           p_actor,
           ARRAY['admin', 'finance', 'support']::public.app_role[]
         ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('open', 'won', 'lost', 'needs_decision') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'opened_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT d.id,
           d.outcome,
           d.opened_at,
           d.resolved_at,
           d.note,
           d.provider_resolution,
           d.provider_resolved_at,
           d.needs_decision,
           o.id AS order_id,
           o.number AS order_number,
           o.total_kobo AS amount_kobo,
           public.mask_email(o.buyer_email::text) AS masked_email,
           i.title_snapshot AS product_title
      FROM public.order_disputes d
      JOIN public.orders o ON o.id = d.order_id
      LEFT JOIN LATERAL (
        SELECT oi.title_snapshot
          FROM public.order_items oi
         WHERE oi.order_id = o.id
         ORDER BY oi.created_at
         LIMIT 1
      ) AS i ON true
     WHERE (
             v_status IS NULL
             OR (v_status = 'needs_decision' AND d.needs_decision)
             OR (v_status <> 'needs_decision' AND d.outcome = v_status)
           )
       AND (
         v_ts IS NULL
         OR d.opened_at < v_ts
         OR (d.opened_at = v_ts AND d.id < v_id)
       )
     ORDER BY d.needs_decision DESC, d.opened_at DESC, d.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', page.id,
               'order_id', page.order_id,
               'order_number', page.order_number,
               'outcome', page.outcome,
               'opened_at', page.opened_at,
               'resolved_at', page.resolved_at,
               'note', page.note,
               'provider_resolution', page.provider_resolution,
               'provider_resolved_at', page.provider_resolved_at,
               'needs_decision', page.needs_decision,
               'amount_kobo', page.amount_kobo,
               'product_title', page.product_title,
               'masked_email', page.masked_email
             )
             ORDER BY page.needs_decision DESC, page.opened_at DESC, page.id DESC
           ),
           '[]'::jsonb
         ),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'opened_at', pg_catalog.min(page.opened_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_rows, v_next
    FROM page;

  RETURN pg_catalog.jsonb_build_object('items', v_rows, 'next_cursor', v_next);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Ledger, trial balance and reconciliation
-- ----------------------------------------------------------------------------

-- 8.1 public.admin_ledger_list(uuid, text, date, date, int, jsonb)
--
-- Transactions with their entries. p_account is a ledger account code; when it
-- is given only the transactions that touch that account are listed, and every
-- entry of those transactions is still shown, because half a posting does not
-- read.
CREATE OR REPLACE FUNCTION public.admin_ledger_list(
  p_actor   uuid,
  p_account text DEFAULT NULL,
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL,
  p_limit   int DEFAULT 50,
  p_cursor  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit   int := least(greatest(1, coalesce(p_limit, 50)), 50);
  v_account text := nullif(pg_catalog.btrim(coalesce(p_account, '')), '');
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_ts      timestamptz;
  v_id      uuid;
  v_rows    jsonb;
  v_next    jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_account IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.code = v_account) THEN
    RAISE EXCEPTION 'invalid_account';
  END IF;

  IF p_from IS NOT NULL THEN
    v_from_ts := (p_from::timestamp AT TIME ZONE 'Africa/Lagos');
  END IF;

  IF p_to IS NOT NULL THEN
    v_to_ts := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos');
  END IF;

  IF v_from_ts IS NOT NULL AND v_to_ts IS NOT NULL AND v_from_ts >= v_to_ts THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'created_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT t.id, t.kind, t.ref_type, t.ref_id, t.description, t.created_at
      FROM public.ledger_transactions t
     WHERE (v_from_ts IS NULL OR t.created_at >= v_from_ts)
       AND (v_to_ts IS NULL OR t.created_at < v_to_ts)
       AND (
         v_account IS NULL
         OR EXISTS (
           SELECT 1
             FROM public.ledger_entries e
             JOIN public.ledger_accounts a ON a.id = e.account_id
            WHERE e.txn_id = t.id
              AND a.code = v_account
         )
       )
       AND (
         v_ts IS NULL
         OR t.created_at < v_ts
         OR (t.created_at = v_ts AND t.id < v_id)
       )
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', page.id,
               'kind', page.kind,
               'ref_type', page.ref_type,
               'ref_id', page.ref_id,
               'description', page.description,
               'created_at', page.created_at,
               'entries', coalesce((
                 SELECT pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'account_code', a.code,
                            'account_name', a.name,
                            'party', e.party_id,
                            'debit_kobo', e.debit_kobo,
                            'credit_kobo', e.credit_kobo,
                            'available_at', e.available_at
                          )
                          ORDER BY e.account_id
                        )
                   FROM public.ledger_entries e
                   JOIN public.ledger_accounts a ON a.id = e.account_id
                  WHERE e.txn_id = page.id
               ), '[]'::jsonb)
             )
             ORDER BY page.created_at DESC, page.id DESC
           ),
           '[]'::jsonb
         ),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'created_at', pg_catalog.min(page.created_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_rows, v_next
    FROM page;

  RETURN pg_catalog.jsonb_build_object(
    'items', v_rows,
    'next_cursor', v_next,
    'accounts', coalesce((
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('code', a.code, 'name', a.name, 'kind', a.kind)
               ORDER BY a.id
             )
        FROM public.ledger_accounts a
    ), '[]'::jsonb)
  );
END;
$$;

-- 8.2 public.admin_trial_balance(uuid, timestamptz)
--
-- Every account's debits, credits and balance, the grand totals, whether the
-- book balances, and a second, independent check: the sum of what each party is
-- owed (vendor plus affiliate) against the two payable account balances. Two
-- checks, because a ledger can balance and still owe the wrong person.
CREATE OR REPLACE FUNCTION public.admin_trial_balance(
  p_actor uuid,
  p_as_of timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_as_of        timestamptz := coalesce(p_as_of, pg_catalog.now());
  v_accounts     jsonb;
  v_debits       bigint := 0;
  v_credits      bigint := 0;
  v_party_sum    bigint := 0;
  v_payable_acct bigint := 0;
  v_vendor       bigint := 0;
  v_affiliate    bigint := 0;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'code', a.code,
               'name', a.name,
               'kind', a.kind,
               'debit_kobo', x.debit_kobo,
               'credit_kobo', x.credit_kobo,
               'balance_kobo', x.debit_kobo - x.credit_kobo
             )
             ORDER BY a.id
           ),
           '[]'::jsonb
         )
    INTO v_accounts
    FROM public.ledger_accounts a
    CROSS JOIN LATERAL (
      SELECT coalesce(pg_catalog.sum(e.debit_kobo), 0) AS debit_kobo,
             coalesce(pg_catalog.sum(e.credit_kobo), 0) AS credit_kobo
        FROM public.ledger_entries e
       WHERE e.account_id = a.id
         AND e.created_at < v_as_of
    ) AS x;

  SELECT coalesce(pg_catalog.sum(e.debit_kobo), 0),
         coalesce(pg_catalog.sum(e.credit_kobo), 0)
    INTO v_debits, v_credits
    FROM public.ledger_entries e
   WHERE e.created_at < v_as_of;

  -- Per party: vendor_payable plus affiliate_payable, credits minus debits.
  SELECT coalesce(pg_catalog.sum(e.credit_kobo - e.debit_kobo), 0)
    INTO v_party_sum
    FROM public.ledger_entries e
   WHERE e.account_id IN (3, 4)
     AND e.party_id IS NOT NULL
     AND e.created_at < v_as_of;

  v_vendor    := public.account_balance(3::smallint, v_as_of) * -1;
  v_affiliate := public.account_balance(4::smallint, v_as_of) * -1;
  v_payable_acct := v_vendor + v_affiliate;

  RETURN pg_catalog.jsonb_build_object(
    'as_of', v_as_of,
    'accounts', v_accounts,
    'totals', pg_catalog.jsonb_build_object(
      'debit_kobo', v_debits,
      'credit_kobo', v_credits,
      'difference_kobo', v_debits - v_credits
    ),
    'balanced', v_debits = v_credits,
    'payables_match', v_party_sum = v_payable_acct,
    'payables', pg_catalog.jsonb_build_object(
      'party_sum_kobo', v_party_sum,
      'vendor_payable_kobo', v_vendor,
      'affiliate_payable_kobo', v_affiliate,
      'accounts_kobo', v_payable_acct
    )
  );
END;
$$;

-- 8.3 public.admin_reconciliation_list(uuid, int)
CREATE OR REPLACE FUNCTION public.admin_reconciliation_list(
  p_actor uuid,
  p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := least(greatest(1, coalesce(p_limit, 30)), 50);
  v_rows  jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', r.id,
               'run_at', r.run_at,
               'ledger_paystack_balance_kobo', r.ledger_paystack_balance_kobo,
               'provider_balance_kobo', r.provider_balance_kobo,
               'diff_kobo', r.diff_kobo
             )
             ORDER BY r.run_at DESC, r.id DESC
           ),
           '[]'::jsonb
         )
    INTO v_rows
    FROM (
      SELECT * FROM public.reconciliation_runs r
       ORDER BY r.run_at DESC, r.id DESC
       LIMIT v_limit
    ) AS r;

  RETURN pg_catalog.jsonb_build_object('items', v_rows);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. VAT
-- ----------------------------------------------------------------------------

-- 9.1 public.vat_periods_list(uuid, int)
--
-- The twelve months of one year, each through vat_period_summary so the screen
-- and the database can never disagree about what a month owes.
CREATE OR REPLACE FUNCTION public.vat_periods_list(
  p_actor uuid,
  p_year  int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year   int := coalesce(p_year, extract(year FROM (pg_catalog.now() AT TIME ZONE 'Africa/Lagos'))::int);
  v_today  date := (pg_catalog.now() AT TIME ZONE 'Africa/Lagos')::date;
  v_rows   jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_year < 2020 OR v_year > 2100 THEN
    RAISE EXCEPTION 'invalid_year';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             s.summary || pg_catalog.jsonb_build_object(
               'days_until_due', (s.summary ->> 'due_date')::date - v_today
             )
             ORDER BY s.period
           ),
           '[]'::jsonb
         )
    INTO v_rows
    FROM (
      SELECT m.period, public.vat_period_summary(m.period) AS summary
        FROM (
          SELECT pg_catalog.make_date(v_year, month, 1) AS period
            FROM pg_catalog.generate_series(1, 12) AS month
        ) AS m
    ) AS s;

  RETURN pg_catalog.jsonb_build_object(
    'year', v_year,
    'today', v_today,
    'periods', v_rows
  );
END;
$$;

-- 9.2 public.vat_period_detail(uuid, date, int, jsonb)
--
-- The month's summary, its adjustments and its tax lines, paged. The tax lines
-- are the orders paid in the Lagos month: one row per calculation, with the
-- basis, the rate and whether the order was later refunded.
CREATE OR REPLACE FUNCTION public.vat_period_detail(
  p_actor  uuid,
  p_period date,
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
  v_limit  int := least(greatest(1, coalesce(p_limit, 50)), 50);
  v_month  date;
  v_start  timestamptz;
  v_end    timestamptz;
  v_ts     timestamptz;
  v_id     uuid;
  v_lines  jsonb;
  v_next   jsonb;
  v_adjust jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_period IS NULL THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_month := pg_catalog.date_trunc('month', p_period)::date;
  v_start := (v_month::timestamp AT TIME ZONE 'Africa/Lagos');
  v_end   := ((v_month + pg_catalog.make_interval(months => 1))::timestamp AT TIME ZONE 'Africa/Lagos');

  IF p_cursor IS NOT NULL AND pg_catalog.jsonb_typeof(p_cursor) = 'object' THEN
    v_ts := nullif(p_cursor ->> 'paid_at', '')::timestamptz;
    v_id := nullif(p_cursor ->> 'id', '')::uuid;
  END IF;

  WITH page AS (
    SELECT l.id,
           l.basis,
           l.rate_bps,
           l.base_kobo,
           l.tax_kobo,
           l.supplier,
           o.number AS order_number,
           o.paid_at,
           o.status::text AS order_status
      FROM public.order_tax_lines l
      JOIN public.orders o ON o.id = l.order_id
     WHERE o.paid_at IS NOT NULL
       AND o.paid_at >= v_start
       AND o.paid_at < v_end
       AND (
         v_ts IS NULL
         OR o.paid_at < v_ts
         OR (o.paid_at = v_ts AND l.id < v_id)
       )
     ORDER BY o.paid_at DESC, l.id DESC
     LIMIT v_limit
  )
  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', page.id,
               'order_number', page.order_number,
               'paid_at', page.paid_at,
               'paid_date_lagos', (page.paid_at AT TIME ZONE 'Africa/Lagos')::date,
               'basis', page.basis,
               'rate_bps', page.rate_bps,
               'base_kobo', page.base_kobo,
               'tax_kobo', page.tax_kobo,
               'supplier', page.supplier,
               'refunded', page.order_status IN ('refunded', 'disputed')
             )
             ORDER BY page.paid_at DESC, page.id DESC
           ),
           '[]'::jsonb
         ),
         CASE WHEN pg_catalog.count(*) = v_limit
              THEN pg_catalog.jsonb_build_object(
                     'paid_at', pg_catalog.min(page.paid_at),
                     'id', pg_catalog.min(page.id::text)
                   )
              ELSE NULL
         END
    INTO v_lines, v_next
    FROM page;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', a.id,
               'amount_kobo', a.amount_kobo,
               'reason', a.reason,
               'created_at', a.created_at
             )
             ORDER BY a.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO v_adjust
    FROM public.vat_adjustments a
   WHERE a.period = v_month;

  RETURN pg_catalog.jsonb_build_object(
    'summary', public.vat_period_summary(v_month),
    'adjustments', v_adjust,
    'lines', v_lines,
    'next_cursor', v_next
  );
END;
$$;

-- 9.3 public.vat_export_rows(uuid, date)
--
-- Every tax line of the month, for the CSV export. Same rows and same order as
-- the detail page, without a page limit, because a tax filing needs all of them.
CREATE OR REPLACE FUNCTION public.vat_export_rows(
  p_actor  uuid,
  p_period date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date;
  v_start timestamptz;
  v_end   timestamptz;
  v_rows  jsonb;
BEGIN
  IF NOT public.staff_has_any_role(p_actor, ARRAY['admin', 'finance']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_period IS NULL THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_month := pg_catalog.date_trunc('month', p_period)::date;
  v_start := (v_month::timestamp AT TIME ZONE 'Africa/Lagos');
  v_end   := ((v_month + pg_catalog.make_interval(months => 1))::timestamp AT TIME ZONE 'Africa/Lagos');

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'order_number', o.number,
               'paid_date_lagos', (o.paid_at AT TIME ZONE 'Africa/Lagos')::date,
               'basis', l.basis,
               'rate_bps', l.rate_bps,
               'base_kobo', l.base_kobo,
               'tax_kobo', l.tax_kobo,
               'supplier', l.supplier,
               'refunded', o.status IN ('refunded', 'disputed')
             )
             ORDER BY o.paid_at, l.id
           ),
           '[]'::jsonb
         )
    INTO v_rows
    FROM public.order_tax_lines l
    JOIN public.orders o ON o.id = l.order_id
   WHERE o.paid_at IS NOT NULL
     AND o.paid_at >= v_start
     AND o.paid_at < v_end;

  RETURN pg_catalog.jsonb_build_object(
    'period', v_month,
    'rows', v_rows
  );
END;
$$;

-- 9.4 public.vat_reminder_targets(date)
--
-- The daily reminder job asks this what, if anything, to send. It answers for
-- the previous Lagos month only: 'due_soon' on the 14th and the 19th, and
-- 'overdue' after the 21st, until the month is remitted. A month with no VAT
-- activity that was never filed is not chased.
CREATE OR REPLACE FUNCTION public.vat_reminder_targets(
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   date := coalesce(p_today, (pg_catalog.now() AT TIME ZONE 'Africa/Lagos')::date);
  v_period  date;
  v_summary jsonb;
  v_status  text;
  v_net     bigint;
  v_due     date;
  v_kind    text;
BEGIN
  v_period  := (pg_catalog.date_trunc('month', v_today) - pg_catalog.make_interval(months => 1))::date;
  v_summary := public.vat_period_summary(v_period);
  v_status  := v_summary ->> 'status';
  v_net     := (v_summary ->> 'net_payable_kobo')::bigint;
  v_due     := (v_summary ->> 'due_date')::date;

  IF v_status = 'remitted' THEN
    RETURN NULL;
  END IF;

  -- Nothing to chase: no activity and nobody has filed it either.
  IF v_net = 0 AND v_status = 'open' THEN
    RETURN NULL;
  END IF;

  IF extract(day FROM v_today)::int IN (14, 19) THEN
    v_kind := 'due_soon';
  ELSIF v_today > v_due THEN
    v_kind := 'overdue';
  ELSE
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'period', v_period,
    'reminder', v_kind,
    'status', v_status,
    'due_date', v_due,
    'net_payable_kobo', v_net,
    'days_until_due', v_due - v_today
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Row level security
--
-- reconciliation_runs is new and service role only: RLS on, no policy, so a
-- signed-in browser role reads nothing even if a grant were ever added by
-- mistake. order_disputes already has RLS and its policies; the new columns are
-- covered by them, and no client role gains a write path.
-- ----------------------------------------------------------------------------
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reconciliation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reconciliation_runs TO service_role;

-- ----------------------------------------------------------------------------
-- 11. Privileges
-- Every function below is service role only. The role checks inside decide who
-- may read what; the grant decides who may call at all.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.staff_has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mask_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_balance(smallint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_finance_range_ok(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_dispute_provider_outcome(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_reconciliation_run(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_refund_submission(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_daily_series(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_orders_list(uuid, text, text, date, date, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_order_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_refunds_list(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_disputes_list(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_ledger_list(uuid, text, date, date, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_trial_balance(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reconciliation_list(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vat_periods_list(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vat_period_detail(uuid, date, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vat_export_rows(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vat_reminder_targets(date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.staff_has_any_role(uuid, public.app_role[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mask_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_balance(smallint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_finance_range_ok(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_dispute_provider_outcome(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_run(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_refund_submission(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_overview(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_daily_series(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_orders_list(uuid, text, text, date, date, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_order_detail(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_refunds_list(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_disputes_list(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_ledger_list(uuid, text, date, date, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_trial_balance(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconciliation_list(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.vat_periods_list(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.vat_period_detail(uuid, date, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.vat_export_rows(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.vat_reminder_targets(date) TO service_role;

-- ----------------------------------------------------------------------------
-- 12. Record the migration
-- ----------------------------------------------------------------------------
INSERT INTO public.app_migrations (version, name)
VALUES ('20261124000100', 'admin_finance')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Use only if this migration must be undone. In the SQL Editor, copy from the
-- "BEGIN;" line below through the final "COMMIT;" line, then delete the leading
-- "--" (and the space) from every one of those lines. It becomes runnable SQL.
--
-- Warning: this drops every reconciliation run, and it removes the dispute
-- outcome columns, so any provider resolution already recorded is lost. The
-- orders, the ledger and the VAT periods are not touched: they belong to
-- 20261116000200_commerce_core. Take a backup first.
-- ============================================================================
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.vat_reminder_targets(date);
-- DROP FUNCTION IF EXISTS public.vat_export_rows(uuid, date);
-- DROP FUNCTION IF EXISTS public.vat_period_detail(uuid, date, int, jsonb);
-- DROP FUNCTION IF EXISTS public.vat_periods_list(uuid, int);
-- DROP FUNCTION IF EXISTS public.admin_reconciliation_list(uuid, int);
-- DROP FUNCTION IF EXISTS public.admin_trial_balance(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS public.admin_ledger_list(uuid, text, date, date, int, jsonb);
-- DROP FUNCTION IF EXISTS public.admin_disputes_list(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.admin_refunds_list(uuid, text, int, jsonb);
-- DROP FUNCTION IF EXISTS public.admin_order_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.admin_orders_list(uuid, text, text, date, date, int, jsonb);
-- DROP FUNCTION IF EXISTS public.admin_daily_series(uuid, date, date);
-- DROP FUNCTION IF EXISTS public.admin_overview(uuid, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.retry_refund_submission(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.record_reconciliation_run(bigint);
-- DROP FUNCTION IF EXISTS public.record_dispute_provider_outcome(text, text, text);
-- DROP FUNCTION IF EXISTS public.admin_finance_range_ok(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.account_balance(smallint, timestamptz);
-- DROP FUNCTION IF EXISTS public.mask_email(text);
-- DROP FUNCTION IF EXISTS public.staff_has_any_role(uuid, public.app_role[]);
--
-- DROP INDEX IF EXISTS public.order_disputes_needs_decision_idx;
-- ALTER TABLE public.order_disputes DROP CONSTRAINT IF EXISTS order_disputes_provider_resolution_length;
-- ALTER TABLE public.order_disputes DROP COLUMN IF EXISTS needs_decision;
-- ALTER TABLE public.order_disputes DROP COLUMN IF EXISTS provider_resolved_at;
-- ALTER TABLE public.order_disputes DROP COLUMN IF EXISTS provider_resolution;
--
-- DROP TABLE IF EXISTS public.reconciliation_runs;
--
-- DELETE FROM public.app_migrations WHERE version = '20261124000100';
--
-- COMMIT;
