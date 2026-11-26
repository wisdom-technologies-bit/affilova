#!/usr/bin/env bash
# ============================================================================
# Email suppression harness (migration 20261127000100_email_suppressions)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies every migration in order, and checks the
# list that stops us writing to a mailbox:
#
#   1. the verify file, then the migration applied a second time
#   2. the upsert: one row per hash, first_seen kept, last_seen moved, events
#      incremented, and the first reason kept
#   3. the hash guard: an address passed by mistake is refused, not stored
#   4. the closed reason list
#   5. is_email_suppressed: true for a suppressed hash, false otherwise, false
#      for empty input rather than null
#   6. remove_email_suppression: admin only, a note required, an audit row
#      written with the note and without the hash in the clear
#   7. email_suppression_overview: admin or finance, counts by reason, the last
#      ten, and no address anywhere in the payload
#   8. privileges and row level security: no client role can read the table or
#      call a function; service_role can
#   9. the commented rollback, on a copy, then the migration re-applied
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/email_suppressions_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_email_suppressions_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_email_suppressions_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261127000100_email_suppressions.sql"
VERIFY="$ROOT/supabase/verify/20261127000100_email_suppressions_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

# SQL arrives on stdin so a statement may contain any quoting it likes.
q() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB}" 2>&1; }
qx() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d ${2:-$DB}" 2>&1; }
run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${SQL_DB:-$DB}" 2>&1; }

run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}

expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [${3:-<empty>}]"; fi; }

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

tmpfile() { mktemp /tmp/affilova_email_suppressions.XXXXXX.sql; }

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

# A 64 character hex hash. Real hashes are SHA-256 of the address with the
# pepper; the functions only care that the shape is right.
H1=$(printf 'a%.0s' $(seq 1 64))
H2=$(printf 'b%.0s' $(seq 1 64))
H3=$(printf 'c%.0s' $(seq 1 64))
H4=$(printf 'd%.0s' $(seq 1 64))
H5=$(printf 'e%.0s' $(seq 1 64))
H6=$(printf 'f%.0s' $(seq 1 64))

# ---------------------------------------------------------------------------
# 0. A fresh database with every migration applied
# ---------------------------------------------------------------------------
step "Building $DB from an empty database"
bootstrap "$DB" >/dev/null || { echo "bootstrap failed"; exit 1; }
apply_migrations "$DB" || exit 1

migration_count=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
count=$(q "select count(*) from public.app_migrations")
expect "$migration_count migrations applied" "$migration_count" "$count"

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
expect "one app_migrations row" "1" "$(q "select count(*) from public.app_migrations where version = '20261127000100'")"

# ---------------------------------------------------------------------------
# 1. The upsert
# ---------------------------------------------------------------------------
step "add_email_suppression"

expect "a first event returns 1" "1" \
  "$(q "select public.add_email_suppression('$H1', 'hard_bounce', 'brevo_webhook')")"
assert_value "one row, reason hard_bounce" "hard_bounce|brevo_webhook|1" <<SQL
select reason || '|' || source || '|' || events from public.email_suppressions where recipient_hash = '$H1'
SQL

sleep 0.01
expect "a second event returns 2" "2" \
  "$(q "select public.add_email_suppression('$H1', 'complaint', 'brevo_webhook')")"
assert_value "still one row, first reason kept, events 2" "hard_bounce|2" <<SQL
select reason || '|' || events from public.email_suppressions where recipient_hash = '$H1'
SQL

assert_value "last_seen moved forward and first_seen did not" "t" <<SQL
select (last_seen > first_seen) from public.email_suppressions where recipient_hash = '$H1'
SQL

expect "an upper-case hash is accepted and lower-cased" "3" \
  "$(q "select public.add_email_suppression(upper('$H1'), 'blocked', 'manual')")"
assert_value "the upper-case call landed on the same row" "1" <<SQL
select count(*) from public.email_suppressions where recipient_hash = '$H1'
SQL

assert_value "the source is kept from the first event that had one" "brevo_webhook" <<SQL
select source from public.email_suppressions where recipient_hash = '$H1'
SQL

step "The hash guard"
assert_error "an address passed by mistake is refused" "64-character hex" <<SQL
select public.add_email_suppression('buyer@example.com', 'hard_bounce', 'manual')
SQL
assert_value "and nothing was stored" "1" <<SQL
select count(*) from public.email_suppressions
SQL

assert_error "an unknown reason is refused by the check constraint" "email_suppressions_reason_check" <<SQL
select public.add_email_suppression('$H2', 'annoyed', 'manual')
SQL
assert_value "and nothing was stored" "1" <<SQL
select count(*) from public.email_suppressions
SQL

step "is_email_suppressed"
assert_value "true for a suppressed hash" "t" <<SQL
select public.is_email_suppressed('$H1')
SQL
assert_value "false for an unknown hash" "f" <<SQL
select public.is_email_suppressed('$H2')
SQL
assert_value "false, not null, for empty input" "f" <<SQL
select public.is_email_suppressed('')
SQL
assert_value "false, not null, for null input" "f" <<SQL
select public.is_email_suppressed(null)
SQL

# ---------------------------------------------------------------------------
# 2. The roles
# ---------------------------------------------------------------------------
step "Seeding staff"
ADMIN=$(q "insert into auth.users (email) values ('admin@example.com') returning id" | head -1)
FINANCE=$(q "insert into auth.users (email) values ('finance@example.com') returning id" | head -1)
SUPPORT=$(q "insert into auth.users (email) values ('support@example.com') returning id" | head -1)
BUYER=$(q "insert into auth.users (email) values ('buyer@example.com') returning id" | head -1)
for pair in "$ADMIN:admin" "$FINANCE:finance" "$SUPPORT:support" "$BUYER:customer"; do
  uid="${pair%%:*}"; role="${pair##*:}"
  q "insert into public.profiles (id, email) values ('$uid', '${role}@example.com') on conflict (id) do nothing" >/dev/null
  q "insert into public.user_roles (user_id, role, status) values ('$uid', '$role', 'active') on conflict do nothing" >/dev/null
done
# Earlier migrations seed their own staff, so this asks about these four users
# rather than about the table as a whole.
assert_value "the four users hold the roles this harness needs" "1|1|1|1" <<SQL
select (select count(*) from public.user_roles where user_id = '$ADMIN' and role = 'admin' and status = 'active') || '|' ||
       (select count(*) from public.user_roles where user_id = '$FINANCE' and role = 'finance' and status = 'active') || '|' ||
       (select count(*) from public.user_roles where user_id = '$SUPPORT' and role = 'support' and status = 'active') || '|' ||
       (select count(*) from public.user_roles where user_id = '$BUYER' and role = 'customer' and status = 'active')
SQL

step "remove_email_suppression"
assert_error "support cannot remove an entry" "forbidden" <<SQL
select public.remove_email_suppression('$SUPPORT', '$H1', 'full mailbox, retry next month')
SQL
assert_error "a customer cannot remove an entry" "forbidden" <<SQL
select public.remove_email_suppression('$BUYER', '$H1', 'let me back in')
SQL
assert_error "an admin must give a note" "at least 3 characters" <<SQL
select public.remove_email_suppression('$ADMIN', '$H1', '')
SQL
assert_value "the entry is still there after the refusals" "1" <<SQL
select count(*) from public.email_suppressions where recipient_hash = '$H1'
SQL

# jsonb sorts its keys, so the payload is compared as it comes back.
expect "an admin removes it, and the reason comes back" '{"reason": "hard_bounce", "removed": true}' \
  "$(q "select public.remove_email_suppression('$ADMIN', '$H1', 'the mailbox was full, the buyer asked again')")"
assert_value "the row is gone" "0" <<SQL
select count(*) from public.email_suppressions where recipient_hash = '$H1'
SQL

assert_value "an audit row names the admin, the action and the note" "email_suppression.removed|email_suppression|$ADMIN|true" <<SQL
select action || '|' || entity_type || '|' || actor_id || '|' || (after ? 'note')
  from public.audit_log where action = 'email_suppression.removed' order by id desc limit 1
SQL

assert_value "the audit row carries the note, not the hash of an address" "the mailbox was full, the buyer asked again" <<SQL
select after ->> 'note' from public.audit_log where action = 'email_suppression.removed' order by id desc limit 1
SQL

expect "removing an entry that is not there answers removed:false" '{"removed": false}' \
  "$(q "select public.remove_email_suppression('$ADMIN', '$H1', 'nothing to remove')")"

# ---------------------------------------------------------------------------
# 3. The overview
# ---------------------------------------------------------------------------
step "email_suppression_overview"
for row in "$H2:hard_bounce" "$H3:hard_bounce" "$H4:complaint" "$H5:invalid" "$H6:unsubscribed"; do
  h="${row%%:*}"; r="${row##*:}"
  q "select public.add_email_suppression('$h', '$r', 'brevo_webhook')" >/dev/null
done
q "select public.add_email_suppression('$H3', 'hard_bounce', 'brevo_webhook')" >/dev/null

assert_value "admin sees the total" "5" <<SQL
select (public.email_suppression_overview('$ADMIN') ->> 'total')
SQL
assert_value "counts by reason" '{"invalid": 1, "complaint": 1, "hard_bounce": 2, "unsubscribed": 1}' <<SQL
select (public.email_suppression_overview('$ADMIN') -> 'by_reason')::text
SQL
assert_value "finance sees the same" "5" <<SQL
select (public.email_suppression_overview('$FINANCE') ->> 'total')
SQL
assert_value "the recent list is capped at ten" "5" <<SQL
select jsonb_array_length(public.email_suppression_overview('$ADMIN') -> 'recent')
SQL
assert_value "the recent list has no address in it" "0" <<SQL
select count(*) from jsonb_path_query(
  public.email_suppression_overview('$ADMIN'), '$.**') as v
where v::text like '%@%'
SQL
assert_error "support cannot read the overview" "forbidden" <<SQL
select public.email_suppression_overview('$SUPPORT')
SQL
assert_error "a customer cannot read the overview" "forbidden" <<SQL
select public.email_suppression_overview('$BUYER')
SQL

# More than ten entries, so the cap is proved rather than assumed.
for i in $(seq 1 12); do
  h=$(printf '%064d' "$i" | tr '0-9' '0-9' | cut -c1-64)
  q "select public.add_email_suppression('$h', 'blocked', 'manual')" >/dev/null
done
assert_value "the recent list stops at ten of seventeen" "10" <<SQL
select jsonb_array_length(public.email_suppression_overview('$ADMIN') -> 'recent')
SQL
assert_value "the total counts all of them" "17" <<SQL
select (public.email_suppression_overview('$ADMIN') ->> 'total')
SQL

# ---------------------------------------------------------------------------
# 4. Privileges and row level security
# ---------------------------------------------------------------------------
step "Privileges"
for role in anon authenticated; do
  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role $role; select count(*) from public.email_suppressions\"" 2>&1)
  if printf '%s' "$out" | grep -q 'permission denied'; then pass "$role cannot read the table"; else fail "$role cannot read the table" "$out"; fi

  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role $role; select public.is_email_suppressed('$H2')\"" 2>&1)
  if printf '%s' "$out" | grep -q 'permission denied'; then pass "$role cannot call is_email_suppressed"; else fail "$role cannot call is_email_suppressed" "$out"; fi

  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role $role; select public.add_email_suppression('$H1', 'blocked', 'x')\"" 2>&1)
  if printf '%s' "$out" | grep -q 'permission denied'; then pass "$role cannot call add_email_suppression"; else fail "$role cannot call add_email_suppression" "$out"; fi
done

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role service_role; select public.is_email_suppressed('$H2')\"" 2>&1)
expect "service_role can call is_email_suppressed" "t" "$out"

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role service_role; select count(*) from public.email_suppressions\"" 2>&1)
expect "service_role can read the table" "17" "$out"

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role service_role; select public.add_email_suppression('$(printf '9%.0s' $(seq 1 64))', 'blocked', 'manual')\"" 2>&1)
expect "service_role can write through the function" "1" "$out"

step "Row level security"
assert_value "RLS is on" "t" <<SQL
select relrowsecurity from pg_class where oid = 'public.email_suppressions'::regclass
SQL
assert_value "and there is no policy that could grant a row" "0" <<SQL
select count(*) from pg_policies where schemaname = 'public' and tablename = 'email_suppressions'
SQL

# ---------------------------------------------------------------------------
# 5. The rollback
# ---------------------------------------------------------------------------
step "The commented rollback, on a copy"
bootstrap "$ROLLBACK_DB" >/dev/null || { echo "rollback bootstrap failed"; exit 1; }
apply_migrations "$ROLLBACK_DB" || exit 1

# The rollback block is taken from the migration itself, uncommented, so the
# comment and the code cannot drift apart.
RB=$(tmpfile)
sed -n '/^-- ROLLBACK/,/^-- ====/p' "$MIGRATION" \
  | sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' \
  | sed 's/^-- \{0,1\}//' > "$RB"
if [ -s "$RB" ] && run_file "$RB" "$ROLLBACK_DB" >/dev/null 2>&1; then
  pass "the rollback runs"
else
  fail "the rollback runs" "$(head -5 "$RB" | tr '\n' ' ')"
fi
# to_regclass answers null for a table that is not there; a ::regclass cast
# would raise instead, and the harness would read that as a pass.
expect "the table is gone" "t" \
  "$(q "select to_regclass('public.email_suppressions') is null" "$ROLLBACK_DB")"
expect "the functions are gone" "0" \
  "$(q "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('add_email_suppression','is_email_suppressed','remove_email_suppression','email_suppression_overview')" "$ROLLBACK_DB")"
expect "the app_migrations row is gone" "0" \
  "$(q "select count(*) from public.app_migrations where version = '20261127000100'" "$ROLLBACK_DB")"

if run_file "$MIGRATION" "$ROLLBACK_DB" >/dev/null 2>&1; then pass "and it applies again after the rollback"; else fail "and it applies again after the rollback"; fi
expect "the app_migrations row is back" "1" \
  "$(q "select count(*) from public.app_migrations where version = '20261127000100'" "$ROLLBACK_DB")"
expect "the table is back" "email_suppressions" \
  "$(q "select to_regclass('public.email_suppressions')::text" "$ROLLBACK_DB")"
rm -f "$RB"

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
