#!/usr/bin/env bash
# ============================================================================
# Admin finance harness (migration 20261124000100_admin_finance)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies every migration in order, seeds paid, refunded and disputed orders
# (some with VAT on), a withdrawal and ledger postings, and then tests:
#
#   1. the verify file, then the migration applied a second time
#   2. exact figures from every read function, to the kobo
#   3. the role matrix: who may call what, for every function
#   4. the masked address in every list, the full address only in the order
#      detail for admin and support, and the audit row that read writes
#   5. the trial balance on the seed (balanced, payables match) and on a
#      deliberately corrupted copy, rolled back
#   6. a provider dispute outcome changes nothing but the dispute row
#   7. the refund retry rules
#   8. the reconciliation difference
#   9. keyset pagination with no gap and no duplicate, on every list
#  10. VAT across the Lagos month boundary, the export rows and the reminders
#  11. privileges and row level security
#  12. the commented rollback, then re-applying the migration
#  13. every earlier harness still passes, unchanged
#
# Every date is relative to the day this harness runs, because the VAT month,
# the reminder days and the daily series all depend on "now".
#
# Usage:  supabase/tests/admin_finance_test.sh
# Env:    AFFILOVA_TEST_DB        database name (default affilova_admin_finance_test)
#         SUPER_USER             OS user that owns the server (default postgres)
#         SKIP_EARLIER_HARNESSES=1  do not run the other harnesses at the end
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_admin_finance_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261124000100_admin_finance.sql"
VERIFY="$ROOT/supabase/verify/20261124000100_admin_finance_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

# SQL arrives on stdin so a statement may contain any quoting it likes.
q() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB}" 2>&1; }
qx() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d ${2:-$DB}" 2>&1; }
run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${SQL_DB:-$DB}" 2>&1; }

# A seed statement whose error would otherwise vanish: the output is shown and
# counted as a failure.
seed() {
  local out
  out=$(run_sql)
  if [ -n "$out" ] && printf '%s' "$out" | grep -qi 'error'; then
    fail "seed statement" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
    return 1
  fi
  return 0
}

run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}

expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [$3]"; fi; }

# assert_equal <name> <expected> <actual>, for two values the shell already has.
assert_equal() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [${3:-<empty>}]"; fi
}

# assert_value <name> <expected> ; SQL on stdin
assert_value() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if [ "$out" = "$want" ]; then
    pass "$name"
  else
    fail "$name" "expected [$want] got [${out:-<empty>}]"
  fi
}

# assert_error <name> <expected fragment> ; SQL on stdin
assert_error() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if printf '%s' "$out" | grep -q "$want"; then
    pass "$name"
  else
    fail "$name" "expected [$want], got [$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)]"
  fi
}

tmpfile() { mktemp /tmp/affilova_admin_finance.XXXXXX.sql; }

bootstrap() {
  local db="$1" f
  su "$SUPER_USER" -c "psql -q -c \"DROP DATABASE IF EXISTS $db\"" >/dev/null 2>&1
  su "$SUPER_USER" -c "psql -q -c \"CREATE DATABASE $db\"" >/dev/null || return 1
  f=$(tmpfile)
  cat > "$f" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
SQL
  run_file "$f" "$db" >/dev/null
  local status=$?
  rm -f "$f"
  return $status
}

apply_migrations() {
  local db="$1" f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    run_file "$f" "$db" >/dev/null 2>&1 || { echo "migration failed: $(basename "$f")"; return 1; }
  done
  return 0
}

# ---------------------------------------------------------------------------
# 0. A fresh database with every migration applied
# ---------------------------------------------------------------------------
step "Building $DB from an empty database"
bootstrap "$DB" >/dev/null || { echo "bootstrap failed"; exit 1; }
apply_migrations "$DB" || exit 1

migration_count=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
count=$(q "select count(*) from public.app_migrations")
if [ "$count" = "$migration_count" ]; then
  pass "$migration_count migrations applied"
else
  fail "$migration_count migrations applied" "got $count"
fi

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "the verify file passes ($total checks)"
else
  fail "the verify file passes" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "The migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run succeeds"; else fail "second run succeeds"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261124000100'")
expect "one app_migrations row" "1" "$again"

# ---------------------------------------------------------------------------
# 1. The timeline
#
# Every date below is relative to the Lagos day this harness runs on. TODAY is
# that day; d N is N days before it. A paid order is stamped at Lagos noon of its
# day, so a day offset means the same Lagos day whatever hour it is.
# ---------------------------------------------------------------------------
TODAY=$(q "select (now() at time zone 'Africa/Lagos')::date")
d() { date -u -d "$TODAY - $1 days" +%F; }
dplus() { date -u -d "$TODAY + $1 days" +%F; }
MONTH_FIRST=$(date -u -d "$TODAY" +%Y-%m-01)
VAT_MONTH=$(date -u -d "$MONTH_FIRST -2 months" +%Y-%m-01)
# A 64 character hex hash, the same shape the app writes into email_log.
HASH1=$(printf 'a%.0s' $(seq 1 64))
NEXT_MONTH=$(date -u -d "$VAT_MONTH +1 month" +%Y-%m-01)
LAST_OF_VAT=$(date -u -d "$NEXT_MONTH -1 day" +%F)
VAT_DUE=$(date -u -d "$NEXT_MONTH +20 days" +%F)

# Lagos noon of a day, as a timestamptz literal the seed can paste.
noon() { printf "%s 12:00:00" "$1"; }

D10=$(d 10); D5=$(d 5); D3=$(d 3); D2=$(d 2); D1=$(d 1); D0=$(d 0)
FROM_TS="$(d 30) 00:00:00+01"
TO_TS="$(dplus 1) 00:00:00+01"

# ---------------------------------------------------------------------------
# 2. Seed
# ---------------------------------------------------------------------------
step "Seed"

V1='11111111-1111-4111-8111-111111111101'
V2='11111111-1111-4111-8111-111111111102'
A1='22222222-2222-4222-8222-222222222201'
BUYER='33333333-3333-4333-8333-333333333301'
ADMIN='44444444-4444-4444-8444-444444444401'
FINANCE='44444444-4444-4444-8444-444444444402'
SUPPORT='44444444-4444-4444-8444-444444444403'
MODERATOR='44444444-4444-4444-8444-444444444404'
NO_ROLE='44444444-4444-4444-8444-444444444405'
P1='55555555-5555-4555-8555-555555555501'
P2='55555555-5555-4555-8555-555555555502'
P3='55555555-5555-4555-8555-555555555503'
F1='66666666-6666-4666-8666-666666666601'

seed <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('$V1','vendor1@example.com'),
  ('$V2','vendor2@example.com'),
  ('$A1','aff1@example.com'),
  ('$BUYER','buyer@example.com'),
  ('$ADMIN','admin@example.com'),
  ('$FINANCE','finance@example.com'),
  ('$SUPPORT','support@example.com'),
  ('$MODERATOR','moderator@example.com'),
  ('$NO_ROLE','norole@example.com');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('$V1','vendor'),
  ('$V2','vendor'),
  ('$A1','affiliate'),
  ('$BUYER','customer'),
  ('$ADMIN','admin'),
  ('$FINANCE','finance'),
  ('$SUPPORT','support'),
  ('$MODERATOR','moderator')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email) VALUES
  ('$V1','Vendor One','vendor-one','one@vendor.test'),
  ('$V2','Vendor Two','vendor-two','two@vendor.test');

INSERT INTO public.affiliate_profiles (user_id, username) VALUES
  ('$A1','affiliate_one');

INSERT INTO public.products
  (id, vendor_id, category_id, title, slug, short_description, description,
   price_kobo, commission_bps, status, affiliate_approval, published_at, submitted_at)
VALUES
  ('$P1', '$V1', 1, 'Finance Product One', 'finance-product-one', 'A short description here',
   'Long description', 1000000, 2000, 'live', 'open', now() - interval '20 days', NULL),
  ('$P2', '$V2', 1, 'Finance Product Two', 'finance-product-two', 'A short description here',
   'Long description', 2000000, 1000, 'live', 'open', now() - interval '20 days', NULL),
  ('$P3', '$V1', 1, 'Finance Product Three', 'finance-product-three', 'A short description here',
   'Long description', 500000, 2000, 'submitted', 'open', NULL, now() - interval '2 days');

INSERT INTO public.product_files
  (id, product_id, storage_key, original_name, content_type, size_bytes, status, scan_status, uploaded_at)
VALUES
  ('$F1', '$P1', 'products/finance/one.pdf', 'one.pdf', 'application/pdf', 1024, 'uploaded', 'infected', now());

INSERT INTO public.jobs (type, payload, status, attempts) VALUES
  ('order_paid', '{}'::jsonb, 'dead', 8);
SQL
pass "users, products and a dead job seeded"

# One withdrawal waiting for approval. It posts nothing to the ledger.
seed <<SQL
INSERT INTO public.payout_accounts
  (id, user_id, bank_code, bank_name, account_last4, account_name, recipient_code)
VALUES
  ('77777777-7777-4777-8777-777777777701', '$A1', '058', 'GTBank', '4321',
   'Affiliate One', 'RCP_finance_harness');

INSERT INTO public.withdrawals
  (id, user_id, payout_account_id, kind, status, gross_kobo, fee_kobo, net_kobo, reference)
VALUES
  ('88888888-8888-4888-8888-888888888801', '$A1',
   '77777777-7777-4777-8777-777777777701', 'manual', 'requested',
   1000000, 2500, 997500, 'wd_financeharness000001');
SQL
pass "a withdrawal is waiting for approval"

# VAT is switched on only while the VAT-month orders are created, so the recent
# orders carry no tax and the VAT month has something to report.
q "UPDATE public.settings SET value = 'true'::jsonb WHERE key = 'vat_enabled';" >/dev/null

order_id() { q "select id from public.orders where paystack_reference = '$1'"; }

# The four orders paid in the VAT month. O10 is stamped at 23:30 UTC on the last
# day of the month, which is 00:30 the next morning in Lagos.
seed <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1','$A1',NULL,NULL,'vat-a1-1');
SELECT public.process_paid_order('vat-a1-1', 2001, 1000000, 'NGN', 15000, 'card',
  ('$VAT_MONTH 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P2',NULL,NULL,NULL,'vat-a2-1');
SELECT public.process_paid_order('vat-a2-1', 2002, 2000000, 'NGN', 25000, 'card',
  ('$VAT_MONTH 13:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1',NULL,NULL,NULL,'vat-a3-1');
SELECT public.process_paid_order('vat-a3-1', 2003, 1000000, 'NGN', 15000, 'card',
  ('$VAT_MONTH 14:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1',NULL,NULL,NULL,'vat-boundary-1');
SELECT public.process_paid_order('vat-boundary-1', 2004, 1000000, 'NGN', 15000, 'card',
  ('$LAST_OF_VAT 23:30:00Z'::timestamptz));
SQL
pass "four orders paid in and around the VAT month"

q "UPDATE public.settings SET value = 'false'::jsonb WHERE key = 'vat_enabled';" >/dev/null

# The six orders in the overview window.
seed <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1','$A1',NULL,NULL,'fin-1');
SELECT public.process_paid_order('fin-1', 1001, 1000000, 'NGN', 15000, 'card',
  ('$D10 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P2',NULL,NULL,NULL,'fin-2');
SELECT public.process_paid_order('fin-2', 1002, 2000000, 'NGN', 25000, 'card',
  ('$D5 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1','$A1',NULL,NULL,'fin-3');
SELECT public.process_paid_order('fin-3', 1003, 1000000, 'NGN', 15000, 'card',
  ('$D3 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1',NULL,NULL,NULL,'fin-4');
SELECT public.process_paid_order('fin-4', 1004, 1000000, 'NGN', 15000, 'card',
  ('$D2 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1',NULL,NULL,NULL,'fin-5');
SELECT public.process_paid_order('fin-5', 1005, 1000000, 'NGN', 15000, 'card',
  ('$D1 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P1',NULL,NULL,NULL,'fin-6');
SELECT public.process_paid_order('fin-6', 1006, 1000000, 'NGN', 15000, 'card',
  ('$D0 12:00:00'::timestamp AT TIME ZONE 'Africa/Lagos'));
SQL
pass "six orders paid in the overview window"

ONUM6=$(q "select number from public.orders where paystack_reference = 'fin-6'")
O1=$(order_id 'fin-1')
O2=$(order_id 'fin-2')
O3=$(order_id 'fin-3')
O4=$(order_id 'fin-4')
O5=$(order_id 'fin-5')
O6=$(order_id 'fin-6')
OVAT1=$(order_id 'vat-a1-1')
OVAT2=$(order_id 'vat-a2-1')
OVAT3=$(order_id 'vat-a3-1')
OVATB=$(order_id 'vat-boundary-1')

# O3 is refunded through the real path: an approved request, then the posting.
seed <<SQL
INSERT INTO public.refund_requests (id, order_id, requested_by, reason, status, decided_by, decided_at)
VALUES ('99999999-9999-4999-8999-999999999903', '$O3', '$BUYER',
        'The file would not open for me at all.', 'approved', '$ADMIN', now());
SELECT public.process_refund('99999999-9999-4999-8999-999999999903', 'PSREF-refund-3', 1000000);
SQL

# O4 is in an open dispute.
seed <<SQL
SELECT public.open_dispute('fin-4', 'Paystack dispute 4242');
SQL

# O5 has a request waiting for a decision; O6 has one whose submission failed.
seed <<SQL
INSERT INTO public.refund_requests (id, order_id, requested_by, reason, status)
VALUES
  ('99999999-9999-4999-8999-999999999905', '$O5', '$BUYER',
   'I bought this by mistake and do not need it.', 'requested'),
  ('99999999-9999-4999-8999-999999999906', '$O6', '$BUYER',
   'The download link never worked for me.', 'failed');
SQL

# A VAT adjustment on the VAT month, so the net payable is not just output tax.
q "INSERT INTO public.vat_periods (period, status) VALUES ('$VAT_MONTH', 'open');" >/dev/null
q "INSERT INTO public.vat_adjustments (period, amount_kobo, reason) VALUES ('$VAT_MONTH', 1000, 'Rounding correction');" >/dev/null

pass "a refund, a dispute, two open refund requests and a VAT adjustment seeded"

# ---------------------------------------------------------------------------
# 3. Overview
#
# The arithmetic, written out:
#   gmv       6 orders in the window: 1,000,000 + 2,000,000 + 1,000,000
#             + 1,000,000 + 1,000,000 + 1,000,000 = 7,000,000
#   revenue   every order posts when the seed pays it, so all ten postings are in
#             the window: platform fees 100,000 x 7 + 200,000 x 2 + 100,000
#             = 1,200,000, less the 100,000 the refund reversed = 1,100,000
#   fees      processor fee debits 15,000 x 8 + 25,000 x 2 = 170,000
#   margin    1,100,000 - 170,000 = 930,000
#   vendor    credits 700,000 (with an affiliate) or 900,000 (without) per
#             million, less the VAT carved out: 10,162,500 in all, less the
#             700,000 refund = 9,462,500
#   affiliate credits 200,000 x 3 = 600,000, less the 200,000 refund = 400,000
# ---------------------------------------------------------------------------
step "Overview"

assert_value "gmv, orders, refunds" "7000000|6|1|1000000" <<SQL
SELECT (o ->> 'gmv_kobo') || '|' || (o ->> 'orders') || '|' ||
       (o ->> 'refunds_count') || '|' || (o ->> 'refunds_kobo')
FROM (SELECT public.admin_overview('$ADMIN', '$FROM_TS', '$TO_TS') AS o) x;
SQL

assert_value "platform revenue, processor fees and net margin" "1100000|170000|930000" <<SQL
SELECT (o ->> 'platform_revenue_kobo') || '|' || (o ->> 'processor_fees_kobo') || '|' ||
       (o ->> 'net_margin_kobo')
FROM (SELECT public.admin_overview('$ADMIN', '$FROM_TS', '$TO_TS') AS o) x;
SQL

assert_value "the two payable balances are current, not in range" "9462500|400000" <<SQL
SELECT (o ->> 'vendor_payables_kobo') || '|' || (o ->> 'affiliate_payables_kobo')
FROM (SELECT public.admin_overview('$FINANCE', '$FROM_TS', '$TO_TS') AS o) x;
SQL

assert_value "the needs attention counters" "1|0|1|1|1|1|1|1" <<SQL
SELECT (o ->> 'open_disputes') || '|' || (o ->> 'disputes_needing_decision') || '|' ||
       (o ->> 'refunds_awaiting_decision') || '|' || (o ->> 'failed_refund_submissions') || '|' ||
       (o ->> 'withdrawals_awaiting_approval') || '|' || (o ->> 'products_awaiting_review') || '|' ||
       (o ->> 'files_needing_scan_review') || '|' || (o ->> 'dead_jobs')
FROM (SELECT public.admin_overview('$ADMIN', '$FROM_TS', '$TO_TS') AS o) x;
SQL

assert_error "a backwards range is refused" "invalid_range" <<SQL
SELECT public.admin_overview('$ADMIN', '$TO_TS', '$FROM_TS');
SQL

assert_error "a range over 366 days is refused" "invalid_range" <<SQL
SELECT public.admin_overview('$ADMIN', '2020-01-01T00:00:00Z', '$TO_TS');
SQL

# ---------------------------------------------------------------------------
# 4. Daily series
# ---------------------------------------------------------------------------
step "Daily series"

assert_value "four Lagos days, zero days included" "4" <<SQL
SELECT jsonb_array_length(public.admin_daily_series('$ADMIN', '$D3', '$D0'));
SQL

assert_value "orders and gmv per day" "${D3}|1|1000000|${D2}|1|1000000|${D1}|1|1000000|${D0}|1|1000000" <<SQL
SELECT string_agg((x ->> 'day') || '|' || (x ->> 'orders') || '|' || (x ->> 'gmv_kobo'), '|' ORDER BY x ->> 'day')
FROM jsonb_array_elements(public.admin_daily_series('$ADMIN', '$D3', '$D0')) x;
SQL

assert_value "the refund lands on the day it was posted" "0|0|0|1000000" <<SQL
SELECT string_agg(x ->> 'refunds_kobo', '|' ORDER BY x ->> 'day')
FROM jsonb_array_elements(public.admin_daily_series('$ADMIN', '$D3', '$D0')) x;
SQL

assert_value "revenue is recognised when it is posted" "0|0|0|1100000" <<SQL
SELECT string_agg(x ->> 'platform_revenue_kobo', '|' ORDER BY x ->> 'day')
FROM jsonb_array_elements(public.admin_daily_series('$ADMIN', '$D3', '$D0')) x;
SQL

assert_value "a quiet day is a zero, not a gap" "1" <<SQL
SELECT jsonb_array_length(public.admin_daily_series('$ADMIN', '$(d 400)', '$(d 400)'));
SQL

assert_error "the series refuses a backwards range" "invalid_range" <<SQL
SELECT public.admin_daily_series('$ADMIN', '$D0', '$D3');
SQL

# ---------------------------------------------------------------------------
# 5. Orders list and detail
# ---------------------------------------------------------------------------
step "Orders list"

assert_value "every order, newest first" "10" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "the newest order carries its product, vendor and masked address" "Finance Product One|Vendor One|b***@example.com" <<SQL
SELECT (x ->> 'product_title') || '|' || (x ->> 'vendor_name') || '|' || (x ->> 'masked_email')
FROM jsonb_array_elements(public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 1, NULL) -> 'items') x;
SQL

assert_value "search by order number prefix" "1" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', '$ONUM6', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "search by exact Paystack reference" "1" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', 'fin-2', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "search by exact buyer address, for admin" "10" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', 'buyer@example.com', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "the same search for support" "10" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$SUPPORT', 'buyer@example.com', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "the same search for finance finds nothing" "0" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$FINANCE', 'buyer@example.com', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "a partial address finds nothing, it is exact or nothing" "0" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', 'buyer@', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "filter by status" "1" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', NULL, 'refunded', NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "filter by date" "1" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', NULL, NULL, '$D2', '$D2', 50, NULL) -> 'items');
SQL

assert_value "no list row ever carries the whole address" "0" <<SQL
SELECT count(*)
FROM jsonb_array_elements(public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 50, NULL) -> 'items') x
WHERE x ? 'buyer_email' OR (x ->> 'masked_email') = 'buyer@example.com';
SQL

assert_value "a limit above the cap is accepted and capped" "10" <<SQL
SELECT jsonb_array_length(public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 500, NULL) -> 'items');
SQL

assert_error "an unknown status is refused" "invalid_status" <<SQL
SELECT public.admin_orders_list('$ADMIN', NULL, 'maybe', NULL, NULL, 50, NULL);
SQL

step "Orders pagination"

assert_value "walking two at a time visits every order once" "10|10" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 2, NULL) AS page
  UNION ALL
  SELECT public.admin_orders_list('$ADMIN', NULL, NULL, NULL, NULL, 2, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT id) FROM rows);
SQL

step "Order detail"

assert_value "admin sees the whole address" "buyer@example.com|true" <<SQL
SELECT (d -> 'buyer' ->> 'email') || '|' || (d -> 'buyer' ->> 'full_email_visible')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x;
SQL

assert_value "support sees the whole address" "buyer@example.com|true" <<SQL
SELECT (d -> 'buyer' ->> 'email') || '|' || (d -> 'buyer' ->> 'full_email_visible')
FROM (SELECT public.admin_order_detail('$SUPPORT', '$O1') AS d) x;
SQL

assert_value "finance sees the masked address only" "|false|b***@example.com" <<SQL
SELECT coalesce(d -> 'buyer' ->> 'email', '') || '|' || (d -> 'buyer' ->> 'full_email_visible')
       || '|' || (d -> 'buyer' ->> 'masked_email')
FROM (SELECT public.admin_order_detail('$FINANCE', '$O1') AS d) x;
SQL

assert_value "the read by admin and support wrote an audit row, with the actor and the order only" "2" <<SQL
SELECT count(*) FROM public.audit_log
WHERE action = 'order.viewed_by_staff'
  AND entity_type = 'order'
  AND entity_id = '$O1'
  AND actor_id IN ('$ADMIN', '$SUPPORT');
SQL

assert_value "the finance read wrote no audit row" "0" <<SQL
SELECT count(*) FROM public.audit_log
WHERE action = 'order.viewed_by_staff' AND actor_id = '$FINANCE';
SQL

assert_value "the split is the order's own numbers" "1000000|100000|200000|700000|0" <<SQL
SELECT (i ->> 'unit_price_kobo') || '|' || (i ->> 'platform_fee_kobo') || '|' ||
       (i ->> 'affiliate_commission_kobo') || '|' || (i ->> 'vendor_net_kobo') || '|' ||
       (i ->> 'tax_deducted_kobo')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x,
     jsonb_array_elements(x.d -> 'items') i;
SQL

assert_value "the vendor and the affiliate are named" "Vendor One|affiliate_one" <<SQL
SELECT (d -> 'vendor' ->> 'business_name') || '|' || (d -> 'affiliate' ->> 'username')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x;
SQL

assert_value "an order without an affiliate says so" "t" <<SQL
SELECT (d -> 'affiliate') = 'null'::jsonb FROM (SELECT public.admin_order_detail('$ADMIN', '$O2') AS d) x;
SQL

assert_value "the entitlements summary" "1|0|5|0" <<SQL
SELECT (d -> 'entitlements' ->> 'files') || '|' || (d -> 'entitlements' ->> 'downloads_used') || '|' ||
       (d -> 'entitlements' ->> 'downloads_allowed') || '|' || (d -> 'entitlements' ->> 'revoked')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x;
SQL

assert_value "the refunded order shows its processed request" "processed|true" <<SQL
SELECT (r ->> 'status') || '|' || (r ->> 'has_provider_reference')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O3') AS d) x,
     jsonb_array_elements(x.d -> 'refund_requests') r;
SQL

assert_value "the disputed order shows its open dispute" "open|false" <<SQL
SELECT (r ->> 'outcome') || '|' || (r ->> 'needs_decision')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O4') AS d) x,
     jsonb_array_elements(x.d -> 'disputes') r;
SQL

assert_value "the ledger is shown to admin and finance, and not to support" "1|1|0" <<SQL
SELECT (public.admin_order_detail('$ADMIN', '$O1') -> 'ledger' IS DISTINCT FROM 'null'::jsonb)::int || '|' ||
       (public.admin_order_detail('$FINANCE', '$O1') -> 'ledger' IS DISTINCT FROM 'null'::jsonb)::int || '|' ||
       (public.admin_order_detail('$SUPPORT', '$O1') -> 'ledger' IS DISTINCT FROM 'null'::jsonb)::int;
SQL

assert_value "the ledger posting for the order carries five entries" "5" <<SQL
SELECT jsonb_array_length(t -> 'entries')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x,
     jsonb_array_elements(x.d -> 'ledger' -> 'transactions') t
LIMIT 1;
SQL

assert_value "a party entry is labelled with the vendor's business name" "vendor_payable|Vendor One|700000" <<SQL
SELECT (e ->> 'account_code') || '|' || (e ->> 'party') || '|' || (e ->> 'credit_kobo')
FROM (SELECT public.admin_order_detail('$ADMIN', '$O1') AS d) x,
     jsonb_array_elements(x.d -> 'ledger' -> 'transactions') t,
     jsonb_array_elements(t -> 'entries') e
WHERE e ->> 'account_code' = 'vendor_payable';
SQL

assert_error "an order that does not exist is not found" "not_found" <<SQL
SELECT public.admin_order_detail('$ADMIN', gen_random_uuid());
SQL

# ---------------------------------------------------------------------------
# 6. Refunds list and retry
# ---------------------------------------------------------------------------
step "Refunds"

assert_value "every request, newest first" "3" <<SQL
SELECT jsonb_array_length(public.admin_refunds_list('$ADMIN', NULL, 50, NULL) -> 'items');
SQL

assert_value "filter by status" "1|failed" <<SQL
SELECT jsonb_array_length(public.admin_refunds_list('$ADMIN', 'failed', 50, NULL) -> 'items')
       || '|' || (public.admin_refunds_list('$ADMIN', 'failed', 50, NULL) -> 'items' -> 0 ->> 'status');
SQL

assert_value "the row carries the order number, the product and the amount" "1" <<SQL
SELECT (x ->> 'product_title' = 'Finance Product One' AND (x ->> 'amount_kobo')::bigint = 1000000
        AND (x ->> 'order_number') IS NOT NULL)::int
FROM jsonb_array_elements(public.admin_refunds_list('$ADMIN', 'failed', 50, NULL) -> 'items') x;
SQL

assert_value "pagination walks every request once" "3|3" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.admin_refunds_list('$ADMIN', NULL, 2, NULL) AS page
  UNION ALL
  SELECT public.admin_refunds_list('$ADMIN', NULL, 2, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT id) FROM rows);
SQL

assert_error "a support member cannot retry a refund" "forbidden" <<SQL
SELECT public.retry_refund_submission('$SUPPORT', '99999999-9999-4999-8999-999999999906');
SQL

assert_error "a request that has not failed cannot be retried" "bad_state" <<SQL
SELECT public.retry_refund_submission('$ADMIN', '99999999-9999-4999-8999-999999999905');
SQL

assert_value "finance retries a failed refund, and it asks for an enqueue" "true|approved" <<SQL
SELECT (r ->> 'enqueue') || '|' || (r ->> 'status')
FROM (SELECT public.retry_refund_submission('$FINANCE', '99999999-9999-4999-8999-999999999906') AS r) x;
SQL

assert_value "the request is approved again, ready for the job" "approved" <<SQL
SELECT status FROM public.refund_requests WHERE id = '99999999-9999-4999-8999-999999999906';
SQL

assert_value "the retry wrote one audit row" "1" <<SQL
SELECT count(*) FROM public.audit_log
WHERE action = 'refund.retry_requested' AND actor_id = '$FINANCE'
  AND entity_id = '99999999-9999-4999-8999-999999999906';
SQL

assert_error "a second retry is refused, the request is no longer failed" "bad_state" <<SQL
SELECT public.retry_refund_submission('$ADMIN', '99999999-9999-4999-8999-999999999906');
SQL

# Put it back to failed, so the overview counter is the seeded one again.
q "UPDATE public.refund_requests SET status = 'failed' WHERE id = '99999999-9999-4999-8999-999999999906';" >/dev/null

# ---------------------------------------------------------------------------
# 7. Disputes: recording the provider's outcome moves nothing
# ---------------------------------------------------------------------------
step "Disputes"

assert_value "one open dispute, newest first" "1|open|false" <<SQL
SELECT jsonb_array_length(public.admin_disputes_list('$ADMIN', NULL, 50, NULL) -> 'items') || '|' ||
       (public.admin_disputes_list('$ADMIN', NULL, 50, NULL) -> 'items' -> 0 ->> 'outcome') || '|' ||
       (public.admin_disputes_list('$ADMIN', NULL, 50, NULL) -> 'items' -> 0 ->> 'needs_decision');
SQL

LEDGER_BEFORE=$(q "select count(*) from public.ledger_entries")
STATUS_BEFORE=$(q "select status from public.orders where id = '$O4'")
REVOKED_BEFORE=$(q "select count(*) from public.entitlements where order_item_id in (select id from public.order_items where order_id = '$O4') and revoked_at is not null")

assert_value "recording the outcome stores the provider's word" "recorded|declined|true" <<SQL
SELECT (r ->> 'status') || '|' || (r ->> 'provider_resolution') || '|' || (r ->> 'needs_decision')
FROM (SELECT public.record_dispute_provider_outcome('fin-4', 'declined', 'Paystack dispute 4242') AS r) x;
SQL

assert_value "the dispute is now waiting for a person" "true|declined" <<SQL
SELECT (d ->> 'needs_decision') || '|' || (d ->> 'provider_resolution')
FROM (SELECT public.admin_disputes_list('$ADMIN', 'needs_decision', 50, NULL) -> 'items' -> 0 AS d) x;
SQL

assert_equal "the order did not move" "$STATUS_BEFORE" "$(q "select status from public.orders where id = '$O4'")"
assert_equal "the entitlements did not move" "$REVOKED_BEFORE" "$(q "select count(*) from public.entitlements where order_item_id in (select id from public.order_items where order_id = '$O4') and revoked_at is not null")"
assert_equal "the ledger did not move" "$LEDGER_BEFORE" "$(q "select count(*) from public.ledger_entries")"

assert_value "the outcome wrote an audit row with the actor empty" "1|true" <<SQL
SELECT count(*) || '|' || (count(*) FILTER (WHERE actor_id IS NULL) = count(*))::text
FROM public.audit_log WHERE action = 'dispute.provider_outcome' AND entity_id = '$O4';
SQL

assert_error "an unknown reference is not found" "not_found" <<SQL
SELECT public.record_dispute_provider_outcome('not-a-reference', 'declined', NULL);
SQL

assert_error "an order with no open dispute has nothing to record" "no_open_dispute" <<SQL
SELECT public.record_dispute_provider_outcome('fin-1', 'declined', NULL);
SQL

assert_error "an empty resolution is refused" "invalid_resolution" <<SQL
SELECT public.record_dispute_provider_outcome('fin-4', '  ', NULL);
SQL

# The decision itself, through the existing function, as a person would take it.
assert_value "the decision is still resolve_dispute's to make" "won|paid" <<SQL
SELECT (r ->> 'status') || '|' || (r ->> 'order_status')
FROM (SELECT public.resolve_dispute('$O4', 'won') AS r) x;
SQL

assert_value "a won dispute gives the downloads back and closes the row" "paid|won|0" <<SQL
SELECT o.status::text || '|' || d.outcome || '|' ||
       (SELECT count(*) FROM public.entitlements e
         WHERE e.order_item_id IN (SELECT id FROM public.order_items WHERE order_id = '$O4')
           AND e.revoked_at IS NOT NULL)
FROM public.orders o, public.order_disputes d
WHERE o.id = '$O4' AND d.order_id = '$O4';
SQL

assert_equal "a won dispute posts nothing to the ledger" "$LEDGER_BEFORE" "$(q "select count(*) from public.ledger_entries")"

# ---------------------------------------------------------------------------
# 8. Ledger, trial balance and reconciliation
# ---------------------------------------------------------------------------
step "Ledger"

assert_value "the chart of accounts is returned with the page" "8" <<SQL
SELECT jsonb_array_length(public.admin_ledger_list('$ADMIN', NULL, NULL, NULL, 50, NULL) -> 'accounts');
SQL

assert_value "every transaction, newest first" "11" <<SQL
SELECT jsonb_array_length(public.admin_ledger_list('$ADMIN', NULL, NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "filtering by account shows the transactions that touch it" "4" <<SQL
SELECT jsonb_array_length(public.admin_ledger_list('$ADMIN', 'vat_payable', NULL, NULL, 50, NULL) -> 'items');
SQL

assert_value "a filtered page still shows every entry of its transactions" "5" <<SQL
SELECT jsonb_array_length(x -> 'entries')
FROM jsonb_array_elements(public.admin_ledger_list('$ADMIN', 'vat_payable', NULL, NULL, 1, NULL) -> 'items') x;
SQL

assert_value "pagination walks every transaction once" "11|11" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.admin_ledger_list('$ADMIN', NULL, NULL, NULL, 5, NULL) AS page
  UNION ALL
  SELECT public.admin_ledger_list('$ADMIN', NULL, NULL, NULL, 5, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT id) FROM rows);
SQL

assert_error "an unknown account code is refused" "invalid_account" <<SQL
SELECT public.admin_ledger_list('$ADMIN', 'petty_cash', NULL, NULL, 50, NULL);
SQL

step "Trial balance"

assert_value "the book balances and the payables match" "true|true|0" <<SQL
SELECT (t ->> 'balanced') || '|' || (t ->> 'payables_match') || '|' ||
       (t -> 'totals' ->> 'difference_kobo')
FROM (SELECT public.admin_trial_balance('$ADMIN', NULL) AS t) x;
SQL

assert_value "the grand totals are the sum of every posting" "13000000|13000000" <<SQL
SELECT (t -> 'totals' ->> 'debit_kobo') || '|' || (t -> 'totals' ->> 'credit_kobo')
FROM (SELECT public.admin_trial_balance('$ADMIN', NULL) AS t) x;
SQL

assert_value "the two payable accounts agree with the parties" "9862500|9862500" <<SQL
SELECT (t -> 'payables' ->> 'party_sum_kobo') || '|' || (t -> 'payables' ->> 'accounts_kobo')
FROM (SELECT public.admin_trial_balance('$ADMIN', NULL) AS t) x;
SQL

assert_value "the paystack balance is the ledger's own" "10830000" <<SQL
SELECT (a ->> 'balance_kobo')
FROM (SELECT public.admin_trial_balance('$ADMIN', NULL) AS t) x,
     jsonb_array_elements(x.t -> 'accounts') a
WHERE a ->> 'code' = 'paystack_balance';
SQL

# A deliberately corrupted copy: one extra debit with no matching credit. It is
# inserted inside a transaction and rolled back, so the real book is untouched.
assert_value "a corrupted copy shows the book unbalanced" "false|true" <<SQL
BEGIN;
INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
SELECT id, 1, NULL, 50000, 0 FROM public.ledger_transactions ORDER BY created_at LIMIT 1;
SELECT (t ->> 'balanced') || '|' || (t -> 'totals' ->> 'difference_kobo' = '50000')
FROM (SELECT public.admin_trial_balance('$ADMIN', now() + interval '1 minute') AS t) x;
ROLLBACK;
SQL

assert_value "the corrupted copy also breaks the payables check on its own" "false|false" <<SQL
BEGIN;
INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
SELECT id, 3, NULL, 10000, 0 FROM public.ledger_transactions ORDER BY created_at LIMIT 1;
SELECT (t ->> 'balanced') || '|' || (t ->> 'payables_match')
FROM (SELECT public.admin_trial_balance('$ADMIN', now() + interval '1 minute') AS t) x;
ROLLBACK;
SQL

assert_value "after the rollback the book balances again" "true|true" <<SQL
SELECT (t ->> 'balanced') || '|' || (t ->> 'payables_match')
FROM (SELECT public.admin_trial_balance('$ADMIN', NULL) AS t) x;
SQL

step "Reconciliation"

assert_value "the difference is ledger minus provider" "50000|10780000|10830000" <<SQL
SELECT (r ->> 'diff_kobo') || '|' || (r ->> 'provider_balance_kobo') || '|' ||
       (r ->> 'ledger_paystack_balance_kobo')
FROM (SELECT public.record_reconciliation_run(10830000 - 50000) AS r) x;
SQL

assert_value "a matched run has a zero difference" "0" <<SQL
SELECT (r ->> 'diff_kobo') FROM (SELECT public.record_reconciliation_run(10830000) AS r) x;
SQL

assert_value "the list returns the newest run first" "2|0" <<SQL
SELECT jsonb_array_length(public.admin_reconciliation_list('$ADMIN', 30) -> 'items') || '|' ||
       (public.admin_reconciliation_list('$ADMIN', 30) -> 'items' -> 0 ->> 'diff_kobo');
SQL

assert_value "the stored run keeps its details" "paystack_balance" <<SQL
SELECT details ->> 'account' FROM public.reconciliation_runs ORDER BY id DESC LIMIT 1;
SQL

assert_error "a missing provider balance is refused" "invalid_amount" <<SQL
SELECT public.record_reconciliation_run(NULL);
SQL

# ---------------------------------------------------------------------------
# 9. VAT
# ---------------------------------------------------------------------------
step "VAT periods"

assert_value "twelve months, in order" "12|${VAT_MONTH}" <<SQL
SELECT jsonb_array_length(public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) -> 'periods') || '|' ||
       (public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) -> 'periods' -> (SELECT (extract(month from '$VAT_MONTH'::date)::int - 1)) ->> 'period');
SQL

assert_value "the month's output, adjustments and net" "30000|0|1000|31000" <<SQL
SELECT (p ->> 'output_vat_kobo') || '|' || (p ->> 'credit_notes_kobo') || '|' ||
       (p ->> 'adjustments_kobo') || '|' || (p ->> 'net_payable_kobo')
FROM (SELECT public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) AS x) y,
     jsonb_array_elements(y.x -> 'periods') p
WHERE p ->> 'period' = '$VAT_MONTH';
SQL

assert_value "the due date is the 21st of the next month" "$VAT_DUE" <<SQL
SELECT (p ->> 'due_date')
FROM (SELECT public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) AS x) y,
     jsonb_array_elements(y.x -> 'periods') p
WHERE p ->> 'period' = '$VAT_MONTH';
SQL

assert_value "a month that has passed its due date is overdue by a positive number" "t" <<SQL
SELECT ((p ->> 'days_until_due')::int < 0)
FROM (SELECT public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) AS x) y,
     jsonb_array_elements(y.x -> 'periods') p
WHERE p ->> 'period' = '$VAT_MONTH';
SQL

assert_error "an impossible year is refused" "invalid_year" <<SQL
SELECT public.vat_periods_list('$ADMIN', 1990);
SQL

step "VAT period detail"

assert_value "the month has three tax lines" "3" <<SQL
SELECT jsonb_array_length(public.vat_period_detail('$ADMIN', '$VAT_MONTH', 50, NULL) -> 'lines');
SQL

assert_value "the boundary order is not in this month" "0" <<SQL
SELECT count(*)
FROM jsonb_array_elements(public.vat_period_detail('$ADMIN', '$VAT_MONTH', 50, NULL) -> 'lines') l
WHERE (l ->> 'order_number') = (SELECT number FROM public.orders WHERE id = '$OVATB');
SQL

assert_value "the boundary order is in the next month, on the first Lagos day" "1|$(date -u -d "$NEXT_MONTH" +%F)" <<SQL
SELECT count(*) || '|' || min(l ->> 'paid_date_lagos')
FROM jsonb_array_elements(public.vat_period_detail('$ADMIN', '$NEXT_MONTH', 50, NULL) -> 'lines') l
WHERE (l ->> 'order_number') = (SELECT number FROM public.orders WHERE id = '$OVATB');
SQL

assert_value "a tax line carries basis, rate, base and supplier" "platform_fee|750|100000|7500|affilova" <<SQL
SELECT (l ->> 'basis') || '|' || (l ->> 'rate_bps') || '|' || (l ->> 'base_kobo') || '|' ||
       (l ->> 'tax_kobo') || '|' || (l ->> 'supplier')
FROM jsonb_array_elements(public.vat_period_detail('$ADMIN', '$VAT_MONTH', 50, NULL) -> 'lines') l
WHERE (l ->> 'base_kobo') = '100000'
LIMIT 1;
SQL

assert_value "the adjustment is listed with its reason" "1000|Rounding correction" <<SQL
SELECT (a ->> 'amount_kobo') || '|' || (a ->> 'reason')
FROM (SELECT public.vat_period_detail('$ADMIN', '$VAT_MONTH', 50, NULL) AS d) x,
     jsonb_array_elements(x.d -> 'adjustments') a;
SQL

assert_value "pagination walks every tax line once" "3|3" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.vat_period_detail('$ADMIN', '$VAT_MONTH', 1, NULL) AS page
  UNION ALL
  SELECT public.vat_period_detail('$ADMIN', '$VAT_MONTH', 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'id' AS id FROM walk, jsonb_array_elements(walk.page -> 'lines') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT id) FROM rows);
SQL

assert_value "the export carries every row, without buyer data" "3|0" <<SQL
SELECT jsonb_array_length(public.vat_export_rows('$ADMIN', '$VAT_MONTH') -> 'rows') || '|' ||
       (SELECT count(*) FROM jsonb_array_elements(public.vat_export_rows('$ADMIN', '$VAT_MONTH') -> 'rows') r
         WHERE r ? 'buyer_email' OR r ? 'masked_email')
SQL

step "VAT reminders"

# 14th and 19th of the month after the VAT month: due soon.
assert_value "the 14th is due soon" "due_soon|$VAT_MONTH" <<SQL
SELECT (r ->> 'reminder') || '|' || (r ->> 'period')
FROM (SELECT public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +13 days" +%F)') AS r) x;
SQL

assert_value "the 19th is due soon" "due_soon" <<SQL
SELECT (r ->> 'reminder') FROM (SELECT public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +18 days" +%F)') AS r) x;
SQL

assert_value "the 21st itself is not yet overdue" "" <<SQL
SELECT coalesce(public.vat_reminder_targets('$VAT_DUE')::text, '');
SQL

assert_value "after the 21st it is overdue" "overdue" <<SQL
SELECT (r ->> 'reminder') FROM (SELECT public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +22 days" +%F)') AS r) x;
SQL

assert_value "a quiet day sends nothing" "" <<SQL
SELECT coalesce(public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +4 days" +%F)')::text, '');
SQL

# A month with no activity and no filing is never chased.
q "INSERT INTO public.vat_periods (period, status) VALUES ('$(date -u -d "$MONTH_FIRST -4 months" +%Y-%m-01)', 'open') ON CONFLICT DO NOTHING;" >/dev/null
assert_value "a month with no VAT activity is not chased" "" <<SQL
SELECT coalesce(public.vat_reminder_targets('$(date -u -d "$MONTH_FIRST -3 months" +%Y-%m-14)')::text, '');
SQL

assert_value "a reminder claim is one row per kind and period" "1|1" <<SQL
-- The hash is the same shape the app writes: a sha256 of the address in hex.
INSERT INTO public.email_log (kind, vat_period, recipient_hash, status)
VALUES ('vat_reminder:$VAT_MONTH:due_soon:${HASH1}', '$VAT_MONTH', '${HASH1}', 'pending')
ON CONFLICT DO NOTHING;
INSERT INTO public.email_log (kind, vat_period, recipient_hash, status)
VALUES ('vat_reminder:$VAT_MONTH:due_soon:${HASH1}', '$VAT_MONTH', '${HASH1}', 'pending')
ON CONFLICT DO NOTHING;
SELECT count(*) || '|' || (SELECT count(*) FROM public.email_log WHERE vat_period = '$VAT_MONTH')
FROM public.email_log WHERE kind = 'vat_reminder:$VAT_MONTH:due_soon:${HASH1}';
SQL

step "VAT workflow"

q "SELECT public.set_vat_period_status('$FINANCE', '$VAT_MONTH', 'filed', NULL, NULL, NULL, NULL);" >/dev/null
assert_value "the month is filed" "filed" <<SQL
SELECT (p ->> 'status')
FROM (SELECT public.vat_periods_list('$FINANCE', $(date -u -d "$VAT_MONTH" +%Y)) AS x) y,
     jsonb_array_elements(y.x -> 'periods') p
WHERE p ->> 'period' = '$VAT_MONTH';
SQL

assert_value "a filed month is still reminded about" "overdue" <<SQL
SELECT (r ->> 'reminder') FROM (SELECT public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +22 days" +%F)') AS r) x;
SQL

q "SELECT public.set_vat_period_status('$ADMIN', '$VAT_MONTH', 'remitted', 31000, 'VAT-REF-1', NULL, 'Paid in full');" >/dev/null
assert_value "the month is remitted" "remitted|31000" <<SQL
SELECT (p ->> 'status') || '|' || (p ->> 'remitted_amount_kobo')
FROM (SELECT public.vat_periods_list('$ADMIN', $(date -u -d "$VAT_MONTH" +%Y)) AS x) y,
     jsonb_array_elements(y.x -> 'periods') p
WHERE p ->> 'period' = '$VAT_MONTH';
SQL

assert_value "a remitted month is never chased again" "" <<SQL
SELECT coalesce(public.vat_reminder_targets('$(date -u -d "$NEXT_MONTH +22 days" +%F)')::text, '');
SQL

assert_error "a remitted month can only change through an adjustment" "period_closed" <<SQL
SELECT public.set_vat_period_status('$ADMIN', '$VAT_MONTH', 'remitted', 31000, 'VAT-REF-2', NULL, NULL);
SQL

# ---------------------------------------------------------------------------
# 10. Role matrix
#
# Every function, every role. The functions are service_role only at the grant
# level, so these calls go through the superuser and prove the check inside.
# ---------------------------------------------------------------------------
step "Role matrix"

matrix() { # name role sql
  local name="$1" role="$2" sql="$3" out
  out=$(printf '%s\n' "$sql" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB" 2>&1)
  case "$out" in
    *forbidden*) pass "$name: $role is refused" ;;
    *) fail "$name: $role is refused" "got [$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-120)]" ;;
  esac
}

money_calls=(
  "admin_overview|SELECT public.admin_overview('{A}', '$FROM_TS', '$TO_TS')"
  "admin_daily_series|SELECT public.admin_daily_series('{A}', '$D3', '$D0')"
  "admin_ledger_list|SELECT public.admin_ledger_list('{A}', NULL, NULL, NULL, 10, NULL)"
  "admin_trial_balance|SELECT public.admin_trial_balance('{A}', NULL)"
  "admin_reconciliation_list|SELECT public.admin_reconciliation_list('{A}', 10)"
  "vat_periods_list|SELECT public.vat_periods_list('{A}', 2026)"
  "vat_period_detail|SELECT public.vat_period_detail('{A}', '$VAT_MONTH', 10, NULL)"
  "vat_export_rows|SELECT public.vat_export_rows('{A}', '$VAT_MONTH')"
  "retry_refund_submission|SELECT public.retry_refund_submission('{A}', gen_random_uuid())"
)

for entry in "${money_calls[@]}"; do
  name="${entry%%|*}"
  sql="${entry#*|}"
  for role in "$SUPPORT" "$MODERATOR" "$V1" "$A1" "$NO_ROLE" "$BUYER"; do
    matrix "$name" "$role" "${sql//\{A\}/$role}"
  done
done

staff_calls=(
  "admin_orders_list|SELECT public.admin_orders_list('{A}', NULL, NULL, NULL, NULL, 5, NULL)"
  "admin_refunds_list|SELECT public.admin_refunds_list('{A}', NULL, 5, NULL)"
  "admin_disputes_list|SELECT public.admin_disputes_list('{A}', NULL, 5, NULL)"
)

for entry in "${staff_calls[@]}"; do
  name="${entry%%|*}"
  sql="${entry#*|}"
  for role in "$MODERATOR" "$V1" "$A1" "$NO_ROLE" "$BUYER"; do
    matrix "$name" "$role" "${sql//\{A\}/$role}"
  done
done

for role in "$ADMIN" "$FINANCE" "$SUPPORT"; do
  out=$(q "SELECT public.admin_orders_list('$role', NULL, NULL, NULL, NULL, 5, NULL) -> 'items' -> 0 ->> 'number'")
  if [ -n "$out" ]; then pass "admin_orders_list: $role may read"; else fail "admin_orders_list: $role may read" "got nothing"; fi
done

for role in "$ADMIN" "$FINANCE"; do
  out=$(q "SELECT public.admin_overview('$role', '$FROM_TS', '$TO_TS') ->> 'gmv_kobo'")
  if [ "$out" = "7000000" ]; then pass "admin_overview: $role may read"; else fail "admin_overview: $role may read" "got [$out]"; fi
done

# ---------------------------------------------------------------------------
# 11. Privileges and row level security
# ---------------------------------------------------------------------------
step "Privileges"

assert_error "anon cannot call the overview" "permission denied" <<'SQL'
SET ROLE anon;
SELECT public.admin_overview('44444444-4444-4444-8444-444444444401', now() - interval '1 day', now());
SQL

assert_error "a signed-in person cannot call the trial balance" "permission denied" <<'SQL'
SET ROLE authenticated;
SELECT public.admin_trial_balance('44444444-4444-4444-8444-444444444401', NULL);
SQL

assert_error "a signed-in person cannot call the order detail" "permission denied" <<'SQL'
SET ROLE authenticated;
SELECT public.admin_order_detail('44444444-4444-4444-8444-444444444401', gen_random_uuid());
SQL

assert_error "a signed-in person cannot read reconciliation runs" "permission denied" <<'SQL'
SET ROLE authenticated;
SELECT * FROM public.reconciliation_runs;
SQL

assert_error "anon cannot read reconciliation runs" "permission denied" <<'SQL'
SET ROLE anon;
SELECT * FROM public.reconciliation_runs;
SQL

assert_value "the service role can read reconciliation runs" "2" <<'SQL'
SET ROLE service_role;
SELECT count(*) FROM public.reconciliation_runs;
SQL

assert_value "the service role can call the overview" "7000000" <<SQL
SET ROLE service_role;
SELECT public.admin_overview('$ADMIN', '$FROM_TS', '$TO_TS') ->> 'gmv_kobo';
SQL

assert_value "a signed-in person still sees only their own dispute rows" "0" <<SQL
SET ROLE authenticated;
SELECT count(*) FROM public.order_disputes;
SQL

# ---------------------------------------------------------------------------
# 12. Rollback, then re-apply
# ---------------------------------------------------------------------------
step "Rollback"

bootstrap "$ROLLBACK_DB" >/dev/null || { echo "rollback bootstrap failed"; exit 1; }
apply_migrations "$ROLLBACK_DB" || exit 1

RB=$(tmpfile)
awk '
  /^-- ROLLBACK/ { inblock = 1 }
  inblock && /^-- BEGIN;/ { capture = 1 }
  capture { line = $0; sub(/^-- ?/, "", line); print line }
  capture && /^-- COMMIT;/ { exit }
' "$MIGRATION" > "$RB"

if grep -q 'DROP FUNCTION IF EXISTS public.admin_overview' "$RB"; then
  pass "the rollback block was extracted"
else
  fail "the rollback block was extracted"
fi

if run_file "$RB" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the rollback runs"
else
  fail "the rollback runs"
fi

gone=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('admin_overview','admin_orders_list',
          'admin_order_detail','admin_trial_balance','vat_periods_list','vat_reminder_targets',
          'record_dispute_provider_outcome','record_reconciliation_run','mask_email')" "$ROLLBACK_DB")
expect "the functions are gone" "0" "$gone"

cols=$(q "select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'order_disputes'
            and column_name in ('provider_resolution','provider_resolved_at','needs_decision')" "$ROLLBACK_DB")
expect "the dispute columns are gone" "0" "$cols"

tbl=$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'reconciliation_runs'" "$ROLLBACK_DB")
expect "the reconciliation table is gone" "0" "$tbl"

recorded=$(q "select count(*) from public.app_migrations where version = '20261124000100'" "$ROLLBACK_DB")
expect "the app_migrations row is gone" "0" "$recorded"

if run_file "$MIGRATION" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the migration re-applies"
else
  fail "the migration re-applies"
fi

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $ROLLBACK_DB" < "$VERIFY" 2>&1)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "the verify file passes again ($total checks)"
else
  fail "the verify file passes again" "$bad false of $total"
fi
rm -f "$RB"

# ---------------------------------------------------------------------------
# 13. Every earlier harness still passes
# ---------------------------------------------------------------------------
if [ "${SKIP_EARLIER_HARNESSES:-0}" = "1" ]; then
  printf '\n== Earlier harnesses skipped (SKIP_EARLIER_HARNESSES=1)\n'
else
  step "Earlier harnesses"
  for h in "$ROOT"/supabase/tests/*_test.sh; do
    name=$(basename "$h")
    [ "$name" = "admin_finance_test.sh" ] && continue
    if bash "$h" >/tmp/affilova_earlier_harness.log 2>&1; then
      pass "$name"
    else
      fail "$name" "$(tail -3 /tmp/affilova_earlier_harness.log | tr '\n' ' ')"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n============================================\n'
printf 'PASSED: %d\n' "$PASSED"
printf 'FAILED: %d\n' "$FAILED"
printf '============================================\n'

[ "$FAILED" -eq 0 ] || exit 1
