#!/usr/bin/env bash
# ============================================================================
# Account and vendor read models harness
# (migration 20261121000200_account_vendor_read_models)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies EVERY migration in order, then exercises the
# read models the customer account screens and the merchant screens use:
#
#   1. every verify file, then the migration applied a second time
#   2. guest order claiming: an unconfirmed email claims nothing, a confirmed
#      one claims its orders and entitlements, a different case still matches,
#      another person's orders are untouched, and a second call does nothing
#   3. the account order list: newest first, keyset pages with no gap and no
#      repeat, and one buyer never sees another's order
#   4. the account order detail: items, tax lines, the refund window end, the
#      refund request, the entitlements in plain words, and no storage key
#   5. the vendor overview maths, exactly, including a refunded order, and the
#      ledger balance passed straight through
#   6. the daily series: one row per Lagos day, zero days included, and a
#      23:30 UTC sale on the Lagos day that has already started
#   7. the vendor sales list: status filter, the affiliate tag, cursor pages,
#      and no buyer name or email anywhere in the answer
#   8. the vendor refund requests and the top products
#   9. ownership isolation for every function, in both directions
#  10. the browser roles cannot execute anything; the service role can
#  11. the commented rollback, then the migration re-applied
#  12. every earlier harness still passes, unchanged
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/account_vendor_read_models_test.sh
# Env:    AFFILOVA_TEST_DB       database name (default affilova_account_vendor_test)
#         SUPER_USER            OS user that owns the server (default postgres)
#         SKIP_EARLIER_HARNESSES=1  do not run the other harnesses at the end
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_account_vendor_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261121000200_account_vendor_read_models.sql"
VERIFY="$ROOT/supabase/verify/20261121000200_account_vendor_read_models_verify.sql"

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

tmpfile() { mktemp /tmp/affilova_account_vendor.XXXXXX.sql; }

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
  email_confirmed_at timestamptz,
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
again=$(q "select count(*) from public.app_migrations where version = '20261121000200'")
if [ "$again" = "1" ]; then pass "one app_migrations row"; else fail "one app_migrations row" "got $again"; fi

# ---------------------------------------------------------------------------
# 1. Seed
# ---------------------------------------------------------------------------
step "Seed"

V1='aaaaaaaa-1111-4111-8111-111111111101'
V2='aaaaaaaa-1111-4111-8111-111111111102'
A1='aaaaaaaa-1111-4111-8111-111111111201'
B1='bbbbbbbb-1111-4111-8111-111111111101'
B2='bbbbbbbb-1111-4111-8111-111111111102'
B3='bbbbbbbb-1111-4111-8111-111111111103'
GUEST_CONFIRMED='bbbbbbbb-1111-4111-8111-111111111104'
GUEST_UNCONFIRMED='bbbbbbbb-1111-4111-8111-111111111105'
GUEST_MISMATCH='bbbbbbbb-1111-4111-8111-111111111106'
P_A='cccccccc-1111-4111-8111-111111111101'
P_B='cccccccc-1111-4111-8111-111111111102'
P_C='cccccccc-1111-4111-8111-111111111103'
F_CLEAN='dddddddd-1111-4111-8111-111111111101'
F_INFECTED='dddddddd-1111-4111-8111-111111111102'
F_B='dddddddd-1111-4111-8111-111111111103'
F_C='dddddddd-1111-4111-8111-111111111104'
CLICK='eeeeeeee-1111-4111-8111-111111111101'

# Every account is inserted into auth.users: the foundation trigger creates its
# profile and its customer role, exactly as sign-up does.
run_sql >/dev/null <<SQL
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$V1','vendor-one@example.com','2026-10-01T09:00:00Z'),
  ('$V2','vendor-two@example.com','2026-10-01T09:00:00Z'),
  ('$A1','affiliate-one@example.com','2026-10-01T09:00:00Z'),
  ('$B1','buyer1@example.com','2026-10-01T09:00:00Z'),
  ('$B2','buyer2@example.com','2026-10-01T09:00:00Z'),
  ('$B3','buyer3@example.com','2026-10-01T09:00:00Z'),
  ('$GUEST_CONFIRMED','Guest@Example.COM','2026-11-21T07:00:00Z'),
  ('$GUEST_UNCONFIRMED','guest2@example.com',NULL),
  ('$GUEST_MISMATCH','other@example.com','2026-11-21T07:00:00Z');

-- The mismatch account: the profile address is not the address auth confirmed.
UPDATE public.profiles SET email = 'mismatch@example.com' WHERE id = '$GUEST_MISMATCH';

INSERT INTO public.user_roles (user_id, role) VALUES
  ('$V1','vendor'),
  ('$V2','vendor'),
  ('$A1','affiliate');

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email) VALUES
  ('$V1','Vendor One','vendor-one','one@vendor.test'),
  ('$V2','Vendor Two','vendor-two','two@vendor.test');

INSERT INTO public.affiliate_profiles (user_id, username) VALUES
  ('$A1','affiliate_one');

-- VAT on the platform fee only, so every tax line is a real one and the total
-- still equals the price the buyer saw.
UPDATE public.settings SET value = 'true'::jsonb WHERE key = 'vat_enabled';
UPDATE public.settings SET value = '"platform_fee"'::jsonb WHERE key = 'vat_applies_to';

INSERT INTO public.products
  (id, vendor_id, category_id, title, slug, short_description, description,
   price_kobo, commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
VALUES
  ('$P_A', '$V1', 1, 'Account Product A', 'account-product-a',
   'A product a buyer downloads.', 'Long description', 500000, 2000, 'live', 'open', 24, 3,
   '2026-11-01T09:00:00Z'),
  ('$P_B', '$V1', 1, 'Account Product B', 'account-product-b',
   'A second product from the same vendor.', 'Long description', 300000, 1000, 'live', 'open', 72, 5,
   '2026-11-01T09:00:00Z'),
  ('$P_C', '$V2', 2, 'Other Store Product', 'other-store-product',
   'A product from the other vendor.', 'Long description', 1200000, 4000, 'live', 'open', 24, 2,
   '2026-11-01T09:00:00Z');

INSERT INTO public.product_images (product_id, cloudinary_public_id, alt_text, is_cover) VALUES
  ('$P_A', 'affilova/products/cover-a', 'Cover A', true),
  ('$P_A', 'affilova/products/extra-a', 'Extra A', false);

INSERT INTO public.product_files
  (id, product_id, storage_key, original_name, content_type, size_bytes, status, scan_status)
VALUES
  ('$F_CLEAN',    '$P_A', 'keys/secret-a-clean',    'workbook.pdf', 'application/pdf', 2048, 'uploaded', 'clean'),
  ('$F_INFECTED', '$P_A', 'keys/secret-a-infected', 'notes.zip',    'application/zip', 4096, 'uploaded', 'infected'),
  ('$F_B',        '$P_B', 'keys/secret-b',          'guide.pdf',    'application/pdf', 1024, 'uploaded', 'clean'),
  ('$F_C',        '$P_C', 'keys/secret-c',          'course.mp4',   'video/mp4',       8192, 'uploaded', 'clean');
SQL
pass "accounts, vendors and products are in place"

# The affiliate link and the click behind the one attributed sale.
run_sql >/dev/null <<SQL
SELECT public.create_affiliate_link('$A1', '$P_B', 'main', NULL);
SQL
LINK=$(q "select id from public.affiliate_links where affiliate_id = '$A1' and product_id = '$P_B'")

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks
  (id, link_id, affiliate_id, product_id, created_at, ip_hash, ua_hash, is_unique, sub1, utm_source)
VALUES
  ('$CLICK', '$LINK', '$A1', '$P_B', '2026-11-18T20:00:00Z', 'ip1', 'ua1', true, 'campaign-a', 'whatsapp');
SQL

# Orders through the real functions: the split, the tax line, the ledger and the
# entitlements are exactly what production writes.
run_sql >/dev/null <<SQL
SELECT public.create_order('$B1','buyer1@example.com','Buyer One','$P_A',NULL,NULL,NULL,'ref-o1');
SELECT public.create_order('$B1','buyer1@example.com','Buyer One','$P_B','$A1','$CLICK',NULL,'ref-o2');
SELECT public.create_order('$B2','buyer2@example.com','Buyer Two','$P_A',NULL,NULL,NULL,'ref-o3');
SELECT public.create_order('$B2','buyer2@example.com','Buyer Two','$P_C',NULL,NULL,NULL,'ref-o4');
SELECT public.create_order('$B3','buyer3@example.com','Buyer Three','$P_A',NULL,NULL,NULL,'ref-o5');
SELECT public.create_order(NULL,'GUEST@example.com','Guest Buyer','$P_A',NULL,NULL,NULL,'ref-o6');
SELECT public.create_order(NULL,'guest2@example.com','Guest Two','$P_A',NULL,NULL,NULL,'ref-o7');
SELECT public.create_order(NULL,'mismatch@example.com','Guest Three','$P_A',NULL,NULL,NULL,'ref-o8');
SELECT public.create_order('$B1','buyer1@example.com','Buyer One','$P_B',NULL,NULL,NULL,'ref-o9');
SELECT public.create_order('$B2','buyer2@example.com','Buyer Two','$P_C',NULL,NULL,NULL,'ref-o10');
SQL

run_sql >/dev/null <<SQL
SELECT public.process_paid_order('ref-o1', 2001, 500000, 'NGN', 7500, 'card', '2026-11-17T12:00:00Z');
SELECT public.process_paid_order('ref-o2', 2002, 300000, 'NGN', 4500, 'card', '2026-11-18T23:30:00Z');
SELECT public.process_paid_order('ref-o3', 2003, 500000, 'NGN', 7500, 'bank', '2026-11-19T10:00:00Z');
SELECT public.process_paid_order('ref-o4', 2004, 1200000, 'NGN', 18000, 'card', '2026-11-20T09:00:00Z');
SELECT public.process_paid_order('ref-o6', 2006, 500000, 'NGN', 7500, 'card', '2026-11-21T08:00:00Z');
SELECT public.process_paid_order('ref-o7', 2007, 500000, 'NGN', 7500, 'card', '2026-11-21T09:00:00Z');
SELECT public.process_paid_order('ref-o8', 2008, 500000, 'NGN', 7500, 'card', '2026-11-21T10:00:00Z');
SELECT public.process_paid_order('ref-o9', 2009, 300000, 'NGN', 4500, 'card', '2026-11-16T09:00:00Z');
SELECT public.process_paid_order('ref-o10', 2010, 1200000, 'NGN', 18000, 'card', '2026-10-01T09:00:00Z');
SQL

# Every order in this seed was created by the same statement, so they share one
# created_at. Give each its own instant, ten minutes before it was paid, so the
# "newest first" page order is a fact rather than a tie.
run_sql >/dev/null <<SQL
UPDATE public.orders
   SET created_at = paid_at - interval '10 minutes'
 WHERE paid_at IS NOT NULL;
SQL

O1=$(q "select id from public.orders where paystack_reference = 'ref-o1'")
O2=$(q "select id from public.orders where paystack_reference = 'ref-o2'")
O3=$(q "select id from public.orders where paystack_reference = 'ref-o3'")
O4=$(q "select id from public.orders where paystack_reference = 'ref-o4'")
O5=$(q "select id from public.orders where paystack_reference = 'ref-o5'")
O6=$(q "select id from public.orders where paystack_reference = 'ref-o6'")
O7=$(q "select id from public.orders where paystack_reference = 'ref-o7'")
O8=$(q "select id from public.orders where paystack_reference = 'ref-o8'")
O9=$(q "select id from public.orders where paystack_reference = 'ref-o9'")

# The refund on order 3 runs through the real path: request, decision, refund.
run_sql >/dev/null <<SQL
SELECT public.request_refund('$B2', '$O3', 'The files do not open on my machine.');
SQL
REFUND3=$(q "select id from public.refund_requests where order_id = '$O3'")
run_sql >/dev/null <<SQL
SELECT public.decide_refund('$V1', '$REFUND3', 'approve', 'Approved after checking the file.');
SELECT public.process_refund('$REFUND3', 'refund-ref-o3', 500000);
SQL

# A second request, still waiting for the vendor's decision.
run_sql >/dev/null <<SQL
INSERT INTO public.refund_requests (order_id, requested_by, reason, status, auto_approved, created_at)
VALUES ('$O1', '$B1', 'I bought this by mistake, please refund it.', 'requested', false, '2026-11-21T12:00:00Z');
SQL
REQUEST1=$(q "select id from public.refund_requests where order_id = '$O1'")

split=$(q "select platform_fee_kobo || '|' || affiliate_commission_kobo || '|' || vendor_net_kobo from public.order_items where order_id = '$O1'")
if [ "$split" = "50000|0|446250" ]; then
  pass "the seed split is exact (50000|0|446250)"
else
  fail "the seed split is exact" "got $split"
fi
pass "orders, a real refund and a waiting request are in place"

# ---------------------------------------------------------------------------
# 2. Guest order claiming
# ---------------------------------------------------------------------------
step "Guest order claiming"

assert_value "an unconfirmed email claims nothing" "0" <<SQL
SELECT public.claim_guest_orders('$GUEST_UNCONFIRMED');
SQL

assert_value "the unconfirmed account's order is still unclaimed" "t" <<SQL
SELECT buyer_user_id IS NULL FROM public.orders WHERE id = '$O7';
SQL

assert_value "a profile email that is not the confirmed address claims nothing" "0" <<SQL
SELECT public.claim_guest_orders('$GUEST_MISMATCH');
SQL

assert_value "the mismatch account's order is still unclaimed" "t" <<SQL
SELECT buyer_user_id IS NULL FROM public.orders WHERE id = '$O8';
SQL

assert_value "a confirmed email claims its order and its two entitlements" "3" <<SQL
SELECT public.claim_guest_orders('$GUEST_CONFIRMED');
SQL

assert_value "the guest order now belongs to the account" "t" <<SQL
SELECT buyer_user_id = '$GUEST_CONFIRMED' FROM public.orders WHERE id = '$O6';
SQL

assert_value "the guest entitlements now belong to the account" "2" <<SQL
SELECT count(*)
FROM public.entitlements e
JOIN public.order_items i ON i.id = e.order_item_id
WHERE i.order_id = '$O6'
  AND e.buyer_user_id = '$GUEST_CONFIRMED';
SQL

assert_value "a different case in the order email still matched" "t" <<SQL
SELECT buyer_email::text = 'GUEST@example.com' FROM public.orders WHERE id = '$O6';
SQL

assert_value "a second claim changes nothing" "0" <<SQL
SELECT public.claim_guest_orders('$GUEST_CONFIRMED');
SQL

assert_value "one audit row for the one real claim" "1" <<SQL
SELECT count(*) FROM public.audit_log
WHERE action = 'guest_orders.claimed' AND entity_id = '$GUEST_CONFIRMED';
SQL

assert_value "another buyer's order is untouched" "t" <<SQL
SELECT buyer_user_id = '$B1' FROM public.orders WHERE id = '$O1';
SQL

assert_value "a buyer with no guest orders claims nothing" "0" <<SQL
SELECT public.claim_guest_orders('$B1');
SQL

assert_error "a null account is refused" "invalid_input" <<'SQL'
SELECT public.claim_guest_orders(NULL);
SQL

# ---------------------------------------------------------------------------
# 3. Account order list
# ---------------------------------------------------------------------------
step "Account orders"

assert_value "buyer one sees their three orders, newest first" "ref-o2,ref-o1,ref-o9" <<SQL
SELECT string_agg(
         (SELECT o.paystack_reference FROM public.orders o WHERE o.number = (x ->> 'number')),
         ',' ORDER BY n
       )
FROM public.account_orders('$B1', 20, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') WITH ORDINALITY AS e(x, n);
SQL

assert_value "an order carries its product, vendor and cover" "Account Product A|Vendor One|affilova/products/cover-a" <<SQL
SELECT (x ->> 'product_title') || '|' || (x ->> 'vendor_name') || '|' || (x ->> 'cover_public_id')
FROM public.account_orders('$B1', 20, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x
WHERE x ->> 'number' = (SELECT number FROM public.orders WHERE id = '$O1');
SQL

assert_value "buyer one does not see buyer two's order" "0" <<SQL
SELECT count(*) FROM public.account_orders('$B1', 50, NULL) p,
  LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x
WHERE x ->> 'number' = (SELECT number FROM public.orders WHERE id = '$O4');
SQL

assert_value "a buyer with no orders gets an empty list" "0|true" <<SQL
SELECT pg_catalog.jsonb_array_length(p -> 'items') || '|' || (p -> 'next_cursor' = 'null'::jsonb)
FROM public.account_orders('$GUEST_UNCONFIRMED', 20, NULL) p;
SQL

assert_value "the cursor walks three pages of one order each without a gap" "3|ref-o4,ref-o3,ref-o10" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.account_orders('$B2', 1, NULL) AS page
  UNION ALL
  SELECT public.account_orders('$B2', 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
)
SELECT count(*) || '|' || string_agg(
         (SELECT o.paystack_reference FROM public.orders o WHERE o.number = (x ->> 'number')),
         ',' ORDER BY n
       )
FROM walk,
     LATERAL pg_catalog.jsonb_array_elements(walk.page -> 'items') WITH ORDINALITY AS e(x, n);
SQL

assert_value "no order appears twice across the pages" "t" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.account_orders('$B2', 1, NULL) AS page
  UNION ALL
  SELECT public.account_orders('$B2', 1, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
)
SELECT count(*) = count(DISTINCT (x ->> 'number'))
FROM walk, LATERAL pg_catalog.jsonb_array_elements(walk.page -> 'items') x;
SQL

assert_error "a cursor that is not an object is refused" "invalid_cursor" <<SQL
SELECT public.account_orders('$B1', 20, '"not-a-cursor"'::jsonb);
SQL

assert_error "a stranger's id is refused" "forbidden" <<SQL
SELECT public.account_orders(gen_random_uuid(), 20, NULL);
SQL

# ---------------------------------------------------------------------------
# 4. Account order detail
# ---------------------------------------------------------------------------
step "Account order detail"

assert_value "the detail carries the order, its item and its tax line" "500000|1|platform_fee|750|3750" <<SQL
SELECT (d ->> 'total_kobo') || '|' || pg_catalog.jsonb_array_length(d -> 'items') || '|' ||
       (d -> 'tax_lines' -> 0 ->> 'basis') || '|' ||
       (d -> 'tax_lines' -> 0 ->> 'rate_bps') || '|' ||
       (d -> 'tax_lines' -> 0 ->> 'tax_kobo')
FROM public.account_order_detail('$B1', '$O1') d;
SQL

assert_value "the refund window ends 24 hours after payment" "t" <<SQL
SELECT ((public.account_order_detail('$B1', '$O1') ->> 'refund_window_ends_at')::timestamptz
        = '2026-11-18T12:00:00Z'::timestamptz);
SQL

assert_value "two files, one clean and one not, with no storage key" "2|1|1|true" <<SQL
SELECT pg_catalog.jsonb_array_length(d -> 'entitlements') || '|' ||
       (SELECT count(*) FROM pg_catalog.jsonb_array_elements(d -> 'entitlements') e
        WHERE e ->> 'scan_clean' = 'true') || '|' ||
       (SELECT count(*) FROM pg_catalog.jsonb_array_elements(d -> 'entitlements') e
        WHERE e ->> 'scan_clean' = 'false') || '|' ||
       (d::text NOT LIKE '%keys/%')
FROM (SELECT public.account_order_detail('$B1', '$O1') AS d) detail;
SQL

assert_value "a file shows its original name, size and download counts" "workbook.pdf|2048|0|3" <<SQL
SELECT (e ->> 'file_display_name') || '|' || (e ->> 'size_bytes') || '|' ||
       (e ->> 'downloads_used') || '|' || (e ->> 'max_downloads')
FROM public.account_order_detail('$B1', '$O1') d,
     LATERAL pg_catalog.jsonb_array_elements(d -> 'entitlements') e
WHERE e ->> 'file_display_name' = 'workbook.pdf';
SQL

assert_value "no refund request yet on the first order's detail" "t" <<SQL
SELECT public.account_order_detail('$B2', '$O4') -> 'refund_request' = 'null'::jsonb;
SQL

assert_value "a refunded order shows its processed request and revoked files" "processed|2" <<SQL
SELECT (d -> 'refund_request' ->> 'status') || '|' ||
       (SELECT count(*) FROM pg_catalog.jsonb_array_elements(d -> 'entitlements') e
        WHERE e ->> 'revoked' = 'true')
FROM public.account_order_detail('$B2', '$O3') d;
SQL

assert_value "the waiting request is visible on its own order" "requested|false" <<SQL
SELECT (d -> 'refund_request' ->> 'status') || '|' || (d -> 'refund_request' ->> 'auto_approved')
FROM public.account_order_detail('$B1', '$O1') d;
SQL

assert_error "another buyer's order is forbidden" "forbidden" <<SQL
SELECT public.account_order_detail('$B2', '$O1');
SQL

assert_error "an unknown order is not found" "not_found" <<SQL
SELECT public.account_order_detail('$B1', gen_random_uuid());
SQL

# ---------------------------------------------------------------------------
# 5. Vendor overview
# ---------------------------------------------------------------------------
step "Vendor overview"

FROM_TS='2026-11-17T00:00:00+01'
TO_TS='2026-11-20T23:59:59+01'

assert_value "vendor one's exact totals, refund included" \
  "3|1300000|1130250|130000|30000|1|500000|3846" <<SQL
SELECT (o ->> 'orders') || '|' || (o ->> 'gross_kobo') || '|' || (o ->> 'vendor_net_kobo') || '|' ||
       (o ->> 'platform_fee_kobo') || '|' || (o ->> 'affiliate_commission_kobo') || '|' ||
       (o ->> 'refunds_count') || '|' || (o ->> 'refunds_kobo') || '|' || (o ->> 'refund_rate_bps')
FROM public.vendor_overview('$V1', '$FROM_TS', '$TO_TS') o;
SQL

assert_value "vendor one's affiliate orders are counted" "1" <<SQL
SELECT public.vendor_overview('$V1', '$FROM_TS', '$TO_TS') ->> 'affiliate_orders';
SQL

assert_value "vendor two sees only its own sale" "1|1200000|1071000|120000|0|0|0|0" <<SQL
SELECT (o ->> 'orders') || '|' || (o ->> 'gross_kobo') || '|' || (o ->> 'vendor_net_kobo') || '|' ||
       (o ->> 'platform_fee_kobo') || '|' || (o ->> 'affiliate_commission_kobo') || '|' ||
       (o ->> 'refunds_count') || '|' || (o ->> 'refunds_kobo') || '|' || (o ->> 'refund_rate_bps')
FROM public.vendor_overview('$V2', '$FROM_TS', '$TO_TS') o;
SQL

assert_value "the balances are the ledger's own numbers" "true|true" <<SQL
SELECT ((public.vendor_overview('$V1', '$FROM_TS', '$TO_TS') ->> 'pending_kobo')
          = (public.get_party_balance('$V1') ->> 'pending_kobo')) || '|' ||
       ((public.vendor_overview('$V1', '$FROM_TS', '$TO_TS') ->> 'available_kobo')
          = (public.get_party_balance('$V1') ->> 'available_kobo'));
SQL

assert_value "an old sale is already available" "t" <<SQL
SELECT (public.vendor_overview('$V2', '$FROM_TS', '$TO_TS') ->> 'available_kobo')::bigint >= 1071000;
SQL

assert_value "vendor two's balance is its own ledger" "true|true" <<SQL
SELECT ((public.vendor_overview('$V2', '$FROM_TS', '$TO_TS') ->> 'pending_kobo')
          = (public.get_party_balance('$V2') ->> 'pending_kobo')) || '|' ||
       ((public.vendor_overview('$V2', '$FROM_TS', '$TO_TS') ->> 'available_kobo')
          = (public.get_party_balance('$V2') ->> 'available_kobo'));
SQL

assert_value "a range with no sale is zero, not an error" "0|0|0" <<SQL
SELECT (o ->> 'orders') || '|' || (o ->> 'gross_kobo') || '|' || (o ->> 'refunds_count')
FROM public.vendor_overview('$V2', '2026-09-01T00:00:00+01', '2026-09-02T23:59:59+01') o;
SQL

assert_error "a buyer cannot read a vendor's overview" "forbidden" <<SQL
SELECT public.vendor_overview('$B1', '$FROM_TS', '$TO_TS');
SQL

assert_error "a backwards range is refused" "invalid_range" <<SQL
SELECT public.vendor_overview('$V1', '$TO_TS', '$FROM_TS');
SQL

assert_error "a range longer than 366 days is refused" "invalid_range" <<SQL
SELECT public.vendor_overview('$V1', '2025-01-01T00:00:00+01', '2026-11-20T23:59:59+01');
SQL

# ---------------------------------------------------------------------------
# 6. Vendor daily series
# ---------------------------------------------------------------------------
step "Vendor daily series"

assert_value "one row per Lagos day, zero days included, 23:30 UTC on the next day" \
  "2026-11-17|1|500000|446250,2026-11-18|0|0|0,2026-11-19|2|800000|684000,2026-11-20|0|0|0,2026-11-21|3|1500000|1338750" <<SQL
SELECT string_agg(day || '|' || orders || '|' || gross_kobo || '|' || vendor_net_kobo, ',' ORDER BY day)
FROM public.vendor_daily_series('$V1', '2026-11-17', '2026-11-21');
SQL

assert_value "vendor two's series has only its own day" "2026-11-20|1|1200000|1071000" <<SQL
SELECT string_agg(day || '|' || orders || '|' || gross_kobo || '|' || vendor_net_kobo, ',' ORDER BY day)
FROM public.vendor_daily_series('$V2', '2026-11-17', '2026-11-20')
WHERE orders > 0;
SQL

assert_value "a single day is one row" "1" <<SQL
SELECT count(*) FROM public.vendor_daily_series('$V1', '2026-11-18', '2026-11-18');
SQL

assert_error "a buyer cannot read a vendor's series" "forbidden" <<SQL
SELECT public.vendor_daily_series('$B1', '2026-11-17', '2026-11-20');
SQL

# ---------------------------------------------------------------------------
# 7. Vendor sales list
# ---------------------------------------------------------------------------
step "Vendor sales list"

assert_value "every order of the vendor, with no buyer identity" "true|true" <<SQL
SELECT ((public.vendor_sales_list('$V1', NULL, 50, NULL)::text NOT LIKE '%buyer1@example.com%')
        AND (public.vendor_sales_list('$V1', NULL, 50, NULL)::text NOT LIKE '%Buyer One%')) || '|' ||
       (public.vendor_sales_list('$V1', NULL, 50, NULL)::text NOT LIKE '%buyer_email%');
SQL

assert_value "paid orders only, newest first" "ref-o8,ref-o7,ref-o6,ref-o2,ref-o1,ref-o9" <<SQL
SELECT string_agg(
         (SELECT o.paystack_reference FROM public.orders o WHERE o.number = (x ->> 'order_number')),
         ',' ORDER BY n
       )
FROM public.vendor_sales_list('$V1', 'paid', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') WITH ORDINALITY AS e(x, n);
SQL

assert_value "the affiliate sale is tagged and the others are not" "1|5" <<SQL
SELECT count(*) FILTER (WHERE x ->> 'via_affiliate' = 'true') || '|' ||
       count(*) FILTER (WHERE x ->> 'via_affiliate' = 'false')
FROM public.vendor_sales_list('$V1', 'paid', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x;
SQL

assert_value "the refunded order appears only under refunded" "1|0" <<SQL
SELECT (SELECT pg_catalog.jsonb_array_length(p -> 'items')
        FROM public.vendor_sales_list('$V1', 'refunded', 50, NULL) p) || '|' ||
       (SELECT pg_catalog.jsonb_array_length(p -> 'items')
        FROM public.vendor_sales_list('$V1', 'disputed', 50, NULL) p);
SQL

assert_value "a pending order is listed with no paid date" "pending|true" <<SQL
SELECT (x ->> 'status') || '|' || (x -> 'paid_at' = 'null'::jsonb)
FROM public.vendor_sales_list('$V1', 'pending', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x;
SQL

assert_value "vendor two sees only its own orders" "0" <<SQL
SELECT count(*) FROM public.vendor_sales_list('$V2', NULL, 50, NULL) p,
  LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x
WHERE x ->> 'order_number' IN (
  SELECT number FROM public.orders WHERE id IN ('$O1','$O2','$O3')
);
SQL

assert_value "the cursor walks every paid order exactly once" "6|6" <<SQL
WITH RECURSIVE walk AS (
  SELECT public.vendor_sales_list('$V1', 'paid', 2, NULL) AS page
  UNION ALL
  SELECT public.vendor_sales_list('$V1', 'paid', 2, walk.page -> 'next_cursor')
  FROM walk
  WHERE walk.page -> 'next_cursor' <> 'null'::jsonb
)
SELECT count(*) || '|' || count(DISTINCT number)
FROM walk, LATERAL pg_catalog.jsonb_array_elements(walk.page -> 'items') x,
     LATERAL (SELECT x ->> 'order_number' AS number) n;
SQL

assert_value "gross and net are the item's own numbers" "500000|446250" <<SQL
SELECT (x ->> 'gross_kobo') || '|' || (x ->> 'vendor_net_kobo')
FROM public.vendor_sales_list('$V1', 'paid', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x
WHERE x ->> 'order_number' = (SELECT number FROM public.orders WHERE id = '$O1');
SQL

assert_error "an unknown status is refused" "invalid_status" <<SQL
SELECT public.vendor_sales_list('$V1', 'cancelled', 20, NULL);
SQL

assert_error "a buyer cannot read a vendor's sales" "forbidden" <<SQL
SELECT public.vendor_sales_list('$B1', NULL, 20, NULL);
SQL

# ---------------------------------------------------------------------------
# 8. Vendor refund requests and top products
# ---------------------------------------------------------------------------
step "Vendor refund requests"

assert_value "two requests on the vendor's orders, newest first" "processed|requested" <<SQL
SELECT string_agg(x ->> 'status', '|' ORDER BY n)
FROM public.vendor_refund_requests('$V1', NULL, 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') WITH ORDINALITY AS e(x, n);
SQL

assert_value "a request carries the order, the reason and the amount" "500000|true" <<SQL
SELECT (x ->> 'amount_kobo') || '|' || ((x ->> 'reason') LIKE 'I bought this%')
FROM public.vendor_refund_requests('$V1', 'requested', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x;
SQL

assert_value "the request id is the one the decision function takes" "t" <<SQL
SELECT (x ->> 'request_id')::uuid = '$REQUEST1'::uuid
FROM public.vendor_refund_requests('$V1', 'requested', 50, NULL) p,
     LATERAL pg_catalog.jsonb_array_elements(p -> 'items') x;
SQL

assert_value "vendor two has no requests" "0" <<SQL
SELECT pg_catalog.jsonb_array_length(p -> 'items')
FROM public.vendor_refund_requests('$V2', NULL, 50, NULL) p;
SQL

assert_error "an unknown request status is refused" "invalid_status" <<SQL
SELECT public.vendor_refund_requests('$V1', 'cancelled', 20, NULL);
SQL

assert_error "a buyer cannot read a vendor's requests" "forbidden" <<SQL
SELECT public.vendor_refund_requests('$B1', NULL, 20, NULL);
SQL

step "Vendor top products"

assert_value "top products by gross, with orders and refunds" \
  "Account Product A|5|2500000|1,Account Product B|1|300000|0" <<SQL
SELECT string_agg(title || '|' || orders || '|' || gross_kobo || '|' || refunds, ',' ORDER BY gross_kobo DESC)
FROM public.vendor_top_products('$V1', '2026-11-17', '2026-11-21');
SQL

assert_value "vendor two's top product is its own" "Other Store Product|1|1200000|0" <<SQL
SELECT title || '|' || orders || '|' || gross_kobo || '|' || refunds
FROM public.vendor_top_products('$V2', '2026-11-17', '2026-11-21');
SQL

assert_value "a range with no sale has no top products" "0" <<SQL
SELECT count(*) FROM public.vendor_top_products('$V1', '2026-09-01', '2026-09-02');
SQL

assert_error "a buyer cannot read a vendor's top products" "forbidden" <<SQL
SELECT public.vendor_top_products('$B1', '2026-11-17', '2026-11-21');
SQL

# ---------------------------------------------------------------------------
# 9. Function privileges
# ---------------------------------------------------------------------------
step "Privileges"

assert_error "anon cannot call the account list" "permission denied" <<SQL
SET ROLE anon;
SELECT public.account_orders('$B1', 20, NULL);
SQL

assert_error "a signed-in person cannot call the vendor overview" "permission denied" <<SQL
SET ROLE authenticated;
SELECT public.vendor_overview('$V1', '2026-11-17T00:00:00+01', '2026-11-20T23:59:59+01');
SQL

assert_error "a signed-in person cannot claim guest orders" "permission denied" <<SQL
SET ROLE authenticated;
SELECT public.claim_guest_orders('$GUEST_CONFIRMED');
SQL

assert_value "the service role can call the daily series" "1" <<SQL
SET ROLE service_role;
SELECT count(*) FROM public.vendor_daily_series('$V1', '2026-11-19', '2026-11-19');
SQL

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

if grep -q 'DROP FUNCTION IF EXISTS public.claim_guest_orders' "$RB"; then
  pass "the rollback block was extracted"
else
  fail "the rollback block was extracted"
fi

if run_file "$RB" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the rollback runs"
else
  fail "the rollback runs"
fi

gone=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('claim_guest_orders','account_orders','account_order_detail','vendor_overview','vendor_daily_series','vendor_sales_list','vendor_refund_requests','vendor_top_products')" "$ROLLBACK_DB")
if [ "$gone" = "0" ]; then pass "the functions are gone"; else fail "the functions are gone" "got $gone"; fi

recorded=$(q "select count(*) from public.app_migrations where version = '20261121000200'" "$ROLLBACK_DB")
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
    [ "$name" = "account_vendor_read_models_test.sh" ] && continue
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
