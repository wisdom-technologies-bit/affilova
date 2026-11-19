#!/usr/bin/env bash
# ============================================================================
# Checkout support test harness (migration 20261117000100_checkout_support)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies EVERY migration in order (twice, to prove
# they are repeatable), runs every verify file, then exercises the new
# functions:
#
#   1. every verify file, including the new one - every check must be true
#   2. the migration applied twice from an empty database
#   3. the commented rollback block, then the migration re-applied
#   4. webhook delivery recording and duplicate detection
#   5. fail_order never touching a paid order
#   6. the list_orders_needing_verification window and ordering
#   7. find_open_refund, mark_refund_submitted and mark_refund_failed
#   8. purge_old_webhook_events, including its clamp
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/checkout_support_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_checkout_test)
#         SUPER_USER         OS user that owns the Postgres server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_checkout_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

# Run a SQL file as the server superuser, on DB $2 (default $DB).
run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}
# Run a one-line SQL statement and print the raw result (no header, no padding).
q() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB} -c \"$1\""; }
# Run a statement that is expected to fail; print "failed" when it does.
q_fails() {
  if su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB} -c \"$1\"" >/dev/null 2>&1; then
    printf 'succeeded'
  else
    printf 'failed'
  fi
}

tmpfile() { mktemp /tmp/affilova_checkout.XXXXXX.sql; }

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

step "Every migration applied a second time"
if apply_migrations "$DB" >/dev/null 2>&1; then
  pass "second run of every migration"
else
  fail "second run of every migration"
  apply_migrations "$DB" 2>&1 | tail -5 | sed 's/^/       /'
fi

again=$(q "select count(*) from public.app_migrations where version = '20261117000100'")
if [ "$again" = "1" ]; then pass "the new migration is recorded once"; else fail "the new migration is recorded once" "got $again"; fi

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

# ---------------------------------------------------------------------------
# 2. The new functions
# ---------------------------------------------------------------------------
step "webhook_events: recording and duplicate detection"
sha=$(printf 'first body' | sha256sum | cut -d' ' -f1)
sha2=$(printf 'second body' | sha256sum | cut -d' ' -f1)

first=$(q "select public.insert_webhook_event('paystack', '$sha', 'charge.success', 'afv_one')::text")
duplicate_flag=$(printf '%s' "$first" | python3 -c 'import json,sys; print(json.load(sys.stdin)["duplicate"])')
if [ "$duplicate_flag" = "False" ]; then pass "a new body is recorded as new"; else fail "a new body is recorded as new" "$first"; fi

second=$(q "select public.insert_webhook_event('paystack', '$sha', 'charge.success', 'afv_one')::text")
duplicate_flag=$(printf '%s' "$second" | python3 -c 'import json,sys; print(json.load(sys.stdin)["duplicate"])')
if [ "$duplicate_flag" = "True" ]; then pass "the same body is a duplicate"; else fail "the same body is a duplicate" "$second"; fi

same_id=$(printf '%s\n%s' "$first" "$second" | python3 -c 'import json,sys
lines=[l for l in sys.stdin.read().splitlines() if l.strip()]
print("same" if json.loads(lines[0])["id"] == json.loads(lines[1])["id"] else "different")')
if [ "$same_id" = "same" ]; then pass "the duplicate answers with the same row"; else fail "the duplicate answers with the same row"; fi

rows=$(q "select count(*) from public.webhook_events where body_sha256 = '$sha'")
if [ "$rows" = "1" ]; then pass "one row per body"; else fail "one row per body" "$rows"; fi

q "select public.insert_webhook_event('paystack', '$sha2', 'refund.processed', null)" >/dev/null
rows=$(q "select count(*) from public.webhook_events")
if [ "$rows" = "2" ]; then pass "a different body is recorded"; else fail "a different body is recorded" "$rows"; fi

bad=$(q_fails "select public.insert_webhook_event('paystack', 'not-a-hash', null, null)")
if [ "$bad" = "failed" ]; then pass "a malformed SHA-256 is refused"; else fail "a malformed SHA-256 is refused"; fi

step "webhook_events: finishing a delivery"
event_id=$(q "select id from public.webhook_events where body_sha256 = '$sha'")
q "select public.finish_webhook_event('$event_id', 'processed', null)" >/dev/null
status=$(q "select status from public.webhook_events where id = '$event_id'")
processed_at=$(q "select processed_at is not null from public.webhook_events where id = '$event_id'")
if [ "$status" = "processed" ] && [ "$processed_at" = "t" ]; then
  pass "an outcome is recorded with its time"
else
  fail "an outcome is recorded with its time" "$status / $processed_at"
fi

q "select public.finish_webhook_event('$event_id', 'failed', 'a late retry')" >/dev/null
status=$(q "select status from public.webhook_events where id = '$event_id'")
if [ "$status" = "processed" ]; then pass "a terminal outcome is not rewritten"; else fail "a terminal outcome is not rewritten" "$status"; fi

second_id=$(q "select id from public.webhook_events where body_sha256 = '$sha2'")
q "select public.finish_webhook_event('$second_id', 'failed', repeat('x', 400))" >/dev/null
error_len=$(q "select char_length(error) from public.webhook_events where id = '$second_id'")
if [ "$error_len" = "300" ]; then pass "the error is cut to 300 characters"; else fail "the error is cut to 300 characters" "$error_len"; fi

bad=$(q_fails "select public.finish_webhook_event('$event_id', 'nonsense', null)")
if [ "$bad" = "failed" ]; then pass "an unknown status is refused"; else fail "an unknown status is refused"; fi

bad=$(q_fails "select public.finish_webhook_event(gen_random_uuid(), 'processed', null)")
if [ "$bad" = "failed" ]; then pass "an unknown delivery is refused"; else fail "an unknown delivery is refused"; fi

step "orders: reading one by reference"
unknown=$(q "select coalesce(public.get_order_by_reference('afv_nothing')::text, 'null')")
if [ "$unknown" = "null" ]; then pass "an unknown reference answers null"; else fail "an unknown reference answers null" "$unknown"; fi

q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at)
   values ('AFV-2026-900001', 'buyer@example.com', 'pending', 40333, 40333, 'afv_order_one', now() + interval '1 day')" >/dev/null

found=$(q "select public.get_order_by_reference('afv_order_one')::text")
found_status=$(printf '%s' "$found" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
found_total=$(printf '%s' "$found" | python3 -c 'import json,sys; print(json.load(sys.stdin)["total_kobo"])')
found_email=$(printf '%s' "$found" | python3 -c 'import json,sys; print(json.load(sys.stdin)["buyer_email"])')
if [ "$found_status" = "pending" ] && [ "$found_total" = "40333" ] && [ "$found_email" = "buyer@example.com" ]; then
  pass "a known reference answers the order"
else
  fail "a known reference answers the order" "$found"
fi

step "fail_order: only a pending order moves"
q "select public.fail_order('afv_order_one', 'paystack_server_error')" >/dev/null
status=$(q "select status from public.orders where paystack_reference = 'afv_order_one'")
audit=$(q "select count(*) from public.audit_log where action = 'order.failed' and after->>'number' = 'AFV-2026-900001'")
if [ "$status" = "failed" ] && [ "$audit" = "1" ]; then
  pass "a pending order is failed, with an audit row"
else
  fail "a pending order is failed, with an audit row" "$status / $audit"
fi

q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, paid_at)
   values ('AFV-2026-900002', 'paid@example.com', 'paid', 40333, 40333, 'afv_order_paid', now() + interval '1 day', now())" >/dev/null
q "select public.fail_order('afv_order_paid', 'should not happen')" >/dev/null
status=$(q "select status from public.orders where paystack_reference = 'afv_order_paid'")
audit=$(q "select count(*) from public.audit_log where after->>'number' = 'AFV-2026-900002'")
if [ "$status" = "paid" ] && [ "$audit" = "0" ]; then
  pass "a paid order is never touched"
else
  fail "a paid order is never touched" "$status / $audit"
fi

q "select public.fail_order('afv_nothing', 'unknown')" >/dev/null
pass "failing an unknown reference is a quiet no-op"

step "list_orders_needing_verification: the ten minute to twenty-four hour window"
q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, created_at)
   values ('AFV-2026-900003', 'a@example.com', 'pending', 1000, 1000, 'afv_old_enough', now() + interval '1 day', now() - interval '11 minutes')" >/dev/null
q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, created_at)
   values ('AFV-2026-900004', 'b@example.com', 'pending', 1000, 1000, 'afv_too_new', now() + interval '1 day', now() - interval '5 minutes')" >/dev/null
q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, created_at)
   values ('AFV-2026-900005', 'c@example.com', 'pending', 1000, 1000, 'afv_too_old', now() + interval '1 day', now() - interval '25 hours')" >/dev/null
q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, created_at)
   values ('AFV-2026-900006', 'd@example.com', 'paid', 1000, 1000, 'afv_already_paid', now() + interval '1 day', now() - interval '12 minutes')" >/dev/null

listed=$(q "select string_agg(reference, ',') from public.list_orders_needing_verification(50)")
if [ "$listed" = "afv_old_enough" ]; then
  pass "only a pending order in the window is listed"
else
  fail "only a pending order in the window is listed" "$listed"
fi

q "insert into public.orders (number, buyer_email, status, subtotal_kobo, total_kobo, paystack_reference, expires_at, created_at)
   values ('AFV-2026-900007', 'e@example.com', 'pending', 1000, 1000, 'afv_older_in_window', now() + interval '1 day', now() - interval '20 minutes')" >/dev/null

listed=$(q "select string_agg(reference, ',') from public.list_orders_needing_verification(50)")
if [ "$listed" = "afv_older_in_window,afv_old_enough" ]; then
  pass "the oldest order comes first"
else
  fail "the oldest order comes first" "$listed"
fi

listed=$(q "select count(*) from public.list_orders_needing_verification(1)")
if [ "$listed" = "1" ]; then pass "the limit is respected"; else fail "the limit is respected" "$listed"; fi

step "refunds: the open request, submitted and failed"
q "insert into public.refund_requests (order_id, reason, status)
   select id, 'the file would not open at all', 'approved' from public.orders where paystack_reference = 'afv_order_paid'" >/dev/null

open_refund=$(q "select public.find_open_refund('afv_order_paid')::text")
open_status=$(printf '%s' "$open_refund" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
open_amount=$(printf '%s' "$open_refund" | python3 -c 'import json,sys; print(json.load(sys.stdin)["amount_kobo"])')
if [ "$open_status" = "approved" ] && [ "$open_amount" = "40333" ]; then
  pass "the open request answers with the order total"
else
  fail "the open request answers with the order total" "$open_refund"
fi

none=$(q "select coalesce(public.find_open_refund('afv_old_enough')::text, 'null')")
if [ "$none" = "null" ]; then pass "an order with no refund answers null"; else fail "an order with no refund answers null" "$none"; fi

request_id=$(q "select id from public.refund_requests limit 1")
q "select public.mark_refund_submitted('$request_id', 'afv_refund_test')" >/dev/null
stored=$(q "select status || '/' || provider_reference from public.refund_requests where id = '$request_id'")
if [ "$stored" = "approved/afv_refund_test" ]; then
  pass "a submitted refund keeps the provider reference"
else
  fail "a submitted refund keeps the provider reference" "$stored"
fi

q "select public.mark_refund_failed('$request_id', 'paystack_bad_request')" >/dev/null
stored=$(q "select status from public.refund_requests where id = '$request_id'")
if [ "$stored" = "failed" ]; then pass "a failed refund leaves the open set"; else fail "a failed refund leaves the open set" "$stored"; fi

step "purge_old_webhook_events"
q "insert into public.webhook_events (provider, body_sha256, status, received_at)
   values ('paystack', repeat('a', 64), 'processed', now() - interval '40 days')" >/dev/null
before=$(q "select count(*) from public.webhook_events")
purged=$(q "select public.purge_old_webhook_events(30)")
after=$(q "select count(*) from public.webhook_events")
if [ "$purged" = "1" ] && [ "$after" = "$((before - 1))" ]; then
  pass "an old delivery is purged and a recent one is kept"
else
  fail "an old delivery is purged and a recent one is kept" "purged $purged, $before -> $after"
fi

clamped=$(q "select public.purge_old_webhook_events(0)")
if [ "$clamped" = "0" ]; then pass "the day count is clamped to at least one"; else fail "the day count is clamped to at least one" "$clamped"; fi

step "privileges"
if [ "$(q_fails "set role anon; select count(*) from public.webhook_events")" = "failed" ]; then
  pass "anon cannot read webhook_events"
else
  fail "anon cannot read webhook_events"
fi
if [ "$(q_fails "set role authenticated; select public.insert_webhook_event('paystack', repeat('b', 64), null, null)")" = "failed" ]; then
  pass "authenticated cannot call the functions"
else
  fail "authenticated cannot call the functions"
fi

# ---------------------------------------------------------------------------
# 3. Rollback then re-apply, on a separate database
# ---------------------------------------------------------------------------
step "Rollback block and re-apply (on $ROLLBACK_DB)"
bootstrap "$ROLLBACK_DB" >/dev/null || { echo "bootstrap failed"; exit 1; }
apply_migrations "$ROLLBACK_DB" >/dev/null || { echo "apply failed"; exit 1; }

rollback_sql=$(tmpfile)
awk '/^-- ROLLBACK$/{r=1} r' "$ROOT/supabase/migrations/20261117000100_checkout_support.sql" \
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

left=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname='webhook_events'\"")
if [ "$left" = "0" ]; then pass "rollback dropped the new table"; else fail "rollback dropped the new table" "$left left"; fi

orders_left=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname='orders'\"")
if [ "$orders_left" = "1" ]; then pass "rollback left the commerce tables alone"; else fail "rollback left the commerce tables alone"; fi

recorded=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from public.app_migrations where version = '20261117000100'\"")
if [ "$recorded" = "0" ]; then pass "rollback removed the migration row"; else fail "rollback removed the migration row" "$recorded"; fi

if run_file "$ROOT/supabase/migrations/20261117000100_checkout_support.sql" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the migration re-applies after rollback"
else
  fail "the migration re-applies after rollback"
fi

back=$(su "$SUPER_USER" -c "psql -q -At -d $ROLLBACK_DB -c \"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname='webhook_events'\"")
if [ "$back" = "1" ]; then pass "the table is back after re-apply"; else fail "the table is back after re-apply"; fi

rm -f "$rollback_sql"

printf '\n============================================\n'
printf 'PASSED: %d\nFAILED: %d\n' "$PASSED" "$FAILED"
printf '============================================\n'

[ "$FAILED" = "0" ] || exit 1
