#!/usr/bin/env bash
# ============================================================================
# Guest refund harness (migration 20261118000100_guest_refunds)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies every migration in order, then exercises
# public.request_refund_by_email:
#
#   1. the verify file
#   2. the migration applied twice from the same database
#   3. a wrong email is refused with forbidden
#   4. the right email in a different case and with spaces around it is accepted
#   5. outside the refund window the request is opened, not auto-approved
#   6. a second open request on the same order is refused with refund_exists
#   7. a reason that is too short is refused with invalid_reason
#   8. an order that is not paid is refused with not_refundable
#   9. an order we do not have is refused with not_found
#  10. anon and authenticated cannot execute the function
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/guest_refunds_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_guest_refunds_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_guest_refunds_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261118000100_guest_refunds.sql"
VERIFY="$ROOT/supabase/verify/20261118000100_guest_refunds_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

q() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB -c \"$1\"" 2>&1; }
run_file() {
  local f="$1"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$f"
}
# SQL on stdin. Used where quoting inside `su -c` would be unreadable.
run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" 2>&1; }

# assert_error <name> <expected fragment> ; SQL on stdin
assert_error() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if printf '%s' "$out" | grep -q "$want"; then
    pass "$name"
  else
    fail "$name" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
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

step "Building $DB from an empty database"
su "$SUPER_USER" -c "psql -q -c \"DROP DATABASE IF EXISTS $DB\"" >/dev/null 2>&1
su "$SUPER_USER" -c "psql -q -c \"CREATE DATABASE $DB\"" >/dev/null || { echo "create failed"; exit 1; }

BOOT=$(mktemp /tmp/affilova_boot.XXXXXX.sql)
cat > "$BOOT" <<'SQL'
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
run_file "$BOOT" >/dev/null || { echo "bootstrap failed"; exit 1; }
rm -f "$BOOT"

for f in "$ROOT"/supabase/migrations/*.sql; do
  run_file "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }
done
count=$(q "select count(*) from public.app_migrations")
if [ "$count" = "13" ]; then pass "thirteen migrations applied"; else fail "thirteen migrations applied" "got $count"; fi

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "guest_refunds verify ($total checks)"
else
  fail "guest_refunds verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261118000100'")
if [ "$again" = "1" ]; then pass "recorded once"; else fail "recorded once" "got $again"; fi

# ---------------------------------------------------------------------------
# Fixtures: one vendor, one product with a 48 hour refund window, four paid
# orders and one pending order. Each order gets its own item so the one-open-
# request rule can be tested without interference.
# ---------------------------------------------------------------------------
step "Fixtures"
FIXTURES=$(mktemp /tmp/affilova_guest_fixtures.XXXXXX.sql)
cat > "$FIXTURES" <<'SQL'
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', 'vendor@example.com');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', 'vendor')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email, status) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', 'Guest Shop', 'guest-shop', 'vendor@example.com', 'active');

INSERT INTO public.products (
  id, vendor_id, category_id, title, slug, short_description, description,
  price_kobo, commission_bps, affiliate_approval, refund_window_hours,
  max_downloads, status
) VALUES
  ('bbbbbbbb-1111-4111-8111-111111111101', 'aaaaaaaa-1111-4111-8111-111111111101', 1,
   'Guest Product', 'guest-product', 'A product a guest bought.', 'Body.',
   1000000, 3000, 'open', 48, 3, 'live');

INSERT INTO public.orders (
  id, number, buyer_email, status, subtotal_kobo, total_kobo,
  paystack_reference, expires_at, paid_at
) VALUES
  ('cccccccc-1111-4111-8111-111111111101', 'AFV-GUEST-0001', 'Buyer@Example.com', 'paid',
   1000000, 1000000, 'afv_guest0001', now() + interval '1 day', now()),
  ('cccccccc-1111-4111-8111-111111111102', 'AFV-GUEST-0002', 'buyer@example.com', 'paid',
   1000000, 1000000, 'afv_guest0002', now() + interval '1 day', now() - interval '72 hours'),
  ('cccccccc-1111-4111-8111-111111111103', 'AFV-GUEST-0003', 'buyer@example.com', 'pending',
   1000000, 1000000, 'afv_guest0003', now() + interval '1 day', NULL);

INSERT INTO public.order_items (
  order_id, product_id, vendor_id, title_snapshot, unit_price_kobo,
  commission_bps, platform_fee_bps, refund_window_hours, max_downloads
) VALUES
  ('cccccccc-1111-4111-8111-111111111101', 'bbbbbbbb-1111-4111-8111-111111111101',
   'aaaaaaaa-1111-4111-8111-111111111101', 'Guest Product', 1000000, 3000, 1000, 48, 3),
  ('cccccccc-1111-4111-8111-111111111102', 'bbbbbbbb-1111-4111-8111-111111111101',
   'aaaaaaaa-1111-4111-8111-111111111101', 'Guest Product', 1000000, 3000, 1000, 48, 3),
  ('cccccccc-1111-4111-8111-111111111103', 'bbbbbbbb-1111-4111-8111-111111111101',
   'aaaaaaaa-1111-4111-8111-111111111101', 'Guest Product', 1000000, 3000, 1000, 48, 3);
SQL
run_file "$FIXTURES" >/dev/null || { echo "fixtures failed"; exit 1; }
rm -f "$FIXTURES"
pass "fixtures inserted"

REASON="The files do not open on my machine at all."

step "Ownership"
assert_error "wrong email is forbidden" "forbidden" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111101', 'someone@example.com', '$REASON'
);
SQL

assert_error "empty email is forbidden" "forbidden" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111101', '   ', '$REASON'
);
SQL

# The function is called on its own: a row it inserts is not visible to another
# subquery of the same statement, so the read happens in a second statement.
assert_value "right email in another case and with spaces is approved" "t" <<SQL
SELECT (public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111101', '  bUyEr@ExAmPlE.cOm  ', '$REASON'
) ->> 'auto_approved')::boolean;
SQL

assert_value "the request it opened is approved and has no requester" "approved|t|1" <<SQL
SELECT
  (SELECT q.status FROM public.refund_requests q WHERE q.order_id = 'cccccccc-1111-4111-8111-111111111101'),
  (SELECT q.requested_by IS NULL FROM public.refund_requests q WHERE q.order_id = 'cccccccc-1111-4111-8111-111111111101'),
  (SELECT count(*) FROM public.refund_requests q WHERE q.order_id = 'cccccccc-1111-4111-8111-111111111101');
SQL

assert_value "the audit row says the request came through the link" "refund.requested|access_link" <<SQL
SELECT a.action, a.after ->> 'via'
FROM public.audit_log a
WHERE a.entity_type = 'refund_request'
  AND a.after ->> 'order_id' = 'cccccccc-1111-4111-8111-111111111101';
SQL

step "The refund window"
assert_value "outside the window the request is not auto-approved" "f" <<SQL
SELECT (public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111102', 'buyer@example.com', '$REASON'
) ->> 'auto_approved')::boolean;
SQL

assert_value "outside the window it is left for a decision" "requested|f" <<SQL
SELECT
  (SELECT q.status FROM public.refund_requests q WHERE q.order_id = 'cccccccc-1111-4111-8111-111111111102'),
  (SELECT q.auto_approved FROM public.refund_requests q WHERE q.order_id = 'cccccccc-1111-4111-8111-111111111102');
SQL

step "The other refusals"
assert_error "a second open request is refused" "refund_exists" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111101', 'buyer@example.com', '$REASON'
);
SQL

assert_error "a short reason is refused" "invalid_reason" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111102', 'buyer@example.com', 'too short'
);
SQL

assert_error "an order that is not paid is refused" "not_refundable" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111103', 'buyer@example.com', '$REASON'
);
SQL

assert_error "an order we do not have is refused" "not_found" <<SQL
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-999999999999', 'buyer@example.com', '$REASON'
);
SQL

step "Privileges"
assert_error "anon cannot execute it" "permission denied" <<'SQL'
SET ROLE anon;
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111102', 'buyer@example.com', 'The files do not open at all.'
);
SQL

assert_error "authenticated cannot execute it" "permission denied" <<'SQL'
SET ROLE authenticated;
SELECT public.request_refund_by_email(
  'cccccccc-1111-4111-8111-111111111102', 'buyer@example.com', 'The files do not open at all.'
);
SQL

step "Summary"
printf '  %d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ] || exit 1
