#!/usr/bin/env bash
# ============================================================================
# Affiliate read models harness (migration 20261119000100_affiliate_read_models)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies EVERY migration in order, then exercises the
# read models the affiliate and merchant screens use:
#
#   1. every verify file, then the migration applied a second time
#   2. the marketplace: live products of active vendors only, search (full text
#      and the trigram fallback), category, minimum commission, all four sorts,
#      keyset pagination with no duplicate and no missing row, the limit cap
#   3. the overview maths, exactly: clicks, unique clicks, orders, revenue,
#      commission, conversion basis points, earnings per hundred clicks
#   4. the daily series includes zero days and puts a 23:30 UTC click on the
#      Lagos day that has already started
#   5. per-link statistics and the campaign breakdown (sub1, utm_source,
#      product), with orders attributed through the click
#   6. the commission list, including a refunded order and the hold end
#   7. the vendor side: requests with status and product filters, affiliate
#      performance ordered by revenue, invites that never expose a token
#   8. ownership isolation in every direction, and revoke permissions
#   9. the browser roles cannot execute anything; the service role can
#  10. index use on the stats and click queries with 100000 clicks seeded
#  11. the commented rollback, then the migration re-applied
#  12. every earlier harness still passes, unchanged
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/affiliate_read_models_test.sh
# Env:    AFFILOVA_TEST_DB       database name (default affilova_read_models_test)
#         SUPER_USER            OS user that owns the server (default postgres)
#         SKIP_EARLIER_HARNESSES=1  do not run the other harnesses at the end
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_read_models_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261119000100_affiliate_read_models.sql"
VERIFY="$ROOT/supabase/verify/20261119000100_affiliate_read_models_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

q() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB} -c \"$1\"" 2>&1; }
run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}
run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${SQL_DB:-$DB}" 2>&1; }

# assert_error <name> <expected fragment> ; SQL on stdin
assert_error() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if printf '%s' "$out" | grep -q "$want"; then
    pass "$name"
  else
    fail "$name" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"
  fi
}

# assert_value <name> <expected> ; SQL on stdin
assert_value() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if [ "$out" = "$want" ]; then
    pass "$name"
  else
    fail "$name" "expected $want, got ${out:-<empty>}"
  fi
}

tmpfile() { mktemp /tmp/affilova_read_models.XXXXXX.sql; }

bootstrap() {
  local db="$1"
  su "$SUPER_USER" -c "psql -q -c \"DROP DATABASE IF EXISTS $db\"" >/dev/null 2>&1
  su "$SUPER_USER" -c "psql -q -c \"CREATE DATABASE $db\"" >/dev/null || return 1
  local f; f=$(tmpfile)
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
SQL
  run_file "$f" "$db"
  local status=$?
  rm -f "$f"
  return $status
}

apply_migrations() {
  local db="$1" f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    run_file "$f" "$db" >/dev/null 2>&1 || { echo "migration failed: $f"; return 1; }
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

step "Verify files"
for v in "$ROOT"/supabase/verify/*.sql; do
  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$v" 2>&1)
  total=$(printf '%s\n' "$out" | grep -c '|' || true)
  bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
  name=$(basename "$v")
  if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
    pass "$name ($total checks)"
  else
    fail "$name" "$bad false of $total"
    printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
  fi
done

step "The migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run succeeds"; else fail "second run succeeds"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261119000100'")
if [ "$again" = "1" ]; then pass "one app_migrations row"; else fail "one app_migrations row" "got $again"; fi

# ---------------------------------------------------------------------------
# 1. Seed
# ---------------------------------------------------------------------------
step "Seed"

V1='11111111-1111-4111-8111-111111111101'
V2='11111111-1111-4111-8111-111111111102'
A1='22222222-2222-4222-8222-222222222201'
A2='22222222-2222-4222-8222-222222222202'
A_SUSPENDED='22222222-2222-4222-8222-222222222203'
NO_ROLE='22222222-2222-4222-8222-222222222204'
BUYER='33333333-3333-4333-8333-333333333301'
ADMIN='44444444-4444-4444-8444-444444444401'
MODERATOR='44444444-4444-4444-8444-444444444402'
P_OPEN='55555555-5555-4555-8555-555555555501'
P_APPROVAL='55555555-5555-4555-8555-555555555502'
P_INVITE='55555555-5555-4555-8555-555555555503'
P_DRAFT='55555555-5555-4555-8555-555555555504'
P_PAUSED='55555555-5555-4555-8555-555555555505'
P_V2='55555555-5555-4555-8555-555555555506'
P_OPEN2='55555555-5555-4555-8555-555555555507'

run_sql >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('$V1','vendor1@example.com'),
  ('$V2','vendor2@example.com'),
  ('$A1','aff1@example.com'),
  ('$A2','aff2@example.com'),
  ('$A_SUSPENDED','aff3@example.com'),
  ('$NO_ROLE','norole@example.com'),
  ('$BUYER','buyer@example.com'),
  ('$ADMIN','admin@example.com'),
  ('$MODERATOR','moderator@example.com');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('$V1','vendor'),
  ('$V2','vendor'),
  ('$A1','affiliate'),
  ('$A2','affiliate'),
  ('$A_SUSPENDED','affiliate'),
  ('$ADMIN','admin'),
  ('$MODERATOR','moderator');

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email) VALUES
  ('$V1','Vendor One','vendor-one','one@vendor.test'),
  ('$V2','Vendor Two','vendor-two','two@vendor.test');

INSERT INTO public.affiliate_profiles (user_id, username) VALUES
  ('$A1','affiliate_one'),
  ('$A2','affiliate_two'),
  ('$A_SUSPENDED','affiliate_three');

UPDATE public.affiliate_profiles SET status = 'suspended' WHERE user_id = '$A_SUSPENDED';

INSERT INTO public.products
  (id, vendor_id, category_id, title, slug, short_description, description, price_kobo, commission_bps, status, affiliate_approval, published_at)
VALUES
  ('$P_OPEN',     '$V1', 1, 'Open Product',      'open-product',      'A short description here', 'Long description', 500000,  2000, 'live',    'open',     '2026-11-01T09:00:00Z'),
  ('$P_APPROVAL', '$V1', 1, 'Approval Product',  'approval-product',  'A short description here', 'Long description', 900000,  3000, 'live',    'approval', '2026-11-10T09:00:00Z'),
  ('$P_INVITE',   '$V1', 1, 'Invite Product',    'invite-product',    'A short description here', 'Long description', 700000,  2500, 'live',    'invite',   '2026-11-15T09:00:00Z'),
  ('$P_DRAFT',    '$V1', 1, 'Draft Product',     'draft-product',     'A short description here', 'Long description', 500000,  2000, 'draft',   'open',     NULL),
  ('$P_PAUSED',   '$V1', 1, 'Paused Product',    'paused-product',    'A short description here', 'Long description', 500000,  2000, 'paused',  'open',     '2026-11-05T09:00:00Z'),
  ('$P_V2',       '$V2', 2, 'Other Store',       'other-store',       'A short description here', 'Long description', 1200000, 4000, 'live',    'open',     '2026-11-18T09:00:00Z'),
  ('$P_OPEN2',    '$V1', 1, 'Second Open',       'second-open',       'A short description here', 'Long description', 300000,  3500, 'live',    'open',     '2026-11-12T09:00:00Z');

INSERT INTO public.product_images (product_id, cloudinary_public_id, alt_text, is_cover) VALUES
  ('$P_OPEN', 'affilova/products/cover-one', 'Cover one', true),
  ('$P_OPEN', 'affilova/products/extra-one', 'Extra one', false);

INSERT INTO public.affiliate_product_access (affiliate_id, product_id, status, note, requested_at) VALUES
  ('$A1','$P_APPROVAL','pending','Please let me promote this.','2026-11-19T09:00:00Z'),
  ('$A2','$P_APPROVAL','approved','Thank you.','2026-11-18T09:00:00Z'),
  ('$A1','$P_INVITE','approved','Invited.','2026-11-16T09:00:00Z'),
  ('$A2','$P_OPEN','blocked','Repeated refunds.','2026-11-17T09:00:00Z');
SQL
pass "seed inserted"

# 35 bulk products, so the limit cap and multi-page cursors are exercised.
run_sql >/dev/null <<SQL
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo, commission_bps, status, affiliate_approval, published_at)
SELECT '$V1', 3, 'Bulk Product ' || lpad(i::text, 2, '0'), 'bulk-product-' || i,
       'A short description here', 'Long description', 100000 + i, 1000, 'live', 'open',
       '2026-10-01T09:00:00Z'::timestamptz + (i || ' hours')::interval
FROM generate_series(1, 35) AS i;
SQL

# Links: two for A1 on the open product, one on the invite product, one for A2.
run_sql >/dev/null <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','main','ada-deals');
SELECT public.create_affiliate_link('$A1','$P_OPEN','second',NULL);
SELECT public.create_affiliate_link('$A1','$P_INVITE','invited',NULL);
SELECT public.create_affiliate_link('$A2','$P_OPEN2','other',NULL);
SQL

L_MAIN=$(q "select id from public.affiliate_links where affiliate_id = '$A1' and label = 'main'")
L_SECOND=$(q "select id from public.affiliate_links where affiliate_id = '$A1' and label = 'second'")
L_INVITE=$(q "select id from public.affiliate_links where affiliate_id = '$A1' and label = 'invited'")
L_A2=$(q "select id from public.affiliate_links where affiliate_id = '$A2' and label = 'other'")

# Clicks. The 23:30 UTC click on 18 November is 00:30 on 19 November in Lagos.
run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks
  (id, link_id, affiliate_id, product_id, created_at, ip_hash, ua_hash, is_unique, sub1, utm_source)
VALUES
  ('66666666-6666-4666-8666-666666666601','$L_MAIN','$A1','$P_OPEN','2026-11-16T09:00:00Z','ip1','ua1',true,NULL,'whatsapp'),
  ('66666666-6666-4666-8666-666666666602','$L_MAIN','$A1','$P_OPEN','2026-11-17T10:00:00Z','ip2','ua2',true,'campaign-a','whatsapp'),
  ('66666666-6666-4666-8666-666666666603','$L_MAIN','$A1','$P_OPEN','2026-11-17T10:05:00Z','ip3','ua3',true,'campaign-a','whatsapp'),
  ('66666666-6666-4666-8666-666666666604','$L_MAIN','$A1','$P_OPEN','2026-11-18T23:30:00Z','ip4','ua4',true,'campaign-b','x'),
  ('66666666-6666-4666-8666-666666666605','$L_SECOND','$A1','$P_OPEN','2026-11-19T08:00:00Z','ip5','ua5',true,'campaign-b','facebook'),
  ('66666666-6666-4666-8666-666666666606','$L_A2','$A2','$P_OPEN2','2026-11-17T11:00:00Z','ip6','ua6',true,'other-campaign','facebook');
SQL

# Orders: two for A1 that stay paid, one for A2, and one for A1 that is refunded.
order_total() { q "select total_kobo from public.orders where paystack_reference = '$1'"; }

run_sql >/dev/null <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$A1','66666666-6666-4666-8666-666666666602',NULL,'ref-a1-1');
SQL
run_sql >/dev/null <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$A1','66666666-6666-4666-8666-666666666605',NULL,'ref-a1-2');
SQL
run_sql >/dev/null <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN2','$A2','66666666-6666-4666-8666-666666666606',NULL,'ref-a2-1');
SQL
run_sql >/dev/null <<SQL
SELECT public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$A1','66666666-6666-4666-8666-666666666603',NULL,'ref-a1-3');
SQL

run_sql >/dev/null <<SQL
SELECT public.process_paid_order('ref-a1-1', 1001, 500000, 'NGN', 7500, 'card', '2026-11-17T12:00:00Z');
SELECT public.process_paid_order('ref-a1-2', 1002, 500000, 'NGN', 7500, 'card', '2026-11-19T09:00:00Z');
SELECT public.process_paid_order('ref-a2-1', 1003, 300000, 'NGN', 4500, 'card', '2026-11-18T12:00:00Z');
SELECT public.process_paid_order('ref-a1-3', 1004, 500000, 'NGN', 7500, 'card', '2026-11-19T10:00:00Z');
SQL

REFUND_ORDER=$(q "select id from public.orders where paystack_reference = 'ref-a1-3'")

# The refund: the order becomes refunded and the commission is reversed in the
# ledger (a debit on the affiliate payable account, balanced by platform revenue).
run_sql >/dev/null <<SQL
UPDATE public.orders SET status = 'refunded' WHERE id = '$REFUND_ORDER';

WITH txn AS (
  INSERT INTO public.ledger_transactions (kind, ref_type, ref_id, description, idempotency_key)
  VALUES ('refund', 'order', '$REFUND_ORDER', 'Harness refund', 'harness-refund-a1-3')
  RETURNING id
)
INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
SELECT id, 4, '$A1'::uuid, 100000, 0 FROM txn
UNION ALL
SELECT id, 5, NULL, 0, 100000 FROM txn;
SQL

run_sql >/dev/null <<SQL
SELECT public.rollup_affiliate_stats('2026-11-01', '2026-11-30');
SQL
pass "links, clicks, paid orders, a refund and the rollup are in place"

# ---------------------------------------------------------------------------
# 2. Marketplace
# ---------------------------------------------------------------------------
step "Marketplace"

assert_value "live products of active vendors only" "40" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.affiliate_marketplace('$A1', NULL, NULL, NULL, 'newest', 30, NULL) AS page
  UNION ALL
  SELECT public.affiliate_marketplace('$A1', NULL, NULL, NULL, 'newest', 30, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
)
SELECT count(*) FROM walk, jsonb_array_elements(walk.page -> 'items') x;
SQL

assert_value "the limit is capped at 30" "30" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', NULL, NULL, NULL, 'newest', 100, NULL) -> 'items');
SQL

assert_value "a draft product is never listed" "0" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', 'Draft Product', NULL, NULL, 'newest', 10, NULL) -> 'items');
SQL

assert_value "a paused product is never listed" "0" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', 'Paused Product', NULL, NULL, 'newest', 10, NULL) -> 'items');
SQL

assert_value "full text search finds a title" "1" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', 'Invite', NULL, NULL, 'newest', 10, NULL) -> 'items');
SQL

assert_value "the trigram fallback finds a typo" "1" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', 'Open Prodcut', NULL, NULL, 'newest', 10, NULL) -> 'items');
SQL

assert_value "the category filter uses the slug" "4" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'newest', 30, NULL) -> 'items');
SQL

assert_value "the minimum commission filter" "1" <<SQL
SELECT jsonb_array_length(public.affiliate_marketplace('$A1', NULL, NULL, 4000, 'newest', 30, NULL) -> 'items');
SQL

assert_value "my_access is the affiliate's own row" "pending" <<SQL
SELECT public.affiliate_marketplace('$A1', 'Approval Product', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_access';
SQL

assert_value "my_access is approved after the invite was accepted" "approved" <<SQL
SELECT public.affiliate_marketplace('$A1', 'Invite Product', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_access';
SQL

assert_value "my_access is none without a row" "none" <<SQL
SELECT public.affiliate_marketplace('$A1', 'Second Open', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_access';
SQL

assert_value "a blocked affiliate sees the block" "blocked" <<SQL
SELECT public.affiliate_marketplace('$A2', 'Open Product', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_access';
SQL

assert_value "my_link_count counts only this affiliate's active links" "2" <<SQL
SELECT public.affiliate_marketplace('$A1', 'Open Product', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_link_count';
SQL

assert_value "another affiliate's links are not counted" "1" <<SQL
SELECT public.affiliate_marketplace('$A2', 'Second Open', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'my_link_count';
SQL

assert_value "the cover public id comes from the cover image" "affilova/products/cover-one" <<SQL
SELECT public.affiliate_marketplace('$A1', 'Open Product', NULL, NULL, 'newest', 10, NULL) -> 'items' -> 0 ->> 'cover_public_id';
SQL

assert_value "sort by commission inside a category" "Second Open|Approval Product|Invite Product|Open Product" <<SQL
SELECT string_agg(x ->> 'title', '|')
FROM jsonb_array_elements(public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'commission', 30, NULL) -> 'items') x;
SQL

assert_value "sort by price, lowest first" "Second Open|Open Product|Invite Product|Approval Product" <<SQL
SELECT string_agg(x ->> 'title', '|')
FROM jsonb_array_elements(public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'price_low', 30, NULL) -> 'items') x;
SQL

assert_value "sort by price, highest first" "Approval Product|Invite Product|Open Product|Second Open" <<SQL
SELECT string_agg(x ->> 'title', '|')
FROM jsonb_array_elements(public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'price_high', 30, NULL) -> 'items') x;
SQL

assert_value "sort by newest, newest publication first" "Invite Product|Second Open|Approval Product|Open Product" <<SQL
SELECT string_agg(x ->> 'title', '|')
FROM jsonb_array_elements(public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'newest', 30, NULL) -> 'items') x;
SQL

# Cursor pages: 35 bulk products, 10 at a time, every page walked and compared
# with the single page that holds all of them.
assert_value "cursor pagination covers every row exactly once" "35|0|0" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.affiliate_marketplace('$A1', 'Bulk', NULL, NULL, 'newest', 10, NULL) AS page, 1 AS n
  UNION ALL
  SELECT public.affiliate_marketplace('$A1', 'Bulk', NULL, NULL, 'newest', 10, walk.page -> 'next_cursor'), walk.n + 1
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
    AND walk.n < 20
), ids AS (
  SELECT x ->> 'product_id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT total || '|' || (total - distinct_ids) || '|' || (total - 35)
FROM (SELECT count(*) AS total, count(DISTINCT id) AS distinct_ids FROM ids) s;
SQL

assert_value "a cursor from another sort is still valid JSON" "1" <<SQL
SELECT CASE WHEN public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'newest', 2,
  public.affiliate_marketplace('$A1', NULL, 'education', NULL, 'newest', 2, NULL) -> 'next_cursor') -> 'next_cursor' IS NOT NULL
  THEN 1 ELSE 0 END;
SQL

assert_error "an invalid sort is refused" "invalid_sort" <<SQL
SELECT public.affiliate_marketplace('$A1', NULL, NULL, NULL, 'cheapest', 10, NULL);
SQL

assert_error "a malformed cursor is refused" "invalid_cursor" <<SQL
SELECT public.affiliate_marketplace('$A1', NULL, NULL, NULL, 'newest', 10, '{"v": "x"}'::jsonb);
SQL

assert_error "a user without the affiliate role is refused" "forbidden" <<SQL
SELECT public.affiliate_marketplace('$NO_ROLE', NULL, NULL, NULL, 'newest', 10, NULL);
SQL

assert_error "a suspended affiliate is refused" "forbidden" <<SQL
SELECT public.affiliate_marketplace('$A_SUSPENDED', NULL, NULL, NULL, 'newest', 10, NULL);
SQL

# ---------------------------------------------------------------------------
# 3. Overview
# ---------------------------------------------------------------------------
step "Overview"

FROM_TS='2026-11-17T00:00:00Z'
TO_TS='2026-11-19T23:59:59Z'

assert_value "clicks in range" "4" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'clicks';
SQL
assert_value "unique clicks in range" "4" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'unique_clicks';
SQL
assert_value "paid orders in range, the refunded one excluded" "2" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'orders';
SQL
assert_value "revenue is the sum of the paid items" "1000000" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'revenue_kobo';
SQL
assert_value "commission is the sum of the paid commissions" "200000" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'commission_kobo';
SQL
assert_value "conversion is orders * 10000 / unique clicks" "5000" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'conversion_bps';
SQL
assert_value "earnings per hundred clicks is commission * 100 / clicks" "5000000" <<SQL
SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') ->> 'epc_kobo_per_100_clicks';
SQL
assert_value "the balance is the ledger's, pending still held" "300000|0|200000|false" <<SQL
SELECT (b ->> 'pending_kobo') || '|' || (b ->> 'available_kobo') || '|' || (b ->> 'total_kobo') || '|' || (b ->> 'negative')
FROM (SELECT public.affiliate_overview('$A1', '$FROM_TS', '$TO_TS') -> 'balance' AS b) x;
SQL
assert_value "another affiliate's numbers are their own" "1|1" <<SQL
SELECT (public.affiliate_overview('$A2', '$FROM_TS', '$TO_TS') ->> 'clicks') || '|' || (public.affiliate_overview('$A2', '$FROM_TS', '$TO_TS') ->> 'orders');
SQL
assert_value "an empty range is zero, not null" "0|0|0|0|0|0|0" <<SQL
SELECT (o ->> 'clicks') || '|' || (o ->> 'unique_clicks') || '|' || (o ->> 'orders') || '|' ||
       (o ->> 'revenue_kobo') || '|' || (o ->> 'commission_kobo') || '|' ||
       (o ->> 'conversion_bps') || '|' || (o ->> 'epc_kobo_per_100_clicks')
FROM (SELECT public.affiliate_overview('$A1', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z') AS o) x;
SQL

assert_error "a backwards range is refused" "invalid_range" <<SQL
SELECT public.affiliate_overview('$A1', '$TO_TS', '$FROM_TS');
SQL

assert_error "a range over 366 days is refused" "invalid_range" <<SQL
SELECT public.affiliate_overview('$A1', '2025-01-01T00:00:00Z', '2026-11-19T00:00:00Z');
SQL

assert_error "another person's affiliate id is refused for a user without the role" "forbidden" <<SQL
SELECT public.affiliate_overview('$NO_ROLE', '$FROM_TS', '$TO_TS');
SQL

# ---------------------------------------------------------------------------
# 4. Daily series
# ---------------------------------------------------------------------------
step "Daily series"

assert_value "one row per day, zero days included" "4" <<SQL
SELECT count(*) FROM public.affiliate_daily_series('$A1', '2026-11-16', '2026-11-19');
SQL

assert_value "the series in order, with zeros" "2026-11-16|1|2026-11-17|2|2026-11-18|0|2026-11-19|2" <<SQL
SELECT string_agg(day || '|' || clicks, '|' ORDER BY day)
FROM public.affiliate_daily_series('$A1', '2026-11-16', '2026-11-19');
SQL

assert_value "the 23:30 UTC click belongs to 19 November in Lagos" "2" <<SQL
SELECT clicks FROM public.affiliate_daily_series('$A1', '2026-11-19', '2026-11-19');
SQL

assert_value "the series carries orders and commission" "2026-11-17|1|100000|2026-11-19|1|100000" <<SQL
SELECT string_agg(day || '|' || orders || '|' || commission_kobo, '|' ORDER BY day)
FROM public.affiliate_daily_series('$A1', '2026-11-17', '2026-11-19')
WHERE orders > 0;
SQL

assert_error "the series refuses a backwards range" "invalid_range" <<SQL
SELECT * FROM public.affiliate_daily_series('$A1', '2026-11-19', '2026-11-17');
SQL

# ---------------------------------------------------------------------------
# 5. Link statistics and the breakdown
# ---------------------------------------------------------------------------
step "Link statistics"

assert_value "only this affiliate's links" "3" <<SQL
SELECT jsonb_array_length(public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 10, NULL) -> 'items');
SQL

assert_value "the busiest link first, with its numbers" "main|3|3|1|100000|active" <<SQL
SELECT (x ->> 'label') || '|' || (x ->> 'clicks') || '|' || (x ->> 'unique_clicks') || '|' ||
       (x ->> 'orders') || '|' || (x ->> 'commission_kobo') || '|' || (x ->> 'status')
FROM jsonb_array_elements(public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 10, NULL) -> 'items') x
LIMIT 1;
SQL

assert_value "a link with no activity is still listed with zeros" "invited|0" <<SQL
SELECT (x ->> 'label') || '|' || (x ->> 'clicks')
FROM jsonb_array_elements(public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 10, NULL) -> 'items') x
WHERE x ->> 'label' = 'invited';
SQL

assert_value "the code and alias are both returned" "ada-deals" <<SQL
SELECT x ->> 'alias'
FROM jsonb_array_elements(public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 10, NULL) -> 'items') x
WHERE x ->> 'label' = 'main';
SQL

assert_value "link pagination walks every link once" "3|3" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 1, NULL) AS page
  UNION ALL
  SELECT public.affiliate_link_stats('$A1', '2026-11-17', '2026-11-19', 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), ids AS (
  SELECT x ->> 'link_id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM ids) || '|' || (SELECT count(DISTINCT id) FROM ids);
SQL

assert_value "A2 sees only their own link" "1" <<SQL
SELECT jsonb_array_length(public.affiliate_link_stats('$A2', '2026-11-17', '2026-11-19', 10, NULL) -> 'items');
SQL

step "Breakdown"

assert_value "by campaign label, orders attributed through the click" "campaign-a|2|1|100000|campaign-b|2|1|100000" <<SQL
SELECT string_agg(label || '|' || clicks || '|' || orders || '|' || commission_kobo, '|' ORDER BY label)
FROM public.affiliate_breakdown('$A1', '2026-11-16', '2026-11-19', 'sub1')
WHERE label <> 'Not set';
SQL

assert_value "a click with no label is grouped as Not set" "Not set|1|0|0" <<SQL
SELECT label || '|' || clicks || '|' || orders || '|' || commission_kobo
FROM public.affiliate_breakdown('$A1', '2026-11-16', '2026-11-19', 'sub1')
WHERE label = 'Not set';
SQL

assert_value "by utm_source" "facebook|1|1|100000|whatsapp|2|1|100000|x|1|0|0" <<SQL
SELECT string_agg(label || '|' || clicks || '|' || orders || '|' || commission_kobo, '|' ORDER BY label)
FROM public.affiliate_breakdown('$A1', '2026-11-17', '2026-11-19', 'utm_source');
SQL

assert_value "by product uses the product title" "Open Product|4|4|2|200000" <<SQL
SELECT label || '|' || clicks || '|' || unique_clicks || '|' || orders || '|' || commission_kobo
FROM public.affiliate_breakdown('$A1', '2026-11-17', '2026-11-19', 'product');
SQL

assert_value "another affiliate's campaign is not in this list" "0" <<SQL
SELECT count(*) FROM public.affiliate_breakdown('$A1', '2026-11-17', '2026-11-19', 'sub1')
WHERE label = 'other-campaign';
SQL

assert_error "an unknown dimension is refused" "invalid_dimension" <<SQL
SELECT * FROM public.affiliate_breakdown('$A1', '2026-11-17', '2026-11-19', 'country');
SQL

# ---------------------------------------------------------------------------
# 6. Commission list
# ---------------------------------------------------------------------------
step "Commission list"

assert_value "every paid item, newest first, the refunded one marked" "3" <<SQL
SELECT jsonb_array_length(public.affiliate_commission_list('$A1', 10, NULL) -> 'items');
SQL

assert_value "the refunded order is listed as refunded" "refunded|100000" <<SQL
SELECT (x ->> 'status') || '|' || (x ->> 'commission_kobo')
FROM jsonb_array_elements(public.affiliate_commission_list('$A1', 10, NULL) -> 'items') x
WHERE x ->> 'status' = 'refunded';
SQL

ORDER1=$(q "select number from public.orders where paystack_reference = 'ref-a1-1'")

assert_value "available_at is the hold end from the ledger" "2026-11-24T12:00:00+00:00" <<SQL
SELECT x ->> 'available_at'
FROM jsonb_array_elements(public.affiliate_commission_list('$A1', 10, NULL) -> 'items') x
WHERE x ->> 'order_number' = '$ORDER1';
SQL

assert_value "the order number and product title are the view's columns" "$ORDER1|Open Product" <<SQL
SELECT (x ->> 'order_number') || '|' || (x ->> 'product_title')
FROM jsonb_array_elements(public.affiliate_commission_list('$A1', 10, NULL) -> 'items') x
WHERE x ->> 'order_number' = '$ORDER1';
SQL

assert_value "commission pagination walks every row once" "3|3" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.affiliate_commission_list('$A1', 2, NULL) AS page
  UNION ALL
  SELECT public.affiliate_commission_list('$A1', 2, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'order_number' AS n, x ->> 'paid_at' AS p FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT (n || p)) FROM rows);
SQL

assert_value "A2 sees only their own commission" "1" <<SQL
SELECT jsonb_array_length(public.affiliate_commission_list('$A2', 10, NULL) -> 'items');
SQL

# ---------------------------------------------------------------------------
# 7. Vendor side
# ---------------------------------------------------------------------------
step "Vendor requests"

assert_value "every request for this vendor's products" "4" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_requests('$V1', NULL, NULL, 10, NULL) -> 'items');
SQL

assert_value "filtered by status" "2|affiliate_two|approved" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_requests('$V1', 'approved', NULL, 10, NULL) -> 'items')
       || '|' || (public.vendor_affiliate_requests('$V1', 'approved', NULL, 10, NULL) -> 'items' -> 0 ->> 'username')
       || '|' || (public.vendor_affiliate_requests('$V1', 'approved', NULL, 10, NULL) -> 'items' -> 0 ->> 'status');
SQL

assert_value "filtered by product" "2|pending" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_requests('$V1', NULL, '$P_APPROVAL', 10, NULL) -> 'items')
       || '|' || (public.vendor_affiliate_requests('$V1', NULL, '$P_APPROVAL', 10, NULL) -> 'items' -> 0 ->> 'status');
SQL

assert_value "another vendor's product is not visible" "0" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_requests('$V2', NULL, '$P_APPROVAL', 10, NULL) -> 'items');
SQL

assert_value "the note is returned" "Please let me promote this." <<SQL
SELECT public.vendor_affiliate_requests('$V1', 'pending', NULL, 10, NULL) -> 'items' -> 0 ->> 'note';
SQL

assert_value "request pagination walks every row once" "4|4" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.vendor_affiliate_requests('$V1', NULL, NULL, 1, NULL) AS page
  UNION ALL
  SELECT public.vendor_affiliate_requests('$V1', NULL, NULL, 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT (x ->> 'affiliate_id') || (x ->> 'product_id') AS k FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT k) FROM rows);
SQL

assert_error "an unknown status is refused" "invalid_status" <<SQL
SELECT public.vendor_affiliate_requests('$V1', 'maybe', NULL, 10, NULL);
SQL

step "Vendor affiliate performance"

assert_value "ordered by revenue, highest first" "affiliate_one|4|2|1000000|200000|affiliate_two|1|1|300000|105000" <<SQL
SELECT string_agg(
         (x ->> 'username') || '|' || (x ->> 'clicks') || '|' || (x ->> 'orders') || '|' ||
         (x ->> 'revenue_kobo') || '|' || (x ->> 'commission_kobo'), '|' ORDER BY (x ->> 'revenue_kobo')::bigint DESC)
FROM jsonb_array_elements(public.vendor_affiliate_stats('$V1', '2026-11-17', '2026-11-19', 10, NULL) -> 'items') x;
SQL

assert_value "another vendor sees nothing of this one" "0" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_stats('$V2', '2026-11-17', '2026-11-19', 10, NULL) -> 'items');
SQL

assert_value "a range with no activity is an empty list" "0" <<SQL
SELECT jsonb_array_length(public.vendor_affiliate_stats('$V1', '2026-10-01', '2026-10-02', 10, NULL) -> 'items');
SQL

assert_value "vendor stats pagination walks every affiliate once" "2|2" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.vendor_affiliate_stats('$V1', '2026-11-17', '2026-11-19', 1, NULL) AS page
  UNION ALL
  SELECT public.vendor_affiliate_stats('$V1', '2026-11-17', '2026-11-19', 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
), rows AS (
  SELECT x ->> 'affiliate_id' AS id FROM walk, jsonb_array_elements(walk.page -> 'items') x
)
SELECT (SELECT count(*) FROM rows) || '|' || (SELECT count(DISTINCT id) FROM rows);
SQL

step "Invites"

run_sql >/dev/null <<SQL
SELECT public.create_affiliate_invite('$V1','$P_INVITE', repeat('a', 64), 5, 7);
SELECT public.create_affiliate_invite('$V1','$P_OPEN', repeat('b', 64), 1, 30);
SQL

assert_value "the vendor's two invites" "2" <<SQL
SELECT jsonb_array_length(public.vendor_invites('$V1') -> 'items');
SQL

assert_value "an invite never carries a token or a hash" "0" <<SQL
SELECT count(*)
FROM jsonb_array_elements(public.vendor_invites('$V1') -> 'items') x
WHERE x ? 'token' OR x ? 'token_hash' OR (x::text LIKE '%' || repeat('a', 64) || '%')
   OR (x::text LIKE '%' || repeat('b', 64) || '%');
SQL

assert_value "another vendor has no invites" "0" <<SQL
SELECT jsonb_array_length(public.vendor_invites('$V2') -> 'items');
SQL

assert_value "an invite shows its uses and its limits" "5|0|false" <<SQL
SELECT (x ->> 'max_uses') || '|' || (x ->> 'uses') || '|' || (x ->> 'revoked_at' IS NOT NULL)
FROM jsonb_array_elements(public.vendor_invites('$V1') -> 'items') x
WHERE x ->> 'max_uses' = '5';
SQL

INVITE=$(q "select id from public.affiliate_invites where max_uses = 5")

assert_error "another vendor cannot revoke this invite" "forbidden" <<SQL
SELECT public.revoke_affiliate_invite('$V2', '$INVITE');
SQL

assert_error "an affiliate cannot revoke an invite" "forbidden" <<SQL
SELECT public.revoke_affiliate_invite('$A1', '$INVITE');
SQL

assert_error "a missing invite is not found" "not_found" <<SQL
SELECT public.revoke_affiliate_invite('$V1', gen_random_uuid());
SQL

run_sql >/dev/null <<SQL
SELECT public.revoke_affiliate_invite('$V1', '$INVITE');
SQL

assert_value "the owner can revoke it" "1" <<SQL
SELECT count(*) FROM public.affiliate_invites WHERE id = '$INVITE' AND revoked_at IS NOT NULL;
SQL

run_sql >/dev/null <<SQL
SELECT public.revoke_affiliate_invite('$V1', '$INVITE');
SQL

assert_value "revoking twice writes one audit row" "1" <<SQL
SELECT count(*) FROM public.audit_log
WHERE action = 'affiliate_invite.revoked' AND entity_id = '$INVITE';
SQL

INVITE2=$(q "select id from public.affiliate_invites where max_uses = 1")

run_sql >/dev/null <<SQL
SELECT public.revoke_affiliate_invite('$ADMIN', '$INVITE2');
SQL

assert_value "an admin can revoke any invite" "1" <<SQL
SELECT count(*) FROM public.affiliate_invites WHERE id = '$INVITE2' AND revoked_at IS NOT NULL;
SQL

run_sql >/dev/null <<SQL
SELECT public.create_affiliate_invite('$V1','$P_OPEN', repeat('c', 64), 1, 30);
SQL
INVITE3=$(q "select id from public.affiliate_invites where max_uses = 1 and revoked_at is null limit 1")

run_sql >/dev/null <<SQL
SELECT public.revoke_affiliate_invite('$MODERATOR', '$INVITE3');
SQL

assert_value "a moderator can revoke an invite" "1" <<SQL
SELECT count(*) FROM public.affiliate_invites WHERE id = '$INVITE3' AND revoked_at IS NOT NULL;
SQL

# ---------------------------------------------------------------------------
# 8. Function privileges
# ---------------------------------------------------------------------------
step "Privileges"

assert_error "anon cannot call the marketplace" "permission denied" <<'SQL'
SET ROLE anon;
SELECT public.affiliate_marketplace('22222222-2222-4222-8222-222222222201', NULL, NULL, NULL, 'newest', 10, NULL);
SQL

assert_error "a signed-in person cannot call the overview" "permission denied" <<SQL
SET ROLE authenticated;
SELECT public.affiliate_overview('$A1', '2026-11-17T00:00:00Z', '2026-11-19T00:00:00Z');
SQL

assert_error "a signed-in person cannot revoke an invite" "permission denied" <<SQL
SET ROLE authenticated;
SELECT public.revoke_affiliate_invite('$V1', gen_random_uuid());
SQL

assert_value "the service role can call the daily series" "1" <<SQL
SET ROLE service_role;
SELECT count(*) FROM public.affiliate_daily_series('$A1', '2026-11-19', '2026-11-19');
SQL

# ---------------------------------------------------------------------------
# 9. Performance sanity: index use with 100000 clicks
# ---------------------------------------------------------------------------
step "Performance"

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks
  (id, link_id, affiliate_id, product_id, created_at, ip_hash, ua_hash, is_unique, sub1, utm_source)
SELECT
  md5('perf-click-' || i)::uuid,
  '$L_MAIN',
  '$A1',
  '$P_OPEN',
  '2026-09-01T00:00:00Z'::timestamptz + (i || ' minutes')::interval,
  md5('ip-' || i),
  md5('ua-' || i),
  (i % 3) = 0,
  'perf-' || (i % 7),
  'perf-source-' || (i % 5)
FROM generate_series(1, 100000) AS i;
SQL

# A large statistics table, so the planner has a reason to choose the index.
run_sql >/dev/null <<SQL
INSERT INTO auth.users (id, email)
SELECT md5('bulk-user-' || i)::uuid, 'bulk' || i || '@example.com'
FROM generate_series(1, 2000) AS i;

INSERT INTO public.user_roles (user_id, role)
SELECT md5('bulk-user-' || i)::uuid, 'affiliate'::public.app_role
FROM generate_series(1, 2000) AS i;

INSERT INTO public.affiliate_profiles (user_id, username)
SELECT md5('bulk-user-' || i)::uuid, 'bulk_affiliate_' || i
FROM generate_series(1, 2000) AS i;

INSERT INTO public.affiliate_daily_stats
  (day, affiliate_id, product_id, link_id, clicks, unique_clicks, orders, order_revenue_kobo, commission_kobo)
SELECT
  '2026-09-01'::date + (d % 50),
  md5('bulk-user-' || a)::uuid,
  '$P_OPEN',
  NULL,
  (a + d) % 40,
  (a + d) % 30,
  (a + d) % 3,
  0,
  0
FROM generate_series(1, 2000) AS a
CROSS JOIN generate_series(0, 49) AS d
ON CONFLICT DO NOTHING;
SQL

run_sql >/dev/null <<'SQL'
ANALYZE public.affiliate_clicks;
ANALYZE public.affiliate_daily_stats;
SQL

CLICK_PLAN=$(q "explain (format text) select sub1, count(*) from public.affiliate_clicks where affiliate_id = '$A1' and created_at >= '2026-09-01T00:00:00Z' and created_at < '2026-09-02T00:00:00Z' group by 1")
if printf '%s' "$CLICK_PLAN" | grep -q "affiliate_clicks_affiliate_created_idx"; then
  pass "the click query uses the affiliate/created index"
else
  fail "the click query uses the affiliate/created index" "$(printf '%s' "$CLICK_PLAN" | tr '\n' ' ' | cut -c1-300)"
fi

STATS_PLAN=$(q "explain (format text) select sum(clicks) from public.affiliate_daily_stats where affiliate_id = '$A1' and day between '2026-11-17' and '2026-11-19'")
if printf '%s' "$STATS_PLAN" | grep -q "affiliate_daily_stats_affiliate_day_idx"; then
  pass "the stats query uses the affiliate/day index"
else
  fail "the stats query uses the affiliate/day index" "$(printf '%s' "$STATS_PLAN" | tr '\n' ' ' | cut -c1-300)"
fi

CLICK_COUNT=$(q "select count(*) from public.affiliate_clicks where affiliate_id = '$A1'")
if [ "$CLICK_COUNT" -ge 100000 ]; then
  pass "100000 clicks are seeded ($CLICK_COUNT rows)"
else
  fail "100000 clicks are seeded" "got $CLICK_COUNT"
fi

# ---------------------------------------------------------------------------
# 10. Rollback
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

if grep -q 'DROP FUNCTION IF EXISTS public.affiliate_marketplace' "$RB"; then
  pass "the rollback block was extracted"
else
  fail "the rollback block was extracted"
fi

if run_file "$RB" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the rollback runs"
else
  fail "the rollback runs"
fi

gone=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('affiliate_marketplace','affiliate_overview','affiliate_daily_series','affiliate_link_stats','affiliate_breakdown','affiliate_commission_list','vendor_affiliate_requests','vendor_affiliate_stats','vendor_invites','revoke_affiliate_invite')" "$ROLLBACK_DB")
if [ "$gone" = "0" ]; then pass "the functions are gone"; else fail "the functions are gone" "got $gone"; fi

recorded=$(q "select count(*) from public.app_migrations where version = '20261119000100'" "$ROLLBACK_DB")
if [ "$recorded" = "0" ]; then pass "the app_migrations row is gone"; else fail "the app_migrations row is gone" "got $recorded"; fi

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
# 11. Every earlier harness still passes
# ---------------------------------------------------------------------------
if [ "${SKIP_EARLIER_HARNESSES:-0}" = "1" ]; then
  printf '\n== Earlier harnesses skipped (SKIP_EARLIER_HARNESSES=1)\n'
else
  step "Earlier harnesses"
  for h in "$ROOT"/supabase/tests/*_test.sh; do
    name=$(basename "$h")
    [ "$name" = "affiliate_read_models_test.sh" ] && continue
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
