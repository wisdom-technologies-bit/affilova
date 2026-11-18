#!/usr/bin/env bash
# ============================================================================
# Commerce core test harness (migration 20261116000200_commerce_core)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies EVERY migration in order, then runs the
# whole commerce-core test suite against it:
#
#   1. every earlier verify file, then the commerce verify file
#   2. the migration applied twice from an empty database
#   3. the commented rollback block, then the migration re-applied
#   4. the SQL assertions (split, ledger, VAT, orders, refunds, downloads,
#      payout rules, RLS) - any failure is reported and the script exits 1
#   5. two real two-session concurrency tests
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/commerce_core_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_commerce_test)
#         SUPER_USER         OS user that owns the Postgres server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_commerce_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

super() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q $*"; }
# Run a SQL file as the server superuser, on DB $2 (default $DB).
run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}
# Run a one-line SQL statement and print the raw result (no header, no padding).
q() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB} -c \"$1\""; }

tmpfile() { mktemp /tmp/affilova_test.XXXXXX.sql; }

# ---------------------------------------------------------------------------
# 0. Empty database that looks like Supabase where the migrations need it
# ---------------------------------------------------------------------------
bootstrap() {
  local db="$1"
  su "$SUPER_USER" -c "psql -q -c \"DROP DATABASE IF EXISTS $db\"" >/dev/null 2>&1
  su "$SUPER_USER" -c "psql -q -c \"CREATE DATABASE $db\"" >/dev/null
  local f; f=$(tmpfile)
  cat > "$f" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
SQL
  run_file "$f" "$db"
  rm -f "$f"
}

apply_migrations() {
  local db="$1" f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    run_file "$f" "$db" >/dev/null
  done
}

# ---------------------------------------------------------------------------
# 1. Build the main database
# ---------------------------------------------------------------------------
step "Building $DB from an empty database (every migration, in order)"
bootstrap "$DB" || { echo "bootstrap failed"; exit 1; }
apply_migrations "$DB" || { echo "applying migrations failed"; exit 1; }

count=$(q "select count(*) from public.app_migrations")
if [ "$count" = "10" ]; then pass "ten migrations applied"; else fail "ten migrations applied" "got $count"; fi

step "Verify files (every check must be true)"
for f in "$ROOT"/supabase/verify/*.sql; do
  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$f" 2>&1)
  total=$(printf '%s\n' "$out" | grep -c '|' || true)
  bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
  name=$(basename "$f")
  if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
    pass "$name ($total checks)"
  else
    fail "$name" "$bad false of $total"
    printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
  fi
done

step "Migration applied twice from the same database"
if run_file "$ROOT/supabase/migrations/20261116000200_commerce_core.sql" >/dev/null 2>&1; then
  pass "second run of the commerce migration"
else
  fail "second run of the commerce migration"
fi
again=$(q "select count(*) from public.app_migrations where version = '20261116000200'")
if [ "$again" = "1" ]; then pass "migration recorded once"; else fail "migration recorded once" "got $again"; fi

# ---------------------------------------------------------------------------
# 2. Rollback then re-apply, on a separate database
# ---------------------------------------------------------------------------
step "Rollback block and re-apply (on $ROLLBACK_DB)"
bootstrap "$ROLLBACK_DB" >/dev/null || { echo "bootstrap failed"; exit 1; }
apply_migrations "$ROLLBACK_DB" >/dev/null || { echo "apply failed"; exit 1; }

rollback_sql=$(tmpfile)
awk '/^-- ROLLBACK$/{r=1} r' "$ROOT/supabase/migrations/20261116000200_commerce_core.sql" \
  | sed -n '/^-- BEGIN;$/,/^-- COMMIT;$/p' \
  | sed 's/^-- //' > "$rollback_sql"

if [ -s "$rollback_sql" ]; then
  if run_file "$rollback_sql" "$ROLLBACK_DB" >/dev/null 2>&1; then
    pass "rollback block ran"
  else
    fail "rollback block ran"
    run_file "$rollback_sql" "$ROLLBACK_DB" 2>&1 | tail -5 | sed 's/^/       /'
  fi
else
  fail "rollback block extracted" "no BEGIN/COMMIT block found"
fi

left=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('orders','order_items','order_tax_lines','entitlements','download_log','ledger_accounts','ledger_transactions','ledger_entries','refund_requests','order_disputes','payout_blackout_dates','vat_periods','vat_adjustments')\"")
if [ "$left" = "0" ]; then pass "rollback dropped all thirteen tables"; else fail "rollback dropped all thirteen tables" "$left left"; fi

if run_file "$ROOT/supabase/migrations/20261116000200_commerce_core.sql" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "migration re-applies after rollback"
else
  fail "migration re-applies after rollback"
fi
back=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname='ledger_entries'\"")
if [ "$back" = "1" ]; then pass "tables are back after re-apply"; else fail "tables are back after re-apply"; fi
rm -f "$rollback_sql"

# ---------------------------------------------------------------------------
# 3. The SQL suite
# ---------------------------------------------------------------------------
step "SQL test suite"
SUITE=$(tmpfile)
cat > "$SUITE" <<'SQL'
-- ===========================================================================
-- Assertion framework. Everything lands in t.results; the shell prints it.
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.results (
  id     serial PRIMARY KEY,
  name   text NOT NULL,
  ok     boolean NOT NULL,
  detail text
);
TRUNCATE t.results;

CREATE OR REPLACE FUNCTION t.eq(p_name text, p_actual text, p_expected text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  INSERT INTO t.results (name, ok, detail)
  VALUES (
    p_name,
    p_actual IS NOT DISTINCT FROM p_expected,
    CASE WHEN p_actual IS NOT DISTINCT FROM p_expected THEN NULL
         ELSE 'expected [' || coalesce(p_expected, '<null>') || '] got [' || coalesce(p_actual, '<null>') || ']' END
  );
END $f$;

CREATE OR REPLACE FUNCTION t.ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
  INSERT INTO t.results (name, ok, detail)
  VALUES (p_name, coalesce(p_ok, false), p_detail);
END $f$;

CREATE OR REPLACE FUNCTION t.raises(p_name text, p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $f$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO t.results (name, ok, detail) VALUES (p_name, false, 'no exception raised');
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    INSERT INTO t.results (name, ok, detail)
    VALUES (p_name, position(p_needle in v_msg) > 0, v_msg);
  END;
END $f$;

GRANT USAGE ON SCHEMA t TO anon, authenticated;
GRANT INSERT ON t.results TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE t.results_id_seq TO anon, authenticated;
GRANT EXECUTE ON FUNCTION t.eq(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION t.ok(text, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION t.raises(text, text, text) TO anon, authenticated;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111101', 'buyer@example.com'),
  ('11111111-1111-1111-1111-111111111102', 'buyer2@example.com'),
  ('11111111-1111-1111-1111-111111111103', 'vendor@example.com'),
  ('11111111-1111-1111-1111-111111111104', 'vendor2@example.com'),
  ('11111111-1111-1111-1111-111111111105', 'suspended@example.com'),
  ('11111111-1111-1111-1111-111111111106', 'affiliate@example.com'),
  ('11111111-1111-1111-1111-111111111107', 'affiliate2@example.com'),
  ('11111111-1111-1111-1111-111111111108', 'admin@example.com'),
  ('11111111-1111-1111-1111-111111111109', 'finance@example.com'),
  ('11111111-1111-1111-1111-111111111110', 'support@example.com'),
  ('11111111-1111-1111-1111-111111111111', 'outsider@example.com');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111103', 'vendor'),
  ('11111111-1111-1111-1111-111111111104', 'vendor'),
  ('11111111-1111-1111-1111-111111111105', 'vendor'),
  ('11111111-1111-1111-1111-111111111106', 'affiliate'),
  ('11111111-1111-1111-1111-111111111107', 'affiliate'),
  ('11111111-1111-1111-1111-111111111108', 'admin'),
  ('11111111-1111-1111-1111-111111111109', 'finance'),
  ('11111111-1111-1111-1111-111111111110', 'support');

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email, status) VALUES
  ('11111111-1111-1111-1111-111111111103', 'Alpha Shop', 'alpha-shop', 'vendor@example.com', 'active'),
  ('11111111-1111-1111-1111-111111111104', 'Beta Shop',  'beta-shop',  'vendor2@example.com', 'active'),
  ('11111111-1111-1111-1111-111111111105', 'Gamma Shop', 'gamma-shop', 'suspended@example.com', 'suspended');

INSERT INTO public.affiliate_profiles (user_id, username, status) VALUES
  ('11111111-1111-1111-1111-111111111106', 'aff_one', 'active'),
  ('11111111-1111-1111-1111-111111111107', 'aff_two', 'active');

INSERT INTO public.products (
  id, vendor_id, category_id, title, slug, short_description, description,
  price_kobo, commission_bps, affiliate_approval, refund_window_hours,
  max_downloads, status
) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111103', 1,
   'Live Product', 'live-product', 'A product that is live for sale.', 'Body.',
   1000000, 3000, 'open', 48, 3, 'live'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111103', 1,
   'Draft Product', 'draft-product', 'A product that is not live yet.', 'Body.',
   1000000, 3000, 'open', 48, 3, 'draft'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111105', 1,
   'Suspended Product', 'suspended-product', 'A product whose vendor is suspended.', 'Body.',
   1000000, 3000, 'open', 48, 3, 'live'),
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111103', 1,
   'Approval Product', 'approval-product', 'A product that needs approval for affiliates.', 'Body.',
   1000000, 3000, 'approval', 48, 3, 'live'),
  ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111103', 1,
   'Unclean Product', 'unclean-product', 'A product whose file is not clean yet.', 'Body.',
   500000, 3000, 'open', 48, 3, 'live');

INSERT INTO public.product_files (
  id, product_id, storage_key, original_name, content_type, size_bytes, status, scan_status
) VALUES
  ('33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222201',
   'products/p1/f1/one.pdf', 'one.pdf', 'application/pdf', 1024, 'uploaded', 'clean'),
  ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222201',
   'products/p1/f2/two.pdf', 'two.pdf', 'application/pdf', 2048, 'uploaded', 'clean'),
  ('33333333-3333-3333-3333-333333333303', '22222222-2222-2222-2222-222222222205',
   'products/p5/f3/three.pdf', 'three.pdf', 'application/pdf', 4096, 'uploaded', 'not_scanned');

-- ===========================================================================
-- 1. compute_split
-- ===========================================================================
SELECT t.eq('compute_split_with_affiliate_platform',
  (SELECT platform_fee_kobo::text FROM public.compute_split(1000000::bigint, 3000, 1000, true)), '100000');
SELECT t.eq('compute_split_with_affiliate_commission',
  (SELECT affiliate_commission_kobo::text FROM public.compute_split(1000000::bigint, 3000, 1000, true)), '300000');
SELECT t.eq('compute_split_with_affiliate_vendor',
  (SELECT vendor_net_kobo::text FROM public.compute_split(1000000::bigint, 3000, 1000, true)), '600000');
SELECT t.eq('compute_split_without_affiliate_commission',
  (SELECT affiliate_commission_kobo::text FROM public.compute_split(1000000::bigint, 3000, 1000, false)), '0');
SELECT t.eq('compute_split_without_affiliate_vendor',
  (SELECT vendor_net_kobo::text FROM public.compute_split(1000000::bigint, 3000, 1000, false)), '900000');

-- Property test: 2,000 random prices and rates. The three parts must always add
-- up to the price and none may be negative.
SELECT setseed(0.4242);
WITH cases AS (
  SELECT
    (1 + floor(random() * 1000000000))::bigint                    AS price,
    (500 + floor(random() * 7501))::int                           AS commission_bps,
    floor(random() * 2001)::int                                   AS fee_bps,
    (random() < 0.5)                                              AS has_affiliate
  FROM generate_series(1, 2000)
), split AS (
  SELECT c.price, s.platform_fee_kobo, s.affiliate_commission_kobo, s.vendor_net_kobo
  FROM cases c
  CROSS JOIN LATERAL public.compute_split(c.price, c.commission_bps, c.fee_bps, c.has_affiliate) s
)
SELECT t.eq('compute_split_property_2000_cases',
  (SELECT count(*)::text FROM split
    WHERE platform_fee_kobo + affiliate_commission_kobo + vendor_net_kobo <> price
       OR platform_fee_kobo < 0 OR affiliate_commission_kobo < 0 OR vendor_net_kobo < 0),
  '0');

-- ===========================================================================
-- 2. Posting example: 1,000,000 kobo order with an affiliate, 25,000 fee
-- ===========================================================================
UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'vat_enabled';

CREATE TEMP TABLE t_main AS
SELECT public.create_order(
  '11111111-1111-1111-1111-111111111101'::uuid,
  'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid,
  '11111111-1111-1111-1111-111111111106'::uuid,
  gen_random_uuid(), 'iphash', 'REF-MAIN-1'
) AS res;

SELECT t.eq('create_order_affiliate_applied', (SELECT (res->>'affiliate_applied') FROM t_main), 'true');
SELECT t.eq('create_order_total', (SELECT (res->>'total_kobo') FROM t_main), '1000000');
SELECT t.eq('create_order_number_format',
  ((SELECT (res->>'number') FROM t_main) ~ '^AFV-[0-9]{4}-[0-9]{6}$')::text, 'true');

CREATE TEMP TABLE t_paid AS
SELECT public.process_paid_order(
  'REF-MAIN-1', 9001, 1000000, 'NGN', 25000, 'card', now()
) AS res;

SELECT t.eq('process_paid_first_call', (SELECT (res->>'status') FROM t_paid), 'processed');

CREATE TEMP TABLE t_main_order AS
SELECT o.* FROM public.orders o WHERE o.paystack_reference = 'REF-MAIN-1';

SELECT t.eq('order_status_paid', (SELECT status::text FROM t_main_order), 'paid');
SELECT t.eq('order_processor_fee', (SELECT processor_fee_kobo::text FROM t_main_order), '25000');

-- The posting itself.
CREATE TEMP TABLE t_main_txn AS
SELECT t.id FROM public.ledger_transactions t
WHERE t.idempotency_key = 'order_paid:' || (SELECT id::text FROM t_main_order);

SELECT t.eq('ledger_debit_paystack',
  (SELECT debit_kobo::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 1), '975000');
SELECT t.eq('ledger_debit_processor_fees',
  (SELECT debit_kobo::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 2), '25000');
SELECT t.eq('ledger_credit_vendor_payable',
  (SELECT credit_kobo::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 3), '600000');
SELECT t.eq('ledger_credit_affiliate_payable',
  (SELECT credit_kobo::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 4), '300000');
SELECT t.eq('ledger_credit_platform_revenue',
  (SELECT credit_kobo::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 5), '100000');
SELECT t.eq('ledger_no_vat_entry_when_disabled',
  (SELECT count(*)::text FROM public.ledger_entries e
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 7), '0');

SELECT t.eq('ledger_transaction_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_main_txn)), 'true');
SELECT t.eq('ledger_five_entries',
  (SELECT count(*)::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_main_txn)), '5');

-- Vendor hold: paid_at + commission_hold_days (7 by default).
SELECT t.eq('vendor_available_at_is_paid_plus_7_days',
  (SELECT (e.available_at = o.paid_at + interval '7 days')::text
     FROM public.ledger_entries e, t_main_order o
    WHERE e.txn_id = (SELECT id FROM t_main_txn) AND e.account_id = 3), 'true');

SELECT t.eq('vendor_balance_pending',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111103'::uuid) ->> 'pending_kobo')),
  '600000');
SELECT t.eq('vendor_balance_available_now',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111103'::uuid) ->> 'available_kobo')),
  '0');
SELECT t.eq('vendor_balance_total',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111103'::uuid) ->> 'total_kobo')),
  '600000');

-- Simulate the hold expiring. The ledger is append-only, so the test lifts the
-- guard for one statement and puts it straight back.
ALTER TABLE public.ledger_entries DISABLE TRIGGER ledger_entries_no_update_or_delete;
UPDATE public.ledger_entries SET available_at = now() - interval '1 minute'
 WHERE txn_id = (SELECT id FROM t_main_txn) AND account_id IN (3, 4);
ALTER TABLE public.ledger_entries ENABLE TRIGGER ledger_entries_no_update_or_delete;

SELECT t.eq('vendor_balance_available_after_hold',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111103'::uuid) ->> 'available_kobo')),
  '600000');
SELECT t.eq('vendor_balance_pending_after_hold',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111103'::uuid) ->> 'pending_kobo')),
  '0');

-- Entitlements: one per uploaded file, with the snapshotted limit.
SELECT t.eq('entitlements_one_per_uploaded_file',
  (SELECT count(*)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
    WHERE i.order_id = (SELECT id FROM t_main_order)), '2');
SELECT t.eq('entitlement_max_downloads_snapshot',
  (SELECT min(e.max_downloads)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
    WHERE i.order_id = (SELECT id FROM t_main_order)), '3');

SELECT t.eq('job_order_paid_enqueued_once',
  (SELECT count(*)::text FROM public.jobs
    WHERE dedupe_key = 'order_paid:' || (SELECT id::text FROM t_main_order)), '1');

-- Second call: nothing changes.
CREATE TEMP TABLE t_second AS
SELECT public.process_paid_order('REF-MAIN-1', 9001, 1000000, 'NGN', 25000, 'card', now()) AS res;

SELECT t.eq('process_paid_second_call', (SELECT (res->>'status') FROM t_second), 'already_paid');
SELECT t.eq('process_paid_second_call_no_new_ledger',
  (SELECT count(*)::text FROM public.ledger_transactions
    WHERE idempotency_key = 'order_paid:' || (SELECT id::text FROM t_main_order)), '1');
SELECT t.eq('process_paid_second_call_no_new_entries',
  (SELECT count(*)::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_main_txn)), '5');

-- ===========================================================================
-- 3. process_paid_order mismatches
-- ===========================================================================
CREATE TEMP TABLE t_mm AS
SELECT (public.create_order(
  '11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-MM-1') ->> 'order_id')::uuid AS order_id;

SELECT t.eq('process_paid_amount_mismatch',
  (SELECT (public.process_paid_order('REF-MM-1', 9100, 999, 'NGN', 0, 'card', now()) ->> 'status')),
  'mismatch');
SELECT t.eq('mismatch_no_ledger',
  (SELECT count(*)::text FROM public.ledger_transactions t
    WHERE t.idempotency_key = 'order_paid:' || (SELECT order_id::text FROM t_mm)), '0');
SELECT t.eq('mismatch_no_entitlements',
  (SELECT count(*)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
    WHERE i.order_id = (SELECT order_id FROM t_mm)), '0');
SELECT t.eq('mismatch_audited',
  (SELECT count(*)::text FROM public.audit_log
    WHERE action = 'order.mismatch' AND entity_id = (SELECT order_id::text FROM t_mm)), '1');

SELECT t.eq('process_paid_currency_mismatch',
  (SELECT (public.process_paid_order('REF-MM-1', 9101, 1000000, 'USD', 0, 'card', now()) ->> 'status')),
  'mismatch');
SELECT t.eq('currency_mismatch_no_ledger',
  (SELECT count(*)::text FROM public.ledger_transactions t
    WHERE t.idempotency_key = 'order_paid:' || (SELECT order_id::text FROM t_mm)), '0');

SELECT t.eq('process_paid_unknown_reference',
  (SELECT (public.process_paid_order('REF-NOPE', 1, 1, 'NGN', 0, 'card', now()) ->> 'status')),
  'not_found');

-- An expired order that is paid late is still processed.
CREATE TEMP TABLE t_late AS
SELECT (public.create_order(
  '11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-LATE-1') ->> 'order_id')::uuid AS order_id;

UPDATE public.orders SET expires_at = now() - interval '1 hour'
 WHERE id = (SELECT order_id FROM t_late);
SELECT public.expire_pending_orders(500);
SELECT t.eq('expire_sweep_set_expired',
  (SELECT status::text FROM public.orders WHERE id = (SELECT order_id FROM t_late)), 'expired');
SELECT t.eq('process_paid_expired_order_late',
  (SELECT (public.process_paid_order('REF-LATE-1', 9200, 1000000, 'NGN', 0, 'card', now()) ->> 'status')),
  'processed');

-- ===========================================================================
-- 4. create_order validations
-- ===========================================================================
SELECT t.raises('create_order_product_not_live', format(
  'SELECT public.create_order(%L::uuid, %L, %L, %L::uuid, NULL, NULL, NULL, %L)',
  '11111111-1111-1111-1111-111111111101', 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222202', 'REF-V1'), 'product_unavailable');

SELECT t.raises('create_order_vendor_suspended', format(
  'SELECT public.create_order(%L::uuid, %L, %L, %L::uuid, NULL, NULL, NULL, %L)',
  '11111111-1111-1111-1111-111111111101', 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222203', 'REF-V2'), 'product_unavailable');

UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'guest_checkout_enabled';
SELECT t.raises('create_order_guest_disabled', format(
  'SELECT public.create_order(NULL::uuid, %L, %L, %L::uuid, NULL, NULL, NULL, %L)',
  'guest@example.com', 'Guest',
  '22222222-2222-2222-2222-222222222201', 'REF-V3'), 'guest_checkout_disabled');
UPDATE public.settings SET value = 'true'::jsonb WHERE key = 'guest_checkout_enabled';

SELECT t.eq('create_order_guest_allowed_when_enabled',
  (SELECT (public.create_order(NULL::uuid, 'guest@example.com', 'Guest',
     '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-V4')
     ->> 'affiliate_applied')), 'false');

-- Self referral is dropped.
SELECT t.eq('create_order_self_referral_dropped',
  (SELECT (public.create_order(
     '11111111-1111-1111-1111-111111111106'::uuid, 'affiliate@example.com', 'Aff',
     '22222222-2222-2222-2222-222222222201'::uuid,
     '11111111-1111-1111-1111-111111111106'::uuid, NULL, NULL, 'REF-V5')
     ->> 'affiliate_applied')), 'false');

-- The vendor cannot be their own affiliate.
SELECT t.eq('create_order_vendor_as_affiliate_dropped',
  (SELECT (public.create_order(NULL::uuid, 'guest@example.com', 'Guest',
     '22222222-2222-2222-2222-222222222201'::uuid,
     '11111111-1111-1111-1111-111111111103'::uuid, NULL, NULL, 'REF-V6')
     ->> 'affiliate_applied')), 'false');

-- A product that requires approval drops the affiliate.
SELECT t.eq('create_order_approval_product_drops_affiliate',
  (SELECT (public.create_order(NULL::uuid, 'guest@example.com', 'Guest',
     '22222222-2222-2222-2222-222222222204'::uuid,
     '11111111-1111-1111-1111-111111111106'::uuid, NULL, NULL, 'REF-V7')
     ->> 'affiliate_applied')), 'false');

SELECT t.raises('create_order_duplicate_reference', format(
  'SELECT public.create_order(%L::uuid, %L, %L, %L::uuid, NULL, NULL, NULL, %L)',
  '11111111-1111-1111-1111-111111111101', 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201', 'REF-MAIN-1'), 'duplicate_reference');

-- ===========================================================================
-- 5. VAT
-- ===========================================================================
-- 5.1 platform_fee basis at 750 bps: fee 100,000 -> tax 7,500, vendor 592,500
UPDATE public.settings SET value = 'true'::jsonb  WHERE key = 'vat_enabled';
UPDATE public.settings SET value = '750'::jsonb   WHERE key = 'vat_rate_bps';
UPDATE public.settings SET value = '"platform_fee"'::jsonb WHERE key = 'vat_applies_to';
UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'prices_include_vat';

CREATE TEMP TABLE t_vat1 AS
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, '11111111-1111-1111-1111-111111111106'::uuid,
  NULL, NULL, 'REF-VAT-1') AS res;

SELECT t.eq('vat_platform_fee_buyer_total_unchanged',
  (SELECT (res->>'total_kobo') FROM t_vat1), '1000000');

SELECT public.process_paid_order('REF-VAT-1', 9300, 1000000, 'NGN', 25000, 'card', now());

CREATE TEMP TABLE t_vat1_order AS SELECT * FROM public.orders WHERE paystack_reference = 'REF-VAT-1';
CREATE TEMP TABLE t_vat1_txn AS
SELECT id FROM public.ledger_transactions
WHERE idempotency_key = 'order_paid:' || (SELECT id::text FROM t_vat1_order);

SELECT t.eq('vat_platform_fee_tax_line',
  (SELECT tax_kobo::text FROM public.order_tax_lines
    WHERE order_id = (SELECT id FROM t_vat1_order) AND basis = 'platform_fee'), '7500');
SELECT t.eq('vat_platform_fee_supplier',
  (SELECT supplier FROM public.order_tax_lines
    WHERE order_id = (SELECT id FROM t_vat1_order) AND basis = 'platform_fee'), 'affilova');
SELECT t.eq('vat_platform_fee_vendor_net',
  (SELECT vendor_net_kobo::text FROM public.order_items
    WHERE order_id = (SELECT id FROM t_vat1_order)), '592500');
SELECT t.eq('vat_platform_fee_tax_deducted',
  (SELECT tax_deducted_kobo::text FROM public.order_items
    WHERE order_id = (SELECT id FROM t_vat1_order)), '7500');
SELECT t.eq('vat_platform_fee_credit_vat_payable',
  (SELECT credit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_vat1_txn) AND account_id = 7), '7500');
SELECT t.eq('vat_platform_fee_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_vat1_txn)), 'true');

-- 5.2 product_price, prices include VAT
UPDATE public.settings SET value = '"product_price"'::jsonb WHERE key = 'vat_applies_to';
UPDATE public.settings SET value = 'true'::jsonb WHERE key = 'prices_include_vat';

CREATE TEMP TABLE t_vat2 AS
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, '11111111-1111-1111-1111-111111111106'::uuid,
  NULL, NULL, 'REF-VAT-2') AS res;

SELECT t.eq('vat_inclusive_buyer_pays_listed_price', (SELECT (res->>'total_kobo') FROM t_vat2), '1000000');
SELECT public.process_paid_order('REF-VAT-2', 9301, 1000000, 'NGN', 25000, 'card', now());
CREATE TEMP TABLE t_vat2_order AS SELECT * FROM public.orders WHERE paystack_reference = 'REF-VAT-2';
CREATE TEMP TABLE t_vat2_txn AS
SELECT id FROM public.ledger_transactions WHERE idempotency_key = 'order_paid:' || (SELECT id::text FROM t_vat2_order);

-- tax = 1000000 - floor(1000000 * 10000 / 10750) = 69768
SELECT t.eq('vat_inclusive_tax_amount',
  (SELECT tax_kobo::text FROM public.order_tax_lines
    WHERE order_id = (SELECT id FROM t_vat2_order) AND basis = 'product_price'), '69768');
SELECT t.eq('vat_inclusive_tax_line_included',
  (SELECT included::text FROM public.order_tax_lines
    WHERE order_id = (SELECT id FROM t_vat2_order)), 'true');
SELECT t.eq('vat_inclusive_split_on_net',
  (SELECT platform_fee_kobo::text FROM public.order_items
    WHERE order_id = (SELECT id FROM t_vat2_order)), '93023');
SELECT t.eq('vat_inclusive_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_vat2_txn)), 'true');
SELECT t.eq('vat_inclusive_vat_credit',
  (SELECT credit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_vat2_txn) AND account_id = 7), '69768');

-- 5.3 product_price, prices exclude VAT
UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'prices_include_vat';

CREATE TEMP TABLE t_vat3 AS
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-VAT-3') AS res;

SELECT t.eq('vat_exclusive_buyer_total', (SELECT (res->>'total_kobo') FROM t_vat3), '1075000');
SELECT t.eq('vat_exclusive_order_tax', (SELECT tax_kobo::text FROM public.orders
  WHERE paystack_reference = 'REF-VAT-3'), '75000');
SELECT public.process_paid_order('REF-VAT-3', 9302, 1075000, 'NGN', 25000, 'card', now());
CREATE TEMP TABLE t_vat3_order AS SELECT * FROM public.orders WHERE paystack_reference = 'REF-VAT-3';
CREATE TEMP TABLE t_vat3_txn AS
SELECT id FROM public.ledger_transactions WHERE idempotency_key = 'order_paid:' || (SELECT id::text FROM t_vat3_order);
SELECT t.eq('vat_exclusive_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM t_vat3_txn)), 'true');
SELECT t.eq('vat_exclusive_vendor_net_unchanged',
  (SELECT vendor_net_kobo::text FROM public.order_items
    WHERE order_id = (SELECT id FROM t_vat3_order)), '900000');

-- 5.4 VAT switched off: no tax line, no vat entry
UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'vat_enabled';
CREATE TEMP TABLE t_vat4 AS
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-VAT-4') AS res;
SELECT t.eq('vat_disabled_no_tax_lines',
  (SELECT count(*)::text FROM public.order_tax_lines
    WHERE order_id = (SELECT (res->>'order_id')::uuid FROM t_vat4)), '0');
SELECT t.eq('vat_disabled_total_is_subtotal', (SELECT (res->>'total_kobo') FROM t_vat4), '1000000');
SELECT public.process_paid_order('REF-VAT-4', 9303, 1000000, 'NGN', 25000, 'card', now());
CREATE TEMP TABLE t_vat4_order AS SELECT * FROM public.orders WHERE paystack_reference = 'REF-VAT-4';
SELECT t.eq('vat_disabled_no_vat_credit',
  (SELECT count(*)::text FROM public.ledger_entries e
     JOIN public.ledger_transactions t ON t.id = e.txn_id
    WHERE t.idempotency_key = 'order_paid:' || (SELECT id::text FROM t_vat4_order)
      AND e.account_id = 7), '0');

-- 5.5 Lagos month boundary: paid 23:30 UTC on 31 January is 00:30 on 1 February
UPDATE public.settings SET value = 'true'::jsonb WHERE key = 'vat_enabled';
UPDATE public.settings SET value = '"platform_fee"'::jsonb WHERE key = 'vat_applies_to';

CREATE TEMP TABLE t_bound AS
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-BOUND-1') AS res;

SELECT public.process_paid_order(
  'REF-BOUND-1', 9400, 1000000, 'NGN', 25000, 'card', '2026-01-31 23:30:00+00');

SELECT t.eq('vat_boundary_falls_into_next_lagos_month',
  (SELECT (public.vat_period_summary('2026-02-01'::date) ->> 'output_vat_kobo')), '7500');
SELECT t.eq('vat_boundary_absent_from_previous_month',
  (SELECT (public.vat_period_summary('2026-01-01'::date) ->> 'output_vat_kobo')), '0');
SELECT t.eq('vat_period_due_date_is_21st',
  (SELECT (public.vat_period_summary('2026-02-01'::date) ->> 'due_date')), '2026-03-21');

-- 5.6 Period status transitions and adjustments
SELECT t.eq('vat_period_starts_open',
  (SELECT (public.vat_period_summary('2027-03-01'::date) ->> 'status')), 'open');

SELECT t.raises('vat_remit_without_filing_refused', format(
  'SELECT public.set_vat_period_status(%L::uuid, %L::date, %L, 0, %L, NULL, NULL)',
  '11111111-1111-1111-1111-111111111109', '2027-03-01', 'remitted', 'PAYREF-1'), 'bad_state');

SELECT t.raises('vat_filing_requires_finance_role', format(
  'SELECT public.set_vat_period_status(%L::uuid, %L::date, %L, NULL, NULL, NULL, NULL)',
  '11111111-1111-1111-1111-111111111110', '2027-03-01', 'filed'), 'forbidden');

SELECT public.set_vat_period_status('11111111-1111-1111-1111-111111111109'::uuid, '2027-03-01'::date, 'filed', NULL, NULL, NULL, 'Filed on time');
SELECT t.eq('vat_period_filed', (SELECT (public.vat_period_summary('2027-03-01'::date) ->> 'status')), 'filed');

SELECT t.raises('vat_remit_needs_reference', format(
  'SELECT public.set_vat_period_status(%L::uuid, %L::date, %L, 0, NULL, NULL, NULL)',
  '11111111-1111-1111-1111-111111111109', '2027-03-01', 'remitted'), 'invalid_payment_reference');

SELECT public.set_vat_period_status('11111111-1111-1111-1111-111111111108'::uuid, '2027-03-01'::date, 'remitted', 0, 'PAYREF-2', 'receipts/2027-03.pdf', 'Paid');
SELECT t.eq('vat_period_remitted', (SELECT (public.vat_period_summary('2027-03-01'::date) ->> 'status')), 'remitted');

SELECT t.raises('vat_remitted_period_is_closed', format(
  'SELECT public.set_vat_period_status(%L::uuid, %L::date, %L, 100, %L, NULL, NULL)',
  '11111111-1111-1111-1111-111111111108', '2027-03-01', 'remitted', 'PAYREF-3'), 'period_closed');

SELECT t.ok('vat_adjustment_after_remitting', (
  SELECT public.add_vat_adjustment('11111111-1111-1111-1111-111111111109'::uuid, '2027-03-01'::date, 2500, 'Late invoice correction') IS NOT NULL
));
SELECT t.eq('vat_adjustment_changes_net',
  (SELECT (public.vat_period_summary('2027-03-01'::date) ->> 'adjustments_kobo')), '2500');
SELECT t.raises('vat_adjustment_needs_reason', format(
  'SELECT public.add_vat_adjustment(%L::uuid, %L::date, 100, %L)',
  '11111111-1111-1111-1111-111111111109', '2027-03-01', 'bad'), 'invalid_reason');
SELECT t.raises('vat_adjustment_needs_amount', format(
  'SELECT public.add_vat_adjustment(%L::uuid, %L::date, 0, %L)',
  '11111111-1111-1111-1111-111111111109', '2027-03-01', 'Zero is not an adjustment'), 'invalid_amount');

UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'vat_enabled';
SQL

if run_file "$SUITE" >/dev/null 2>"$SUITE.err"; then
  echo "  (sql suite part 1 ran)"
else
  echo "  !! sql suite part 1 aborted"
  tail -20 "$SUITE.err" | sed 's/^/       /'
  FAILED=$((FAILED + 1))
fi
rm -f "$SUITE" "$SUITE.err"

# ---------------------------------------------------------------------------
# 4. The SQL suite, part 2: refunds, disputes, downloads, payout rules, RLS
# ---------------------------------------------------------------------------
SUITE=$(tmpfile)
cat > "$SUITE" <<'SQL'
-- A second vendor with its own live product and clean file.
INSERT INTO public.products (
  id, vendor_id, category_id, title, slug, short_description, description,
  price_kobo, commission_bps, affiliate_approval, refund_window_hours,
  max_downloads, status
) VALUES (
  '22222222-2222-2222-2222-222222222206', '11111111-1111-1111-1111-111111111104', 1,
  'Beta Product', 'beta-product', 'A product from the second vendor.', 'Body.',
  1000000, 3000, 'open', 48, 2, 'live'
);
INSERT INTO public.product_files (
  id, product_id, storage_key, original_name, content_type, size_bytes, status, scan_status
) VALUES (
  '33333333-3333-3333-3333-333333333304', '22222222-2222-2222-2222-222222222206',
  'products/p6/f4/four.pdf', 'four.pdf', 'application/pdf', 512, 'uploaded', 'clean'
);

UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'vat_enabled';

-- ===========================================================================
-- 6. Refunds
-- ===========================================================================
-- 6.1 inside the 48 hour window: auto-approved
SELECT t.eq('refund_auto_approved_inside_window',
  (SELECT (public.request_refund(
     '11111111-1111-1111-1111-111111111101'::uuid,
     (SELECT id FROM public.orders WHERE paystack_reference = 'REF-MAIN-1'),
     'The file was not what I expected') ->> 'auto_approved')), 'true');

SELECT t.eq('refund_auto_approved_status',
  (SELECT r.status FROM public.refund_requests r
     JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-MAIN-1'), 'approved');

-- 6.2 outside the window: stays requested
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-R2');
SELECT public.process_paid_order('REF-R2', 9500, 1000000, 'NGN', 25000, 'card', now() - interval '100 hours');

SELECT t.eq('refund_outside_window_not_auto',
  (SELECT (public.request_refund(
     '11111111-1111-1111-1111-111111111101'::uuid,
     (SELECT id FROM public.orders WHERE paystack_reference = 'REF-R2'),
     'I changed my mind after two weeks') ->> 'auto_approved')), 'false');
SELECT t.eq('refund_outside_window_status',
  (SELECT r.status FROM public.refund_requests r
     JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R2'), 'requested');

-- 6.3 the buyer cannot decide their own request
SELECT t.raises('refund_self_decision_refused', format(
  'SELECT public.decide_refund(%L::uuid, %L::uuid, %L, %L)',
  '11111111-1111-1111-1111-111111111101',
  (SELECT r.id::text FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R2'),
  'approve', 'Approving my own request'), 'self_decision');

-- 6.4 a rejection needs a real note
SELECT t.raises('refund_reject_needs_note', format(
  'SELECT public.decide_refund(%L::uuid, %L::uuid, %L, %L)',
  '11111111-1111-1111-1111-111111111103',
  (SELECT r.id::text FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R2'),
  'reject', 'no'), 'note_required');

-- 6.5 the vendor decides
SELECT t.eq('refund_vendor_rejects',
  (SELECT (public.decide_refund(
     '11111111-1111-1111-1111-111111111103'::uuid,
     (SELECT r.id FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
       WHERE o.paystack_reference = 'REF-R2'),
     'reject', 'Outside the stated refund window.') ->> 'amount_kobo')), '1000000');
SELECT t.eq('refund_vendor_reject_status',
  (SELECT r.status FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R2'), 'rejected');

-- 6.6 staff decides
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-R3');
SELECT public.process_paid_order('REF-R3', 9501, 1000000, 'NGN', 25000, 'card', now() - interval '100 hours');
SELECT public.request_refund('11111111-1111-1111-1111-111111111101'::uuid,
  (SELECT id FROM public.orders WHERE paystack_reference = 'REF-R3'),
  'The download link never worked');
SELECT t.eq('refund_finance_approves',
  (SELECT (public.decide_refund(
     '11111111-1111-1111-1111-111111111109'::uuid,
     (SELECT r.id FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
       WHERE o.paystack_reference = 'REF-R3'),
     'approve', 'Approved as a goodwill gesture.') ->> 'order_reference')), 'REF-R3');

-- 6.7 processing: partial refused, full reverses, idempotent, entitlements revoked
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, '11111111-1111-1111-1111-111111111106'::uuid,
  NULL, NULL, 'REF-R4');
SELECT public.process_paid_order('REF-R4', 9502, 1000000, 'NGN', 25000, 'card', now());
SELECT public.request_refund('11111111-1111-1111-1111-111111111101'::uuid,
  (SELECT id FROM public.orders WHERE paystack_reference = 'REF-R4'),
  'Requesting a full refund please');

SELECT t.raises('refund_partial_refused', format(
  'SELECT public.process_refund(%L::uuid, %L, %L)',
  (SELECT r.id::text FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R4'),
  'PROV-1', 500000), 'partial_refund_unsupported');

SELECT t.eq('refund_processed',
  (SELECT (public.process_refund(
     (SELECT r.id FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
       WHERE o.paystack_reference = 'REF-R4'),
     'PROV-1', 1000000) ->> 'status')), 'processed');

CREATE TEMP TABLE t_r4 AS SELECT * FROM public.orders WHERE paystack_reference = 'REF-R4';

SELECT t.eq('refund_order_status', (SELECT status::text FROM t_r4), 'refunded');
SELECT t.eq('refund_request_status',
  (SELECT r.status FROM public.refund_requests r WHERE r.order_id = (SELECT id FROM t_r4)), 'processed');
SELECT t.eq('refund_reversal_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4))), 'true');
SELECT t.eq('refund_credit_paystack_full',
  (SELECT credit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4))
      AND account_id = 1), '1000000');
SELECT t.eq('refund_debit_vendor_net',
  (SELECT debit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4))
      AND account_id = 3), '600000');
SELECT t.eq('refund_debit_affiliate',
  (SELECT debit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4))
      AND account_id = 4), '300000');
SELECT t.eq('refund_debit_platform',
  (SELECT debit_kobo::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4))
      AND account_id = 5), '100000');
SELECT t.eq('refund_entitlements_revoked',
  (SELECT count(*)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
    WHERE i.order_id = (SELECT id FROM t_r4) AND e.revoked_reason = 'refund'), '2');
SELECT t.eq('refund_second_call_idempotent',
  (SELECT (public.process_refund(
     (SELECT r.id FROM public.refund_requests r WHERE r.order_id = (SELECT id FROM t_r4)),
     'PROV-1', 1000000) ->> 'status')), 'already_processed');
SELECT t.eq('refund_no_second_reversal',
  (SELECT count(*)::text FROM public.ledger_transactions
    WHERE idempotency_key = 'order_refund:' || (SELECT id::text FROM t_r4)), '1');

-- 6.8 a refund after the money was withdrawn leaves a negative balance
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222206'::uuid, '11111111-1111-1111-1111-111111111106'::uuid,
  NULL, NULL, 'REF-R5');
SELECT public.process_paid_order('REF-R5', 9503, 1000000, 'NGN', 25000, 'card', now());

-- Simulate a payout that already left: debit the vendor and hold it in transit.
INSERT INTO public.ledger_transactions (kind, ref_type, ref_id, description, idempotency_key)
VALUES ('test_payout', 'test', NULL, 'Simulated payout', 'test_payout:' || (SELECT id::text FROM public.orders WHERE paystack_reference = 'REF-R5'));
-- Both sides in one statement: the balance check is deferred to the end of the
-- statement's transaction, so a two-statement posting would trip it.
INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
SELECT t.id, 3, '11111111-1111-1111-1111-111111111104'::uuid, 600000, 0
FROM public.ledger_transactions t
WHERE t.idempotency_key = 'test_payout:' || (SELECT id::text FROM public.orders WHERE paystack_reference = 'REF-R5')
UNION ALL
SELECT t.id, 8, NULL, 0, 600000
FROM public.ledger_transactions t
WHERE t.idempotency_key = 'test_payout:' || (SELECT id::text FROM public.orders WHERE paystack_reference = 'REF-R5');

SELECT t.eq('vendor2_balance_zero_before_refund',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111104'::uuid) ->> 'total_kobo')), '0');

SELECT public.request_refund('11111111-1111-1111-1111-111111111101'::uuid,
  (SELECT id FROM public.orders WHERE paystack_reference = 'REF-R5'),
  'Refund please, the file is broken');
SELECT public.process_refund(
  (SELECT r.id FROM public.refund_requests r JOIN public.orders o ON o.id = r.order_id
    WHERE o.paystack_reference = 'REF-R5'),
  'PROV-2', 1000000);

SELECT t.eq('refund_negative_balance_flagged',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111104'::uuid) ->> 'negative')), 'true');
SELECT t.eq('refund_negative_total',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111104'::uuid) ->> 'total_kobo')), '-600000');
SELECT t.eq('refund_negative_available_reported_zero',
  (SELECT (public.get_party_balance('11111111-1111-1111-1111-111111111104'::uuid) ->> 'available_kobo')), '0');

-- ===========================================================================
-- 7. Disputes
-- ===========================================================================
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-D1');
SELECT public.process_paid_order('REF-D1', 9600, 1000000, 'NGN', 25000, 'card', now());

SELECT t.eq('dispute_opened',
  (SELECT (public.open_dispute('REF-D1', 'Buyer raised a chargeback') ->> 'status')), 'disputed');
SELECT t.eq('dispute_order_status',
  (SELECT status::text FROM public.orders WHERE paystack_reference = 'REF-D1'), 'disputed');
SELECT t.eq('dispute_revokes_entitlements',
  (SELECT count(*)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
     JOIN public.orders o ON o.id = i.order_id
    WHERE o.paystack_reference = 'REF-D1' AND e.revoked_reason = 'dispute'), '2');
SELECT t.eq('dispute_won_restores_entitlements',
  (SELECT (public.resolve_dispute(
     (SELECT id FROM public.orders WHERE paystack_reference = 'REF-D1'), 'won') ->> 'order_status')), 'paid');
SELECT t.eq('dispute_won_order_paid',
  (SELECT status::text FROM public.orders WHERE paystack_reference = 'REF-D1'), 'paid');
SELECT t.eq('dispute_won_entitlements_live',
  (SELECT count(*)::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
     JOIN public.orders o ON o.id = i.order_id
    WHERE o.paystack_reference = 'REF-D1' AND e.revoked_at IS NULL), '2');

SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-D2');
SELECT public.process_paid_order('REF-D2', 9601, 1000000, 'NGN', 25000, 'card', now());
SELECT public.open_dispute('REF-D2', 'Lost chargeback');
SELECT t.eq('dispute_lost_refunds_order',
  (SELECT (public.resolve_dispute(
     (SELECT id FROM public.orders WHERE paystack_reference = 'REF-D2'), 'lost') ->> 'order_status')), 'refunded');
SELECT t.eq('dispute_lost_order_status',
  (SELECT status::text FROM public.orders WHERE paystack_reference = 'REF-D2'), 'refunded');
SELECT t.eq('dispute_lost_reversal_exists',
  (SELECT count(*)::text FROM public.ledger_transactions
    WHERE idempotency_key = 'order_dispute_lost:' ||
      (SELECT id::text FROM public.orders WHERE paystack_reference = 'REF-D2')), '1');
SELECT t.eq('dispute_lost_reversal_balances',
  (SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries
    WHERE txn_id = (SELECT id FROM public.ledger_transactions
                     WHERE idempotency_key = 'order_dispute_lost:' ||
                       (SELECT id::text FROM public.orders WHERE paystack_reference = 'REF-D2'))), 'true');

-- ===========================================================================
-- 8. Downloads
-- ===========================================================================
CREATE TEMP TABLE t_dl AS
SELECT e.id AS entitlement_id, e.max_downloads
FROM public.entitlements e
JOIN public.order_items i ON i.id = e.order_item_id
JOIN public.orders o ON o.id = i.order_id
JOIN public.product_files f ON f.id = e.file_id
WHERE o.paystack_reference = 'REF-LATE-1'
  AND f.original_name = 'one.pdf'
LIMIT 1;

SELECT t.eq('download_owner_by_user_id',
  (SELECT (public.claim_download((SELECT entitlement_id FROM t_dl),
     '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'ip1') ->> 'filename')), 'one.pdf');
SELECT t.eq('download_counter_incremented',
  (SELECT downloads_used::text FROM public.entitlements WHERE id = (SELECT entitlement_id FROM t_dl)), '1');
SELECT t.eq('download_log_written',
  (SELECT count(*)::text FROM public.download_log WHERE entitlement_id = (SELECT entitlement_id FROM t_dl)), '1');

SELECT t.eq('download_owner_by_email',
  (SELECT (public.claim_download((SELECT entitlement_id FROM t_dl),
     NULL, 'BUYER@Example.com', 'ip2') ->> 'storage_key')), 'products/p1/f1/one.pdf');

SELECT t.raises('download_wrong_owner_refused', format(
  'SELECT public.claim_download(%L::uuid, %L::uuid, %L, NULL)',
  (SELECT entitlement_id::text FROM t_dl),
  '11111111-1111-1111-1111-111111111111', 'outsider@example.com'), 'forbidden');

SELECT public.claim_download((SELECT entitlement_id FROM t_dl),
  '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'ip3');
SELECT t.eq('download_counter_at_limit',
  (SELECT downloads_used::text FROM public.entitlements WHERE id = (SELECT entitlement_id FROM t_dl)), '3');
SELECT t.raises('download_over_limit_refused', format(
  'SELECT public.claim_download(%L::uuid, %L::uuid, NULL, NULL)',
  (SELECT entitlement_id::text FROM t_dl),
  '11111111-1111-1111-1111-111111111101'), 'download_limit');

SELECT t.raises('download_revoked_refused', format(
  'SELECT public.claim_download(%L::uuid, %L::uuid, NULL, NULL)',
  (SELECT e.id::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
     JOIN public.orders o ON o.id = i.order_id
    WHERE o.paystack_reference = 'REF-R4' LIMIT 1),
  '11111111-1111-1111-1111-111111111101'), 'revoked');

-- Unclean file: a paid order on the product whose only file is not_scanned.
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222205'::uuid, NULL, NULL, NULL, 'REF-UNCLEAN-1');
SELECT public.process_paid_order('REF-UNCLEAN-1', 9700, 500000, 'NGN', 15000, 'card', now());
SELECT t.raises('download_unclean_file_refused', format(
  'SELECT public.claim_download(%L::uuid, %L::uuid, NULL, NULL)',
  (SELECT e.id::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
     JOIN public.orders o ON o.id = i.order_id
    WHERE o.paystack_reference = 'REF-UNCLEAN-1' LIMIT 1),
  '11111111-1111-1111-1111-111111111101'), 'file_not_clean');

-- Unpaid order: an entitlement that exists while the order is still pending.
SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One',
  '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-UNPAID-1');
INSERT INTO public.entitlements (order_item_id, product_id, file_id, buyer_user_id, buyer_email, max_downloads)
SELECT i.id, i.product_id, '33333333-3333-3333-3333-333333333301'::uuid,
       '11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 3
FROM public.order_items i
JOIN public.orders o ON o.id = i.order_id
WHERE o.paystack_reference = 'REF-UNPAID-1';

SELECT t.raises('download_unpaid_order_refused', format(
  'SELECT public.claim_download(%L::uuid, %L::uuid, NULL, NULL)',
  (SELECT e.id::text FROM public.entitlements e
     JOIN public.order_items i ON i.id = e.order_item_id
     JOIN public.orders o ON o.id = i.order_id
    WHERE o.paystack_reference = 'REF-UNPAID-1' LIMIT 1),
  '11111111-1111-1111-1111-111111111101'), 'order_not_paid');

-- ===========================================================================
-- 9. Payout rules
-- ===========================================================================
SELECT t.eq('withdrawal_fee_two_percent', (SELECT public.compute_withdrawal_fee(500000)::text), '10000');
UPDATE public.settings SET value = '10000'::jsonb WHERE key = 'min_withdrawal_kobo';
SELECT t.eq('withdrawal_fee_floor_applies', (SELECT public.compute_withdrawal_fee(100000)::text), '5000');
UPDATE public.settings SET value = '500000'::jsonb WHERE key = 'min_withdrawal_kobo';
SELECT t.eq('withdrawal_fee_capped', (SELECT public.compute_withdrawal_fee(20000000)::text), '200000');
SELECT t.raises('withdrawal_below_minimum_refused',
  'SELECT public.compute_withdrawal_fee(400000)', 'invalid_amount');

SELECT t.eq('payout_day_monday_lagos', (SELECT public.is_payout_day('2026-11-16 12:00:00+01'::timestamptz)::text), 'true');
SELECT t.eq('payout_day_saturday_lagos', (SELECT public.is_payout_day('2026-11-21 12:00:00+01'::timestamptz)::text), 'false');
SELECT t.eq('payout_day_friday_2330_utc_is_saturday', (SELECT public.is_payout_day('2026-11-20 23:30:00+00'::timestamptz)::text), 'false');
SELECT t.eq('payout_day_thursday_2330_utc_is_friday', (SELECT public.is_payout_day('2026-11-19 23:30:00+00'::timestamptz)::text), 'true');

SELECT t.raises('blackout_requires_admin_or_finance', format(
  'SELECT public.add_payout_blackout(%L::uuid, %L::date, %L)',
  '11111111-1111-1111-1111-111111111110', '2026-11-17', 'Public holiday'), 'forbidden');
SELECT t.raises('blackout_reason_too_short', format(
  'SELECT public.add_payout_blackout(%L::uuid, %L::date, %L)',
  '11111111-1111-1111-1111-111111111108', '2026-11-17', 'hol'), 'invalid_reason');

SELECT public.add_payout_blackout('11111111-1111-1111-1111-111111111108'::uuid, '2026-11-17'::date, 'Public holiday');
SELECT t.eq('blackout_blocks_payout_day', (SELECT public.is_payout_day('2026-11-17 12:00:00+01'::timestamptz)::text), 'false');
SELECT public.remove_payout_blackout('11111111-1111-1111-1111-111111111108'::uuid, '2026-11-17'::date);
SELECT t.eq('blackout_removed_restores_payout_day', (SELECT public.is_payout_day('2026-11-17 12:00:00+01'::timestamptz)::text), 'true');
SELECT t.raises('blackout_remove_needs_finance', format(
  'SELECT public.remove_payout_blackout(%L::uuid, %L::date)',
  '11111111-1111-1111-1111-111111111111', '2026-11-17'), 'forbidden');

-- ===========================================================================
-- 10. RLS
-- ===========================================================================
-- The buyer sees their own orders and nothing else.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111101';
SET ROLE authenticated;
SELECT t.eq('rls_buyer_sees_only_own_orders',
  (SELECT count(*)::text FROM public.orders
    WHERE buyer_user_id <> '11111111-1111-1111-1111-111111111101'::uuid), '0');
SELECT t.ok('rls_buyer_sees_own_orders',
  (SELECT count(*) > 0 FROM public.orders));
SELECT t.eq('rls_buyer_cannot_see_ledger',
  (SELECT count(*)::text FROM public.ledger_entries), '0');
RESET ROLE;

-- The vendor sees only their own sales, and the view carries no buyer identity.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111103';
SET ROLE authenticated;
SELECT t.eq('rls_vendor_sales_only_own_products',
  (SELECT count(*)::text FROM public.vendor_sales
    WHERE product_id <> '22222222-2222-2222-2222-222222222201'::uuid
      AND product_id <> '22222222-2222-2222-2222-222222222202'::uuid
      AND product_id <> '22222222-2222-2222-2222-222222222204'::uuid
      AND product_id <> '22222222-2222-2222-2222-222222222205'::uuid), '0');
SELECT t.ok('rls_vendor_sees_their_sales',
  (SELECT count(*) > 0 FROM public.vendor_sales));
RESET ROLE;

SELECT t.eq('rls_vendor_view_has_no_buyer_columns',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendor_sales'
      AND column_name IN ('buyer_email', 'buyer_name')), '0');
SELECT t.eq('rls_affiliate_view_has_no_buyer_columns',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_commissions'
      AND column_name IN ('buyer_email', 'buyer_name')), '0');

-- The affiliate sees only their own commissions.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111106';
SET ROLE authenticated;
SELECT t.ok('rls_affiliate_sees_their_commissions',
  (SELECT count(*) > 0 FROM public.affiliate_commissions));
SELECT t.eq('rls_affiliate_cannot_see_other_items',
  (SELECT count(*)::text FROM public.order_items
    WHERE affiliate_id IS NOT NULL
      AND affiliate_id <> '11111111-1111-1111-1111-111111111106'::uuid), '0');
RESET ROLE;

-- Support cannot read the ledger; finance and admin can.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111110';
SET ROLE authenticated;
SELECT t.eq('rls_support_cannot_read_ledger', (SELECT count(*)::text FROM public.ledger_entries), '0');
SELECT t.ok('rls_support_can_read_orders', (SELECT count(*) > 0 FROM public.orders));
RESET ROLE;

SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111109';
SET ROLE authenticated;
SELECT t.ok('rls_finance_can_read_ledger', (SELECT count(*) > 0 FROM public.ledger_entries));
SELECT t.ok('rls_finance_can_read_vat', (SELECT count(*) > 0 FROM public.vat_periods));
RESET ROLE;

SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111108';
SET ROLE authenticated;
SELECT t.ok('rls_admin_can_read_ledger', (SELECT count(*) > 0 FROM public.ledger_entries));
SELECT t.ok('rls_admin_can_read_refund_requests', (SELECT count(*) > 0 FROM public.refund_requests));
RESET ROLE;

-- A signed-in customer cannot write any commerce table or run any function.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111101';
SET ROLE authenticated;
SELECT t.raises('rls_authenticated_cannot_insert_orders',
  'INSERT INTO public.orders (number, buyer_email, subtotal_kobo, total_kobo, paystack_reference, expires_at) VALUES (''X'', ''x@example.com'', 1, 1, ''X'', now())',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_update_orders',
  'UPDATE public.orders SET status = ''paid''',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_delete_orders',
  'DELETE FROM public.orders',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_insert_ledger',
  'INSERT INTO public.ledger_entries (txn_id, account_id, debit_kobo) VALUES (gen_random_uuid(), 1, 1)',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_execute_create_order',
  'SELECT public.create_order(NULL, ''a@b.co'', ''A'', gen_random_uuid(), NULL, NULL, NULL, ''R'')',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_execute_claim_download',
  'SELECT public.claim_download(gen_random_uuid(), NULL, NULL, NULL)',
  'permission denied');
SELECT t.raises('rls_authenticated_cannot_execute_compute_split',
  'SELECT * FROM public.compute_split(1, 1, 1, true)',
  'permission denied');
RESET ROLE;

-- anon sees and does nothing at all.
SET ROLE anon;
SELECT t.raises('rls_anon_cannot_select_orders', 'SELECT count(*) FROM public.orders', 'permission denied');
SELECT t.raises('rls_anon_cannot_select_ledger', 'SELECT count(*) FROM public.ledger_entries', 'permission denied');
SELECT t.raises('rls_anon_cannot_select_vendor_sales', 'SELECT count(*) FROM public.vendor_sales', 'permission denied');
SELECT t.raises('rls_anon_cannot_execute_process_paid_order',
  'SELECT public.process_paid_order(''R'', 1, 1, ''NGN'', 0, ''card'', now())', 'permission denied');
SELECT t.raises('rls_anon_cannot_execute_next_order_number',
  'SELECT public.next_order_number()', 'permission denied');
RESET ROLE;

-- ===========================================================================
-- 11. Ledger integrity that an immediate constraint can catch
-- ===========================================================================
SELECT t.raises('ledger_entry_both_sides_rejected',
  'INSERT INTO public.ledger_entries (txn_id, account_id, debit_kobo, credit_kobo) VALUES (gen_random_uuid(), 1, 100, 100)',
  'ledger_entries_single_side');
SELECT t.raises('ledger_entry_negative_rejected',
  'INSERT INTO public.ledger_entries (txn_id, account_id, debit_kobo) VALUES (gen_random_uuid(), 1, -100)',
  'ledger_entries_debit_kobo_check');
SQL

if run_file "$SUITE" >/dev/null 2>"$SUITE.err"; then
  echo "  (sql suite part 2 ran)"
else
  echo "  !! sql suite part 2 aborted"
  tail -20 "$SUITE.err" | sed 's/^/       /'
  FAILED=$((FAILED + 1))
fi
rm -f "$SUITE" "$SUITE.err"

# ---------------------------------------------------------------------------
# 5. Report the collected assertions
# ---------------------------------------------------------------------------
step "Assertion results"
RESULTS=$(su "$SUPER_USER" -c "psql -q -At -F '|' -d $DB -c \"select name, ok, coalesce(detail,'') from t.results order by id\"")
while IFS='|' read -r name ok detail; do
  [ -z "${name:-}" ] && continue
  if [ "$ok" = "t" ]; then
    pass "$name"
  else
    fail "$name" "$detail"
  fi
done <<< "$RESULTS"

total_assertions=$(printf '%s\n' "$RESULTS" | grep -c '|' || true)
if [ "$total_assertions" -lt 100 ]; then
  fail "assertion count" "only $total_assertions assertions recorded, the suite may have aborted"
fi

# ---------------------------------------------------------------------------
# 6. Ledger integrity: the guards must fire for every role
# ---------------------------------------------------------------------------
step "Ledger append-only guards and the deferred balance check"

expect_fail_file() {
  local label="$1" needle="$2" f="$3" out
  chmod 644 "$f"
  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$f" 2>&1)
  if [ $? -ne 0 ] && printf '%s' "$out" | grep -qi "$needle"; then
    pass "$label"
  else
    fail "$label" "$(printf '%s' "$out" | tail -3)"
  fi
}

F=$(tmpfile); cat > "$F" <<'SQL'
BEGIN;
INSERT INTO public.ledger_transactions (kind, idempotency_key)
VALUES ('test_unbalanced', 'test_unbalanced:1');
INSERT INTO public.ledger_entries (txn_id, account_id, debit_kobo)
SELECT id, 1, 100 FROM public.ledger_transactions WHERE idempotency_key = 'test_unbalanced:1';
COMMIT;
SQL
expect_fail_file "unbalanced transaction fails at commit" "unbalanced_transaction" "$F"
rm -f "$F"

entries_present=$(q "select count(*) from public.ledger_entries")
if [ "${entries_present:-0}" -gt 0 ]; then pass "ledger has rows to guard ($entries_present)"; else fail "ledger has rows to guard" "table is empty"; fi

F=$(tmpfile); echo "UPDATE public.ledger_entries SET debit_kobo = 1;" > "$F"
expect_fail_file "UPDATE ledger_entries fails as postgres" "append_only" "$F"
rm -f "$F"

F=$(tmpfile); echo "DELETE FROM public.ledger_entries;" > "$F"
expect_fail_file "DELETE ledger_entries fails as postgres" "append_only" "$F"
rm -f "$F"

F=$(tmpfile); echo "TRUNCATE public.ledger_entries;" > "$F"
expect_fail_file "TRUNCATE ledger_entries fails as postgres" "append_only" "$F"
rm -f "$F"

F=$(tmpfile); cat > "$F" <<'SQL'
SET ROLE service_role;
UPDATE public.ledger_entries SET debit_kobo = 1;
SQL
expect_fail_file "UPDATE ledger_entries fails as service_role" "permission denied" "$F"
rm -f "$F"

F=$(tmpfile); cat > "$F" <<'SQL'
SET ROLE service_role;
DELETE FROM public.ledger_entries;
SQL
expect_fail_file "DELETE ledger_entries fails as service_role" "permission denied" "$F"
rm -f "$F"

F=$(tmpfile); cat > "$F" <<'SQL'
SET ROLE service_role;
TRUNCATE public.ledger_entries;
SQL
expect_fail_file "TRUNCATE ledger_entries fails as service_role" "permission denied" "$F"
rm -f "$F"

F=$(tmpfile); cat > "$F" <<'SQL'
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111109';
SET ROLE authenticated;
UPDATE public.ledger_entries SET debit_kobo = 1;
SQL
expect_fail_file "UPDATE ledger_entries fails as authenticated" "permission denied" "$F"
rm -f "$F"

F=$(tmpfile); cat > "$F" <<'SQL'
SET ROLE anon;
DELETE FROM public.ledger_entries;
SQL
expect_fail_file "DELETE ledger_entries fails as anon" "permission denied" "$F"
rm -f "$F"

# ---------------------------------------------------------------------------
# 7. Two real sessions, same reference
# ---------------------------------------------------------------------------
step "Concurrency: two sessions processing one payment"

q "SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One', '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-CONC-1')" >/dev/null

A=$(tmpfile); B=$(tmpfile)
cat > "$A" <<'SQL'
BEGIN;
SELECT public.process_paid_order('REF-CONC-1', 9900, 1000000, 'NGN', 25000, 'card', now());
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$B" <<'SQL'
SELECT public.process_paid_order('REF-CONC-1', 9900, 1000000, 'NGN', 25000, 'card', now());
SQL
chmod 644 "$A" "$B"

su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$A" > "$A.out" 2>&1 &
apid=$!
sleep 0.6
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$B" > "$B.out" 2>&1
bstatus=$?
wait "$apid"; astatus=$?

a_processed=$(grep -c '"processed"' "$A.out" || true)
a_already=$(grep -c '"already_paid"' "$A.out" || true)
b_processed=$(grep -c '"processed"' "$B.out" || true)
b_already=$(grep -c '"already_paid"' "$B.out" || true)

if [ $((a_processed + b_processed)) -eq 1 ] && [ $((a_already + b_already)) -eq 1 ]; then
  pass "one session processed, the other saw already_paid"
else
  fail "one session processed, the other saw already_paid" \
       "A(processed=$a_processed already=$a_already status=$astatus) B(processed=$b_processed already=$b_already status=$bstatus)"
fi

txn_count=$(q "select count(*) from public.ledger_transactions where idempotency_key = 'order_paid:' || (select id::text from public.orders where paystack_reference='REF-CONC-1')")
if [ "$txn_count" = "1" ]; then pass "exactly one ledger transaction"; else fail "exactly one ledger transaction" "got $txn_count"; fi

entry_count=$(q "select count(*) from public.ledger_entries where txn_id = (select id from public.ledger_transactions where idempotency_key = 'order_paid:' || (select id::text from public.orders where paystack_reference='REF-CONC-1'))")
if [ "$entry_count" = "4" ]; then pass "exactly four ledger entries (no affiliate, no VAT)"; else fail "exactly four ledger entries (no affiliate, no VAT)" "got $entry_count"; fi

job_count=$(q "select count(*) from public.jobs where dedupe_key = 'order_paid:' || (select id::text from public.orders where paystack_reference='REF-CONC-1')")
if [ "$job_count" = "1" ]; then pass "order_paid job enqueued once under concurrency"; else fail "order_paid job enqueued once under concurrency" "got $job_count"; fi
rm -f "$A" "$B" "$A.out" "$B.out"

# ---------------------------------------------------------------------------
# 8. Two real sessions, one download left
# ---------------------------------------------------------------------------
step "Concurrency: two sessions claiming the last download"

q "SELECT public.create_order('11111111-1111-1111-1111-111111111101'::uuid, 'buyer@example.com', 'Buyer One', '22222222-2222-2222-2222-222222222201'::uuid, NULL, NULL, NULL, 'REF-CONC-2')" >/dev/null
q "SELECT public.process_paid_order('REF-CONC-2', 9901, 1000000, 'NGN', 25000, 'card', now())" >/dev/null

ENT=$(q "select e.id from public.entitlements e join public.order_items i on i.id = e.order_item_id join public.orders o on o.id = i.order_id where o.paystack_reference = 'REF-CONC-2' order by e.id limit 1")
MAXD=$(q "select max_downloads from public.entitlements where id = '$ENT'::uuid")
q "update public.entitlements set downloads_used = $MAXD - 1 where id = '$ENT'::uuid" >/dev/null
before_logs=$(q "select count(*) from public.download_log where entitlement_id = '$ENT'::uuid")

A=$(tmpfile); B=$(tmpfile)
cat > "$A" <<SQL
BEGIN;
SELECT public.claim_download('$ENT'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'ipA');
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$B" <<SQL
SELECT public.claim_download('$ENT'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, NULL, 'ipB');
SQL
chmod 644 "$A" "$B"

su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$A" > "$A.out" 2>&1 &
apid=$!
sleep 0.6
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$B" > "$B.out" 2>&1
bstatus=$?
wait "$apid"; astatus=$?

if grep -q 'storage_key' "$A.out"; then
  pass "first claim won the last download"
else
  fail "first claim won the last download" "$(tail -2 "$A.out")"
fi
if [ "$bstatus" -ne 0 ] && grep -qi 'download_limit' "$B.out"; then
  pass "second claim refused with download_limit"
else
  fail "second claim refused with download_limit" "$(tail -2 "$B.out")"
fi

after_used=$(q "select downloads_used from public.entitlements where id = '$ENT'::uuid")
if [ "$after_used" = "$MAXD" ]; then pass "counter incremented exactly once"; else fail "counter incremented exactly once" "used=$after_used max=$MAXD"; fi

after_logs=$(q "select count(*) from public.download_log where entitlement_id = '$ENT'::uuid")
if [ "$after_logs" = "$((before_logs + 1))" ]; then
  pass "exactly one download_log row written"
else
  fail "exactly one download_log row written" "before=$before_logs after=$after_logs"
fi
rm -f "$A" "$B" "$A.out" "$B.out"

# ---------------------------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------------------------
printf '\n============================================\n'
printf 'PASSED: %s\n' "$PASSED"
printf 'FAILED: %s\n' "$FAILED"
printf '============================================\n'
[ "$FAILED" -eq 0 ] || exit 1
