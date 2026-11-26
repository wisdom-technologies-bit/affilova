#!/usr/bin/env bash
# ============================================================================
# Public marketplace harness (migration 20261125000100_public_marketplace)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies every migration in order, seeds live, draft, paused and rejected
# products from active and suspended vendors, several categories and paid orders
# for the best-selling ranking, and then tests:
#
#   1. the verify file, then the migration applied a second time
#   2. public_categories(): exact counts, only categories with a live product,
#      ordered by name
#   3. public_marketplace(): only live products of active vendors ever appear;
#      drafts, paused, rejected products and a suspended vendor never do
#   4. the item shape: exactly the public fields, and no commission or affiliate
#      field anywhere in any result
#   5. search by word, by typo and by partial title
#   6. every sort, in its exact order
#   7. keyset pagination with no gap and no duplicate, and a stale cursor refused
#   8. price filters, the category filter and the limit cap
#   9. public_product_related(): excludes the product itself and anything not
#      live, at most four, newest first
#  10. public_store(): null for a suspended vendor and for a vendor with nothing
#      live, exact product count, paging
#  11. public_sitemap_entries(): only what may be indexed, capped at 5000
#  12. privileges: anon and authenticated cannot execute any function
#  13. EXPLAIN with 20000 seeded products: the search and the category query use
#      an index
#  14. the commented rollback, then re-applying the migration
#  15. every earlier harness still passes, unchanged
#
# Usage:  supabase/tests/public_marketplace_test.sh
# Env:    AFFILOVA_TEST_DB        database name (default affilova_public_marketplace_test)
#         SUPER_USER             OS user that owns the server (default postgres)
#         SKIP_EARLIER_HARNESSES=1  do not run the other harnesses at the end
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_public_marketplace_test}"
EXPLAIN_DB="${DB}_explain"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261125000100_public_marketplace.sql"
VERIFY="$ROOT/supabase/verify/20261125000100_public_marketplace_verify.sql"

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

assert_equal() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [${3:-<empty>}]"; fi
}

# assert_value <name> <expected> ; SQL on stdin
assert_value() {
  local name="$1" want="$2" out
  out=$(run_sql | grep -v '^NOTICE:' | grep -v '^psql:')
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

# assert_contains <name> <needle> <haystack>
assert_contains() {
  if printf '%s' "$3" | grep -q -- "$2"; then
    pass "$1"
  else
    fail "$1" "expected to contain [$2] in [$(printf '%s' "$3" | tr '\n' ' ' | cut -c1-200)]"
  fi
}

tmpfile() { mktemp /tmp/affilova_public_marketplace.XXXXXX.sql; }

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
again=$(q "select count(*) from public.app_migrations where version = '20261125000100'")
expect "one app_migrations row" "1" "$again"

# ---------------------------------------------------------------------------
# 1. Seed
#
# Three vendors: two active, one suspended. Ten products across four statuses
# and three categories. Paid orders inside and outside the 90 day window, a
# refunded order, and a pending order that must not count as a sale.
# ---------------------------------------------------------------------------
step "Seed"

V1='11111111-1111-4111-8111-111111111111'
V2='22222222-2222-4222-8222-222222222222'
V3='33333333-3333-4333-8333-333333333333'
BUYER='44444444-4444-4444-8444-444444444444'

P1='a1000000-0000-4000-8000-000000000001'
P2='a1000000-0000-4000-8000-000000000002'
P3='a1000000-0000-4000-8000-000000000003'
P4='a1000000-0000-4000-8000-000000000004'
P5='a1000000-0000-4000-8000-000000000005'
P6='a1000000-0000-4000-8000-000000000006'
P7='a1000000-0000-4000-8000-000000000007'
P8='a1000000-0000-4000-8000-000000000008'
P9='a1000000-0000-4000-8000-000000000009'
P10='a1000000-0000-4000-8000-000000000010'

TODAY=$(q "select (now() at time zone 'Africa/Lagos')::date")
d() { date -u -d "$TODAY - $1 days" +%F; }
RECENT_PAID=$(d 10)
OLD_PAID=$(d 120)

seed >/dev/null <<SQL
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$V1', 'ada@example.com', '2026-10-01T09:00:00Z'),
  ('$V2', 'bola@example.com', '2026-10-01T09:00:00Z'),
  ('$V3', 'chidi@example.com', '2026-10-01T09:00:00Z'),
  ('$BUYER', 'buyer@example.com', '2026-10-01T09:00:00Z');
SQL

seed >/dev/null <<SQL
INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email, status) VALUES
  ('$V1', 'Ada Digital', 'ada-digital', 'ada@example.com', 'active'),
  ('$V2', 'Bola Studio', 'bola-studio', 'bola@example.com', 'active'),
  ('$V3', 'Chidi Co', 'chidi-co', 'chidi@example.com', 'suspended');
SQL

seed >/dev/null <<SQL
INSERT INTO public.products
  (id, vendor_id, category_id, title, slug, short_description, description,
   price_kobo, compare_at_price_kobo, commission_bps, status, affiliate_approval,
   refund_window_hours, max_downloads, published_at)
VALUES
  ('$P1', '$V1', 1, 'Keto Diet Guide', 'keto-diet-guide',
   'A practical guide to a ketogenic diet.', 'Long description', 150000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-20T09:00:00Z'),
  ('$P2', '$V1', 1, 'Keto Desserts Handbook', 'keto-desserts-handbook',
   'Desserts that stay within a ketogenic plan.', 'Long description', 250000, 300000, 2000,
   'live', 'open', 24, 3, '2026-11-18T09:00:00Z'),
  ('$P3', '$V1', 2, 'Invoice Software Pro', 'invoice-software-pro',
   'Invoicing software for small businesses.', 'Long description', 500000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-10T09:00:00Z'),
  ('$P4', '$V1', 1, 'Draft Keto Notes', 'draft-keto-notes',
   'A draft that must never be listed.', 'Long description', 120000, NULL, 2000,
   'draft', 'open', 24, 3, NULL),
  ('$P5', '$V1', 1, 'Paused Keto Course', 'paused-keto-course',
   'A paused product that must never be listed.', 'Long description', 130000, NULL, 2000,
   'paused', 'open', 24, 3, '2026-11-01T09:00:00Z'),
  ('$P6', '$V1', 1, 'Rejected Keto Book', 'rejected-keto-book',
   'A rejected product that must never be listed.', 'Long description', 140000, NULL, 2000,
   'rejected', 'open', 24, 3, NULL),
  ('$P7', '$V2', 1, 'Keto Meal Planner', 'keto-meal-planner',
   'A twelve week ketogenic meal plan.', 'Long description', 100000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-22T09:00:00Z'),
  ('$P8', '$V2', 3, 'Pasta Masterclass', 'pasta-masterclass',
   'A video masterclass on fresh pasta.', 'Long description', 200000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-15T09:00:00Z'),
  ('$P9', '$V3', 1, 'Keto From Suspended', 'keto-from-suspended',
   'A live product of a suspended vendor.', 'Long description', 90000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-19T09:00:00Z'),
  ('$P10', '$V2', 2, 'Bulk Invoice Templates', 'bulk-invoice-templates',
   'Invoice templates for bulk sending.', 'Long description', 75000, NULL, 2000,
   'live', 'open', 24, 3, '2026-11-05T09:00:00Z');
SQL

seed >/dev/null <<SQL
INSERT INTO public.product_images (product_id, cloudinary_public_id, alt_text, width, height, sort, is_cover) VALUES
  ('$P1', 'affilova/keto-diet-guide/cover', 'Keto diet guide cover', 1200, 1200, 0, true),
  ('$P1', 'affilova/keto-diet-guide/back', 'Keto diet guide back page', 1200, 1200, 1, false),
  ('$P7', 'affilova/keto-meal-planner/cover', 'Keto meal planner cover', 1200, 1200, 0, true);
SQL

# Paid orders. P7 has three recent paid orders, P1 has two recent plus one
# refunded, P3 has one paid order 120 days ago (outside the window) and P8 has a
# pending order that is not a sale yet.
mk_order() {
  local n="$1" status="$2" paid="$3"
  printf "INSERT INTO public.orders (number, buyer_user_id, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, paid_at) VALUES ('%s', '%s', 'buyer@example.com', '%s', 100000, 100000, 'ref-%s', now() + interval '1 day', %s);\n" \
    "AF-$n" "$BUYER" "$status" "$n" "$paid"
}

{
  mk_order 1 paid "'${RECENT_PAID}T12:00:00Z'"
  mk_order 2 paid "'${RECENT_PAID}T12:00:00Z'"
  mk_order 3 paid "'${RECENT_PAID}T12:00:00Z'"
  mk_order 4 paid "'${RECENT_PAID}T12:00:00Z'"
  mk_order 5 paid "'${RECENT_PAID}T12:00:00Z'"
  mk_order 6 refunded "'${RECENT_PAID}T12:00:00Z'"
  mk_order 7 paid "'${OLD_PAID}T12:00:00Z'"
  mk_order 8 pending "NULL"
} | seed >/dev/null

seed >/dev/null <<SQL
INSERT INTO public.order_items
  (order_id, product_id, vendor_id, title_snapshot, unit_price_kobo, commission_bps,
   platform_fee_bps, refund_window_hours, max_downloads)
SELECT o.id, v.product_id, v.vendor_id, v.title, 100000, 2000, 1000, 24, 3
FROM (VALUES
  ('AF-1', '$P7'::uuid, '$V2'::uuid, 'Keto Meal Planner'),
  ('AF-2', '$P7'::uuid, '$V2'::uuid, 'Keto Meal Planner'),
  ('AF-3', '$P7'::uuid, '$V2'::uuid, 'Keto Meal Planner'),
  ('AF-4', '$P1'::uuid, '$V1'::uuid, 'Keto Diet Guide'),
  ('AF-5', '$P1'::uuid, '$V1'::uuid, 'Keto Diet Guide'),
  ('AF-6', '$P1'::uuid, '$V1'::uuid, 'Keto Diet Guide'),
  ('AF-7', '$P3'::uuid, '$V1'::uuid, 'Invoice Software Pro'),
  ('AF-8', '$P8'::uuid, '$V2'::uuid, 'Pasta Masterclass')
) AS v(number, product_id, vendor_id, title)
JOIN public.orders o ON o.number = v.number;
SQL

assert_value "seed: six public products" "6" <<'SQL'
SELECT count(*) FROM public.products p
JOIN public.vendor_profiles vp ON vp.user_id = p.vendor_id
WHERE p.status = 'live' AND vp.status = 'active' AND p.published_at IS NOT NULL;
SQL

# ---------------------------------------------------------------------------
# 2. public_categories()
# ---------------------------------------------------------------------------
step "public_categories()"

assert_value "three categories have a live product" "3" <<'SQL'
SELECT jsonb_array_length(public.public_categories());
SQL

assert_value "counts are exact" "ebooks:1,education:3,software:2" <<'SQL'
SELECT string_agg(e ->> 'slug' || ':' || (e ->> 'product_count'), ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_categories()) e;
SQL

assert_value "ordered exactly by name" "t" <<'SQL'
WITH f AS (SELECT e ->> 'slug' AS slug, e ->> 'name' AS name,
                  row_number() OVER () AS pos
           FROM jsonb_array_elements(public.public_categories()) e),
     s AS (SELECT slug::text AS slug, row_number() OVER (ORDER BY name) AS pos
           FROM public.product_categories c
           WHERE c.id IN (1, 2, 3))
SELECT (SELECT string_agg(slug, ',' ORDER BY pos) FROM f)
     = (SELECT string_agg(slug, ',' ORDER BY pos) FROM s);
SQL

assert_value "a category with no live product is absent" "t" <<'SQL'
SELECT NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(public.public_categories()) e
  WHERE e ->> 'slug' = 'video'
);
SQL

assert_value "only the three public fields" "name,product_count,slug" <<'SQL'
SELECT string_agg(k, ',' ORDER BY k)
FROM jsonb_object_keys(public.public_categories() -> 0) k;
SQL

# ---------------------------------------------------------------------------
# 3. public_marketplace(): what may appear
# ---------------------------------------------------------------------------
step "public_marketplace(): only live products of active vendors"

LIST="public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 24, NULL)"

assert_value "six public products, newest first" "keto-meal-planner,keto-diet-guide,keto-desserts-handbook,pasta-masterclass,invoice-software-pro,bulk-invoice-templates" <<SQL
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements($LIST -> 'items') WITH ORDINALITY AS t(e, n)
SQL

assert_value "a draft never appears" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items') e
WHERE e ->> 'slug' IN ('draft-keto-notes', 'paused-keto-course', 'rejected-keto-book');
SQL

assert_value "a suspended vendor's live product never appears" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items') e
WHERE e ->> 'slug' = 'keto-from-suspended';
SQL

assert_value "total_estimate counts only public products" "6" <<SQL
SELECT ($LIST ->> 'total_estimate');
SQL

assert_value "the item shape is exactly the public fields" "category_name,category_slug,compare_at_price_kobo,cover_public_id,price_kobo,product_id,short_description,slug,title,vendor_name,vendor_slug" <<'SQL'
SELECT string_agg(k, ',' ORDER BY k)
FROM jsonb_object_keys(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items' -> 0) k;
SQL

assert_value "compare_at_price_kobo is present only where set" "keto-desserts-handbook:300000" <<'SQL'
SELECT string_agg(e ->> 'slug' || ':' || (e ->> 'compare_at_price_kobo'), ',')
FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items') e
WHERE e ->> 'compare_at_price_kobo' IS NOT NULL;
SQL

assert_value "the cover image id is the cover, not the back page" "affilova/keto-diet-guide/cover" <<'SQL'
SELECT e ->> 'cover_public_id'
FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items') e
WHERE e ->> 'slug' = 'keto-diet-guide';
SQL

assert_value "the vendor's public name and slug are present" "Bola Studio|bola-studio" <<'SQL'
SELECT e ->> 'vendor_name' || '|' || (e ->> 'vendor_slug')
FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL) -> 'items') e
WHERE e ->> 'slug' = 'keto-meal-planner';
SQL

# No commission, affiliate or contact field anywhere in any result, as text.
for fn in \
  "public.public_categories()" \
  "public.public_marketplace(NULL,NULL,NULL,NULL,'newest',24,NULL)" \
  "public.public_marketplace(NULL,NULL,NULL,NULL,'best_selling',24,NULL)" \
  "public.public_store('ada-digital', 24, NULL)" \
  "public.public_sitemap_entries()" \
  "public.public_product_related('$P1'::uuid, 4)"
do
  body=$(q "select ($fn)::text")
  if printf '%s' "$body" | grep -qiE 'commission|affiliate|support_email|phone|vendor_id|buyer'; then
    fail "no commission, affiliate or contact field in $fn"
  else
    pass "no commission, affiliate or contact field in $fn"
  fi
done

# ---------------------------------------------------------------------------
# 4. Search
# ---------------------------------------------------------------------------
step "Search"

assert_value "a word finds every live product that has it" "keto-desserts-handbook,keto-diet-guide,keto-meal-planner" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_marketplace('keto', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "a partial title finds the product" "bulk-invoice-templates,invoice-software-pro" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_marketplace('invoi', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "a typo still finds the products" "keto-desserts-handbook,keto-diet-guide,keto-meal-planner" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_marketplace('ketp', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "a query with no match returns an empty page" "0" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace('zzzznothing', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items');
SQL

assert_value "a query longer than 80 characters is cut, not refused" "0" <<'SQL'
SELECT jsonb_array_length(
  public.public_marketplace(repeat('a', 500), NULL, NULL, NULL, 'newest', 24, NULL) -> 'items'
);
SQL

assert_value "a per cent sign is a character, not a wildcard" "0" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace('%', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items');
SQL

assert_value "an underscore is a character, not a wildcard" "0" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace('_', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items');
SQL

assert_value "search never returns a suspended vendor's product" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_marketplace('suspended', NULL, NULL, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "search combines with a category" "keto-desserts-handbook,keto-diet-guide" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_marketplace('keto', 'education', NULL, NULL, 'newest', 24, NULL) -> 'items') e
WHERE e ->> 'vendor_slug' = 'ada-digital';
SQL

# ---------------------------------------------------------------------------
# 5. Sorts
# ---------------------------------------------------------------------------
step "Sorts"

assert_value "newest" "keto-meal-planner,keto-diet-guide,keto-desserts-handbook,pasta-masterclass,invoice-software-pro,bulk-invoice-templates" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 24, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "price_low" "bulk-invoice-templates,keto-meal-planner,keto-diet-guide,pasta-masterclass,keto-desserts-handbook,invoice-software-pro" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, NULL, NULL, 'price_low', 24, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "price_high" "invoice-software-pro,keto-desserts-handbook,pasta-masterclass,keto-diet-guide,keto-meal-planner,bulk-invoice-templates" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, NULL, NULL, 'price_high', 24, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "best_selling ranks by paid orders, ties by newest" "keto-meal-planner,keto-diet-guide,keto-desserts-handbook,pasta-masterclass,invoice-software-pro,bulk-invoice-templates" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, NULL, NULL, 'best_selling', 24, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "an order older than 90 days does not count" "1" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'best_selling',24,NULL) -> 'items') e
WHERE e ->> 'slug' = 'invoice-software-pro';
SQL

assert_error "an invalid sort is refused" "invalid_sort" <<'SQL'
SELECT public.public_marketplace(NULL, NULL, NULL, NULL, 'cheapest', 24, NULL);
SQL

assert_value "a null sort falls back to newest" "keto-meal-planner" <<'SQL'
SELECT public.public_marketplace(NULL, NULL, NULL, NULL, NULL, 24, NULL) -> 'items' -> 0 ->> 'slug';
SQL

# ---------------------------------------------------------------------------
# 6. Filters
# ---------------------------------------------------------------------------
step "Filters"

assert_value "min price is inclusive" "keto-desserts-handbook,invoice-software-pro" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY (e ->> 'price_kobo')::bigint)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, 250000, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "max price is inclusive" "bulk-invoice-templates,keto-meal-planner,keto-diet-guide" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY (e ->> 'price_kobo')::bigint)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, NULL, 150000, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "a price range" "pasta-masterclass" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_marketplace(NULL, NULL, 160000, 240000, 'newest', 24, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "a category" "keto-desserts-handbook,keto-diet-guide,keto-meal-planner" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY e ->> 'slug')
FROM jsonb_array_elements(public.public_marketplace(NULL, 'education', NULL, NULL, 'newest', 24, NULL) -> 'items') e;
SQL

assert_value "category is case insensitive" "2" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace(NULL, 'SOFTWARE', NULL, NULL, 'newest', 24, NULL) -> 'items');
SQL

assert_error "an unknown category is refused" "invalid_category" <<'SQL'
SELECT public.public_marketplace(NULL, 'not-a-category', NULL, NULL, 'newest', 24, NULL);
SQL

seed >/dev/null <<'SQL'
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo,
   commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
SELECT '22222222-2222-4222-8222-222222222222', 5, 'Cap Test ' || i, 'cap-test-' || i,
       'A product for the limit cap test only.', 'x', 100000, 2000, 'live', 'open', 24, 3,
       now() - (i || ' minutes')::interval
FROM generate_series(1, 30) i;
SQL

assert_value "the limit is capped at 24" "24" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 500, NULL) -> 'items');
SQL
seed >/dev/null <<'SQL'
DELETE FROM public.products WHERE slug::text LIKE 'cap-test-%';
SQL

assert_value "a limit of zero becomes one" "1" <<'SQL'
SELECT jsonb_array_length(public.public_marketplace(NULL, NULL, NULL, NULL, 'newest', 0, NULL) -> 'items');
SQL

# ---------------------------------------------------------------------------
# 7. Cursor pagination
# ---------------------------------------------------------------------------
step "Cursor pagination"

paged_slugs() {
  local sort="$1" limit="$2" cursor="NULL" page out slugs=""
  for _ in 1 2 3 4 5 6 7 8; do
    if [ "$cursor" = "NULL" ]; then
      page=$(q "select public.public_marketplace(NULL,NULL,NULL,NULL,'$sort',$limit,NULL)::text")
    else
      page=$(q "select public.public_marketplace(NULL,NULL,NULL,NULL,'$sort',$limit,'$cursor'::jsonb)::text")
    fi
    out=$(printf '%s' "$page" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(i["slug"] for i in d["items"])); print(json.dumps(d["next_cursor"]))')
    local items next
    items=$(printf '%s\n' "$out" | sed -n '1p')
    next=$(printf '%s\n' "$out" | sed -n '2p')
    [ -n "$items" ] && slugs="${slugs:+$slugs,}$items"
    if [ "$next" = "null" ]; then break; fi
    cursor="$next"
  done
  printf '%s' "$slugs"
}

for sort in newest price_low price_high best_selling; do
  full=$(q "select string_agg(e ->> 'slug', ',' ORDER BY n)
            FROM jsonb_array_elements(public.public_marketplace(NULL,NULL,NULL,NULL,'$sort',24,NULL) -> 'items')
            WITH ORDINALITY AS t(e,n)")
  paged=$(paged_slugs "$sort" 2)
  assert_equal "$sort: paging two at a time equals the full page" "$full" "$paged"
done

assert_value "a page of two has a next_cursor" "t" <<'SQL'
SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',2,NULL) ->> 'next_cursor' IS NOT NULL;
SQL

assert_value "the last page has no next_cursor" "t" <<'SQL'
SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',6,NULL) ->> 'next_cursor' IS NULL;
SQL

assert_value "no duplicate and no gap across pages" "6|6" <<'SQL'
WITH first_page AS (
  SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',3,NULL) AS p
),
second_page AS (
  SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',3,(SELECT p -> 'next_cursor' FROM first_page)) AS p
),
all_items AS (
  SELECT e ->> 'slug' AS slug FROM first_page, jsonb_array_elements(p -> 'items') e
  UNION ALL
  SELECT e ->> 'slug' AS slug FROM second_page, jsonb_array_elements(p -> 'items') e
)
SELECT count(*) || '|' || count(DISTINCT slug) FROM all_items;
SQL

assert_error "a cursor from another sort is refused" "invalid_cursor" <<'SQL'
WITH first_page AS (
  SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'price_low',2,NULL) AS p
)
SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',2,(SELECT p -> 'next_cursor' FROM first_page));
SQL

assert_error "a malformed cursor is refused" "invalid_cursor" <<'SQL'
SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',2,'{"v":"1"}'::jsonb);
SQL

assert_error "a cursor with a non-uuid id is refused" "invalid_cursor" <<'SQL'
SELECT public.public_marketplace(NULL,NULL,NULL,NULL,'newest',2,'{"v":"1","t":"1","id":"nope","s":"newest"}'::jsonb);
SQL

# ---------------------------------------------------------------------------
# 8. public_product_related()
# ---------------------------------------------------------------------------
step "public_product_related()"

assert_value "related excludes the product itself" "0" <<SQL
SELECT count(*) FROM jsonb_array_elements(public.public_product_related('$P1'::uuid, 4)) e
WHERE e ->> 'slug' = 'keto-diet-guide';
SQL

assert_value "related is the same category, newest first" "keto-meal-planner,keto-desserts-handbook" <<SQL
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_product_related('$P1'::uuid, 4)) WITH ORDINALITY AS t(e, n);
SQL

assert_value "related never includes a non-live product" "0" <<SQL
SELECT count(*) FROM jsonb_array_elements(public.public_product_related('$P1'::uuid, 4)) e
WHERE e ->> 'slug' IN ('paused-keto-course', 'draft-keto-notes', 'rejected-keto-book', 'keto-from-suspended');
SQL

seed >/dev/null <<'SQL'
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo,
   commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
SELECT '22222222-2222-4222-8222-222222222222', 2, 'Related ' || i, 'related-' || i,
       'A related product for the cap test.', 'x', 100000 + i, 2000, 'live', 'open', 24, 3,
       now() - (i || ' hours')::interval
FROM generate_series(1, 6) i;
SQL

assert_value "related is capped at four" "4" <<'SQL'
SELECT jsonb_array_length(public.public_product_related('a1000000-0000-4000-8000-000000000003'::uuid, 10));
SQL

assert_value "a product that is not live has no related row" "0" <<SQL
SELECT jsonb_array_length(public.public_product_related('$P4'::uuid, 4));
SQL

assert_value "an unknown product has no related row" "0" <<'SQL'
SELECT jsonb_array_length(public.public_product_related(gen_random_uuid(), 4));
SQL

# Remove the cap-test products again so later counts are the seed's own.
seed >/dev/null <<'SQL'
DELETE FROM public.products WHERE slug::text LIKE 'related-%';
SQL

# ---------------------------------------------------------------------------
# 9. public_store()
# ---------------------------------------------------------------------------
step "public_store()"

assert_value "a suspended vendor has no store" "" <<'SQL'
SELECT coalesce(public.public_store('chidi-co', 12, NULL)::text, '');
SQL

assert_value "an unknown vendor has no store" "" <<'SQL'
SELECT coalesce(public.public_store('nobody-here', 12, NULL)::text, '');
SQL

assert_value "the store answers its name, slug and exact count" "Ada Digital|ada-digital|3" <<'SQL'
SELECT (s ->> 'vendor_name') || '|' || (s ->> 'vendor_slug') || '|' || (s ->> 'product_count')
FROM (SELECT public.public_store('ada-digital', 12, NULL) AS s) t;
SQL

assert_value "the store lists only its own live products, newest first" "keto-diet-guide,keto-desserts-handbook,invoice-software-pro" <<'SQL'
SELECT string_agg(e ->> 'slug', ',' ORDER BY n)
FROM jsonb_array_elements(public.public_store('ada-digital', 12, NULL) -> 'items')
  WITH ORDINALITY AS t(e, n);
SQL

assert_value "the store item shape is the same public shape" "category_name,category_slug,compare_at_price_kobo,cover_public_id,price_kobo,product_id,short_description,slug,title,vendor_name,vendor_slug" <<'SQL'
SELECT string_agg(k, ',' ORDER BY k)
FROM jsonb_object_keys(public.public_store('ada-digital', 12, NULL) -> 'items' -> 0) k;
SQL

assert_value "store paging has no gap and no duplicate" "3|3" <<'SQL'
WITH p1 AS (SELECT public.public_store('ada-digital', 2, NULL) AS p),
     p2 AS (SELECT public.public_store('ada-digital', 2, (SELECT p -> 'next_cursor' FROM p1)) AS p),
     all_items AS (
       SELECT e ->> 'slug' AS slug FROM p1, jsonb_array_elements(p -> 'items') e
       UNION ALL
       SELECT e ->> 'slug' AS slug FROM p2, jsonb_array_elements(p -> 'items') e
     )
SELECT count(*) || '|' || count(DISTINCT slug) FROM all_items;
SQL

seed >/dev/null <<'SQL'
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('55555555-5555-4555-8555-555555555555', 'dormant@example.com', now());
SQL
seed >/dev/null <<'SQL'
INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email, status)
VALUES ('55555555-5555-4555-8555-555555555555', 'Dormant Vendor', 'dormant-vendor', 'dormant@example.com', 'active');
SQL
seed >/dev/null <<'SQL'
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo,
   commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
VALUES ('55555555-5555-4555-8555-555555555555', 1, 'Dormant Draft', 'dormant-draft',
        'A draft only, so the store must not exist.', 'x', 100000, 2000, 'draft', 'open', 24, 3, NULL);
SQL

assert_value "a store whose only products are not live has no store" "" <<'SQL'
SELECT coalesce(public.public_store('dormant-vendor', 12, NULL)::text, '');
SQL

# ---------------------------------------------------------------------------
# 10. public_sitemap_entries()
# ---------------------------------------------------------------------------
step "public_sitemap_entries()"

assert_value "six products, three categories, two stores" "6|3|2" <<'SQL'
SELECT (SELECT count(*) FROM jsonb_array_elements(s -> 'products') e)
    || '|' || (SELECT count(*) FROM jsonb_array_elements(s -> 'categories') e)
    || '|' || (SELECT count(*) FROM jsonb_array_elements(s -> 'stores') e)
FROM (SELECT public.public_sitemap_entries() AS s) t;
SQL

assert_value "the sitemap never lists a non-live product" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_sitemap_entries() -> 'products') e
WHERE e ->> 'slug' IN ('draft-keto-notes','paused-keto-course','rejected-keto-book','keto-from-suspended','dormant-draft');
SQL

assert_value "the sitemap never lists a suspended store" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_sitemap_entries() -> 'stores') e
WHERE e #>> '{}' = 'chidi-co';
SQL

assert_value "every product entry has a slug and an updated_at" "0" <<'SQL'
SELECT count(*) FROM jsonb_array_elements(public.public_sitemap_entries() -> 'products') e
WHERE e ->> 'slug' IS NULL OR e ->> 'updated_at' IS NULL;
SQL

assert_value "categories are plain slugs" "ebooks,education,software" <<'SQL'
SELECT string_agg(e #>> '{}', ',' ORDER BY e #>> '{}')
FROM jsonb_array_elements(public.public_sitemap_entries() -> 'categories') e;
SQL

seed >/dev/null <<'SQL'
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo,
   commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
SELECT '11111111-1111-4111-8111-111111111111', 4, 'Sitemap Bulk ' || i, 'sitemap-bulk-' || i,
       'A bulk product for the sitemap cap.', 'x', 100000, 2000, 'live', 'open', 24, 3, now()
FROM generate_series(1, 5100) i;
SQL

assert_value "the product list is capped at 5000" "5000" <<'SQL'
SELECT jsonb_array_length(public.public_sitemap_entries() -> 'products');
SQL

seed >/dev/null <<'SQL'
DELETE FROM public.products WHERE slug::text LIKE 'sitemap-bulk-%';
SQL

# ---------------------------------------------------------------------------
# 11. Privileges
# ---------------------------------------------------------------------------
step "Privileges"

for fn in \
  "public.public_categories()" \
  "public.public_marketplace(NULL,NULL,NULL,NULL,'newest',12,NULL)" \
  "public.public_product_related(gen_random_uuid(), 4)" \
  "public.public_store('ada-digital', 12, NULL)" \
  "public.public_sitemap_entries()"
do
  out=$(q "SET ROLE anon; SELECT $fn;")
  assert_contains "anon cannot execute $fn" "permission denied" "$out"
  out=$(q "SET ROLE authenticated; SELECT $fn;")
  assert_contains "authenticated cannot execute $fn" "permission denied" "$out"
  out=$(q "SET ROLE service_role; SELECT $fn;")
  if printf '%s' "$out" | grep -q "permission denied"; then
    fail "service_role may execute $fn" "$out"
  else
    pass "service_role may execute $fn"
  fi
done

assert_value "RLS is on for every table the read models touch" "0" <<'SQL'
SELECT count(*) FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('products','product_categories','product_images','vendor_profiles','orders','order_items')
  AND c.relrowsecurity = false;
SQL

# ---------------------------------------------------------------------------
# 12. EXPLAIN with 20000 products
# ---------------------------------------------------------------------------
step "EXPLAIN with 20000 products"

bootstrap "$EXPLAIN_DB" >/dev/null || { fail "explain database"; }
apply_migrations "$EXPLAIN_DB" >/dev/null || fail "explain migrations"

SQL_DB="$EXPLAIN_DB" seed >/dev/null <<'SQL'
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('61111111-1111-4111-8111-111111111111', 'bulk@example.com', now());
INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email, status) VALUES
  ('61111111-1111-4111-8111-111111111111', 'Bulk Vendor', 'bulk-vendor', 'bulk@example.com', 'active');
INSERT INTO public.products
  (vendor_id, category_id, title, slug, short_description, description, price_kobo,
   commission_bps, status, affiliate_approval, refund_window_hours, max_downloads, published_at)
SELECT
  '61111111-1111-4111-8111-111111111111',
  (i % 9) + 1,
  CASE WHEN i % 997 = 0 THEN 'Zebra Crossing Manual ' || i ELSE 'Bulk Product ' || i END,
  'bulk-product-' || i,
  'A bulk product used only to make the planner choose an index.',
  'x', 100000 + (i % 500) * 100, 2000,
  CASE WHEN i % 40 = 0 THEN 'live'::public.product_status ELSE 'draft'::public.product_status END,
  'open', 24, 3,
  CASE WHEN i % 40 = 0 THEN now() - (i || ' minutes')::interval ELSE NULL END
FROM generate_series(1, 20000) i;
ANALYZE public.products;
SQL

count=$(q "SELECT count(*) FROM public.products;" "$EXPLAIN_DB")
expect "20000 products are seeded" "20000" "$count"

search_plan=$(q "EXPLAIN (COSTS OFF) SELECT p.id FROM public.products p WHERE p.status = 'live' AND (p.search_vector @@ pg_catalog.websearch_to_tsquery('english'::pg_catalog.regconfig, 'zebra') OR p.title ILIKE '%zebra%' OR 'zebra' OPERATOR(extensions.<%) p.title);" "$EXPLAIN_DB")
assert_contains "the search query uses an index" "Index" "$search_plan"

category_plan=$(q "EXPLAIN (COSTS OFF) SELECT p.id FROM public.products p WHERE p.category_id = 3 AND p.status = 'live' AND p.published_at IS NOT NULL;" "$EXPLAIN_DB")
assert_contains "the category query uses an index" "Index" "$category_plan"

# ---------------------------------------------------------------------------
# 13. Rollback, then re-apply
# ---------------------------------------------------------------------------
step "Rollback and re-apply"

bootstrap "$ROLLBACK_DB" >/dev/null || fail "rollback database"
apply_migrations "$ROLLBACK_DB" >/dev/null || fail "rollback migrations"

rollback_sql=$(tmpfile)
sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' "$MIGRATION" | sed 's/^-- \{0,1\}//' > "$rollback_sql"
if run_file "$rollback_sql" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the commented rollback runs"
else
  fail "the commented rollback runs"
fi
rm -f "$rollback_sql"

left=$(printf '%s\n' "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'public\_%';" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $ROLLBACK_DB")
expect "the rollback drops every function" "0" "$left"

row=$(printf '%s\n' "SELECT count(*) FROM public.app_migrations WHERE version = '20261125000100';" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $ROLLBACK_DB")
expect "the rollback removes the migration row" "0" "$row"

if run_file "$MIGRATION" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the migration applies again after the rollback"
else
  fail "the migration applies again after the rollback"
fi

# ---------------------------------------------------------------------------
# 14. Every earlier harness, unchanged
# ---------------------------------------------------------------------------
if [ "${SKIP_EARLIER_HARNESSES:-0}" = "1" ]; then
  printf '\n== Earlier harnesses (skipped)\n'
else
  step "Every earlier harness"
  for f in "$ROOT"/supabase/tests/*_test.sh; do
    [ "$(basename "$f")" = "public_marketplace_test.sh" ] && continue
    if SKIP_EARLIER_HARNESSES=1 bash "$f" >/dev/null 2>&1; then
      pass "$(basename "$f")"
    else
      fail "$(basename "$f")"
    fi
  done
fi

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
