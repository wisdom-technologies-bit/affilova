#!/usr/bin/env bash
# ============================================================================
# Email diagnostics harness (migration 20261126000100_email_diagnostics)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies every migration in order, then checks the
# failures table and its three functions:
#
#   1. the verify file
#   2. the migration applied twice from the same database
#   3. record_email_failure cuts the template to 60 and the reason to 40, and
#      writes nothing for a blank one
#   4. email_failure_overview refuses an actor without admin or finance, and
#      answers the documented shape for the two roles that hold one
#   5. purge_old_email_failures deletes only what is older than the window and
#      clamps the window
#   6. anon cannot read the table
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/email_diagnostics_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_email_diag_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_email_diag_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261126000100_email_diagnostics.sql"
VERIFY="$ROOT/supabase/verify/20261126000100_email_diagnostics_verify.sql"

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
# Counted from the folder, so adding a migration does not break an old harness.
expected=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
if [ "$count" = "$expected" ]; then pass "$expected migrations applied"; else fail "$expected migrations applied" "got $count"; fi

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "email_diagnostics verify ($total checks)"
else
  fail "email_diagnostics verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261126000100'")
if [ "$again" = "1" ]; then pass "recorded once"; else fail "recorded once" "got $again"; fi

step "The actors"
ADMIN='33333333-3333-4333-8333-333333333301'
FINANCE='33333333-3333-4333-8333-333333333302'
SUPPORT='33333333-3333-4333-8333-333333333303'
MODERATOR='33333333-3333-4333-8333-333333333304'

seed_actors=$(q "insert into auth.users (id, email) values
                   ('$ADMIN','admin@example.com'),
                   ('$FINANCE','finance@example.com'),
                   ('$SUPPORT','support@example.com'),
                   ('$MODERATOR','moderator@example.com') returning id" | head -1)
if [ -n "$seed_actors" ] && [[ "$seed_actors" != *ERROR* ]]; then pass "four actors seeded"; else fail "four actors seeded" "$seed_actors"; fi

roles=$(q "insert into public.user_roles (user_id, role) values
             ('$ADMIN','admin'),
             ('$FINANCE','finance'),
             ('$SUPPORT','support'),
             ('$MODERATOR','moderator') on conflict (user_id, role) do nothing returning role" | wc -l | tr -d ' ')
if [ "$roles" = "4" ]; then pass "four roles granted"; else fail "four roles granted" "got $roles"; fi

step "record_email_failure cuts what it is given"
long_template=$(printf 'a%.0s' $(seq 1 90))
long_reason=$(printf 'b%.0s' $(seq 1 90))

q "select public.record_email_failure('$long_template', 503, '$long_reason')" >/dev/null
lengths=$(q "select char_length(template) || '/' || char_length(reason) from public.email_failures order by id desc limit 1")
if [ "$lengths" = "60/40" ]; then pass "template cut to 60 and reason cut to 40"; else fail "template cut to 60 and reason cut to 40" "got $lengths"; fi

q "select public.record_email_failure('   ', 500, 'provider_error')" >/dev/null
q "select public.record_email_failure('purchase_receipt', 500, '   ')" >/dev/null
blank=$(q "select count(*) from public.email_failures where template = '' or reason = ''")
if [ "$blank" = "0" ]; then pass "a blank template or reason writes nothing"; else fail "a blank template or reason writes nothing" "got $blank"; fi

q "select public.record_email_failure('purchase_receipt', 900, 'provider_error')" >/dev/null
clamped=$(q "select status from public.email_failures order by id desc limit 1")
if [ "$clamped" = "0" ]; then pass "an impossible status becomes 0"; else fail "an impossible status becomes 0" "got $clamped"; fi

step "email_failure_overview is for admin and finance only"
for pair in "$SUPPORT:support" "$MODERATOR:moderator"; do
  actor="${pair%%:*}"
  label="${pair##*:}"
  answer=$(q "select public.email_failure_overview('$actor')")
  if [[ "$answer" == *forbidden* ]]; then
    pass "$label is refused"
  else
    fail "$label is refused" "$answer"
  fi
done

null_actor=$(q "select public.email_failure_overview(null)")
if [[ "$null_actor" == *forbidden* ]]; then pass "a null actor is refused"; else fail "a null actor is refused" "$null_actor"; fi

# Two rows inside the window, with reasons the page knows.
q "delete from public.email_failures" >/dev/null
q "insert into public.email_failures (template, status, reason, created_at) values
     ('purchase_receipt', 401, 'unauthorized', now() - interval '1 hour'),
     ('purchase_receipt', 401, 'unauthorized', now() - interval '2 hours'),
     ('step_up_code', 503, 'provider_error', now() - interval '3 hours'),
     ('purchase_receipt', 401, 'unauthorized', now() - interval '30 hours')" >/dev/null

admin_answer=$(q "select public.email_failure_overview('$ADMIN')")
admin_total=$(q "select (public.email_failure_overview('$ADMIN')::jsonb #>> '{last_24h,total}')")
admin_unauthorized=$(q "select (public.email_failure_overview('$ADMIN')::jsonb #>> '{last_24h,by_reason,unauthorized}')")
admin_provider=$(q "select (public.email_failure_overview('$ADMIN')::jsonb #>> '{last_24h,by_reason,provider_error}')")
admin_recent=$(q "select jsonb_array_length(public.email_failure_overview('$ADMIN')::jsonb -> 'recent')")

if [ "$admin_total" = "3" ]; then pass "the window counts the last 24 hours only"; else fail "the window counts the last 24 hours only" "got $admin_total"; fi
if [ "$admin_unauthorized" = "2" ] && [ "$admin_provider" = "1" ]; then
  pass "the window groups by reason"
else
  fail "the window groups by reason" "unauthorized $admin_unauthorized provider $admin_provider"
fi
if [ "$admin_recent" = "4" ]; then pass "recent lists every row, newest first"; else fail "recent lists every row" "got $admin_recent"; fi

first_reason=$(q "select public.email_failure_overview('$ADMIN')::jsonb #>> '{recent,0,reason}'")
if [ "$first_reason" = "unauthorized" ]; then pass "recent is newest first"; else fail "recent is newest first" "got $first_reason"; fi

shape=$(q "select (public.email_failure_overview('$ADMIN')::jsonb -> 'recent' -> 0 ->> 'template') || '/' || (public.email_failure_overview('$ADMIN')::jsonb -> 'recent' -> 0 ->> 'status')")
if [ "$shape" = "purchase_receipt/401" ]; then pass "a recent row carries template, status and reason"; else fail "a recent row carries template, status and reason" "got $shape"; fi

finance_total=$(q "select (public.email_failure_overview('$FINANCE')::jsonb #>> '{last_24h,total}')")
if [ "$finance_total" = "3" ]; then pass "finance may read it too"; else fail "finance may read it too" "got $finance_total"; fi

# Eleven rows, so the limit has something to cut.
q "delete from public.email_failures" >/dev/null
for i in $(seq 1 11); do
  q "insert into public.email_failures (template, status, reason, created_at) values ('purchase_receipt', 500, 'provider_error', now() - interval '$i minutes')" >/dev/null
done
limited=$(q "select jsonb_array_length(public.email_failure_overview('$ADMIN')::jsonb -> 'recent')")
if [ "$limited" = "10" ]; then pass "recent is cut to ten"; else fail "recent is cut to ten" "got $limited"; fi

empty_reasons=$(q "select public.email_failure_overview('$ADMIN')::jsonb -> 'last_24h' -> 'by_reason'")
if [ "$empty_reasons" != "null" ]; then pass "by_reason is an object even when a reason has no rows"; else fail "by_reason is an object even when a reason has no rows" "got $empty_reasons"; fi

step "purge_old_email_failures"
q "delete from public.email_failures" >/dev/null
q "insert into public.email_failures (template, status, reason, created_at) values
     ('purchase_receipt', 500, 'provider_error', now() - interval '40 days'),
     ('purchase_receipt', 500, 'provider_error', now() - interval '31 days'),
     ('purchase_receipt', 500, 'provider_error', now() - interval '29 days'),
     ('purchase_receipt', 500, 'provider_error', now() - interval '1 hour')" >/dev/null

deleted=$(q "select public.purge_old_email_failures()")
left=$(q "select count(*) from public.email_failures")
if [ "$deleted" = "2" ] && [ "$left" = "2" ]; then
  pass "the default window keeps thirty days"
else
  fail "the default window keeps thirty days" "deleted $deleted, left $left"
fi

q "insert into public.email_failures (template, status, reason, created_at) values ('purchase_receipt', 500, 'provider_error', now() - interval '5 days')" >/dev/null
# 0 would mean "delete everything" if it were honoured. It is clamped to a day,
# so the five day old row and the twenty-nine day old one go and the hour old
# row stays.
clamped_days=$(q "select public.purge_old_email_failures(0)")
left=$(q "select count(*) from public.email_failures")
if [ "$clamped_days" = "2" ] && [ "$left" = "1" ]; then
  pass "a zero window is clamped to one day, not to everything"
else
  fail "a zero window is clamped to one day" "deleted $clamped_days, left $left"
fi

# A huge window is clamped to a year, so a row from an hour ago still survives.
big=$(q "select public.purge_old_email_failures(100000)")
left=$(q "select count(*) from public.email_failures")
if [ "$big" = "0" ] && [ "$left" = "1" ]; then
  pass "a huge window is clamped to a year, so a recent row survives"
else
  fail "a huge window is clamped to a year" "deleted $big, left $left"
fi

# And with an honest window the last row goes.
final=$(q "select public.purge_old_email_failures(30)")
left=$(q "select count(*) from public.email_failures")
if [ "$final" = "0" ] && [ "$left" = "1" ]; then
  pass "the last hour old row is inside the thirty day window"
else
  fail "the last hour old row is inside the thirty day window" "deleted $final, left $left"
fi

step "Anon cannot read the table"
as_anon=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role anon; select count(*) from public.email_failures\"" 2>&1)
if [[ "$as_anon" == *"permission denied"* ]]; then pass "anon is denied"; else fail "anon is denied" "$as_anon"; fi

as_anon_rpc=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role anon; select public.record_email_failure('x', 500, 'provider_error')\"" 2>&1)
if [[ "$as_anon_rpc" == *"permission denied"* ]]; then pass "anon cannot call record_email_failure"; else fail "anon cannot call record_email_failure" "$as_anon_rpc"; fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
