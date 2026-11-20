#!/usr/bin/env bash
# ============================================================================
# Email log harness (migration 20261117000200_email_log)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies every migration in order, then checks the
# email log:
#
#   1. the verify file
#   2. the migration applied twice from the same database
#   3. uniqueness: the same (kind, order, recipient) cannot be claimed twice,
#      while a different kind, order or recipient can
#   4. the cascade: deleting the order takes its log rows with it
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/email_log_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_email_log_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_email_log_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261117000200_email_log.sql"
VERIFY="$ROOT/supabase/verify/20261117000200_email_log_verify.sql"

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
if [ "$count" = "12" ]; then pass "twelve migrations applied"; else fail "twelve migrations applied" "got $count"; fi

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "email_log verify ($total checks)"
else
  fail "email_log verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261117000200'")
if [ "$again" = "1" ]; then pass "recorded once"; else fail "recorded once" "got $again"; fi

step "Uniqueness and cascade"
ORDER_ID="11111111-1111-4111-8111-111111111111"
ORDER_TWO="22222222-2222-4222-8222-222222222222"

seed=$(q "insert into public.orders (id, number, buyer_email, subtotal_kobo, total_kobo, paystack_reference, expires_at)
          values ('$ORDER_ID', 'AFV-2026-900001', 'buyer@example.com', 100, 100, 'afv_test_1', now()),
                 ('$ORDER_TWO', 'AFV-2026-900002', 'buyer@example.com', 100, 100, 'afv_test_2', now()) returning id" | head -1)
if [ -n "$seed" ]; then pass "two orders seeded"; else fail "two orders seeded" "$seed"; fi

insert1=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('purchase_receipt', '$ORDER_ID', 'abcdef0123456789abcdef0123456789') returning id")
if [ -n "$insert1" ] && [[ "$insert1" != *ERROR* ]]; then pass "first claim inserted"; else fail "first claim inserted" "$insert1"; fi

dup=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('purchase_receipt', '$ORDER_ID', 'abcdef0123456789abcdef0123456789')")
if [[ "$dup" == *"email_log_one_per_recipient"* ]]; then
  pass "a second identical claim is refused by the unique key"
else
  fail "a second identical claim is refused by the unique key" "$dup"
fi

other_kind=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('vendor_sale', '$ORDER_ID', 'abcdef0123456789abcdef0123456789') returning id")
if [ -n "$other_kind" ] && [[ "$other_kind" != *ERROR* ]]; then pass "a different kind may claim the same recipient"; else fail "a different kind may claim the same recipient" "$other_kind"; fi

other_order=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('purchase_receipt', '$ORDER_TWO', 'abcdef0123456789abcdef0123456789') returning id")
if [ -n "$other_order" ] && [[ "$other_order" != *ERROR* ]]; then pass "a different order may claim the same recipient"; else fail "a different order may claim the same recipient" "$other_order"; fi

other_recipient=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('purchase_receipt', '$ORDER_ID', '0123456789abcdef0123456789abcdef') returning id")
if [ -n "$other_recipient" ] && [[ "$other_recipient" != *ERROR* ]]; then pass "a different recipient may claim the same kind"; else fail "a different recipient may claim the same kind" "$other_recipient"; fi

bad_hash=$(q "insert into public.email_log (kind, order_id, recipient_hash) values ('purchase_receipt', '$ORDER_ID', 'not-a-hash')")
if [[ "$bad_hash" == *"email_log_recipient_hash_check"* ]]; then
  pass "a non-hex recipient is refused"
else
  fail "a non-hex recipient is refused" "$bad_hash"
fi

before=$(q "select count(*) from public.email_log where order_id = '$ORDER_ID'")
q "delete from public.orders where id = '$ORDER_ID'" >/dev/null
after=$(q "select count(*) from public.email_log where order_id = '$ORDER_ID'")
if [ "$before" = "3" ] && [ "$after" = "0" ]; then
  pass "deleting the order removes its log rows"
else
  fail "deleting the order removes its log rows" "before $before after $after"
fi

step "Anon cannot read the log"
as_anon=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role anon; select count(*) from public.email_log\"" 2>&1)
if [[ "$as_anon" == *"permission denied"* ]]; then pass "anon is denied"; else fail "anon is denied" "$as_anon"; fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
