#!/usr/bin/env bash
# ============================================================================
# Admin users function harness (migration 20261125000200_admin_users)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies all migrations in order, and tests:
#   1. the verify file
#   2. running the migration twice on the same database
#   3. admin_list_users: everyone, search, role and status filters, paging, the
#      100 row ceiling and total_count
#   4. admin_get_user: roles including revoked ones
#   5. granting: staff roles only, an active admin actor only, idempotent, and a
#      revoked role coming back rather than a second row
#   6. revoking: the last active admin is refused, and so is suspending them
#   7. status and verification changes, with no audit row for a no-op
#   8. audit rows that carry no email address
#   9. anon and authenticated cannot execute any of it
#
# Usage:  supabase/tests/admin_users_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_admin_users_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_admin_users_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261125000200_admin_users.sql"
VERIFY="$ROOT/supabase/verify/20261125000200_admin_users_verify.sql"

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

# Runs a statement that is expected to raise, and passes when it does.
expect_error() {
  local sql="$1" label="$2" out
  out=$(q "$sql")
  if printf '%s' "$out" | grep -q "ERROR"; then
    pass "$label"
  else
    fail "$label" "$out"
  fi
}

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label" "expected [$expected] got [$actual]"
  fi
}

ADMIN1="11111111-1111-1111-1111-111111111111"
ADMIN2="22222222-2222-2222-2222-222222222222"
FIN="33333333-3333-3333-3333-333333333333"
VEND="44444444-4444-4444-4444-444444444444"
CUST="55555555-5555-5555-5555-555555555555"
NOROLE="66666666-6666-6666-6666-666666666666"

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
expected=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
check "$expected migrations applied" "$expected" "$count"

step "Verify file"

run_file "$VERIFY" > /tmp/admin_users_verify.out 2>&1
bad=$(grep -c "| f" /tmp/admin_users_verify.out || true)
if [ "$bad" = "0" ] && ! grep -q "ERROR" /tmp/admin_users_verify.out; then
  pass "every verify row is true"
else
  fail "every verify row is true" "$(grep '| f' /tmp/admin_users_verify.out | head -3)"
fi

step "Running the migration a second time"

if run_file "$MIGRATION" > /tmp/admin_users_rerun.out 2>&1; then
  pass "the migration is idempotent"
else
  fail "the migration is idempotent" "$(head -3 /tmp/admin_users_rerun.out)"
fi

step "Seeding five people"

cat > /tmp/admin_users_seed.sql <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('$ADMIN1', 'ada@example.com',    '{"first_name":"Ada","last_name":"Obi"}'::jsonb),
  ('$ADMIN2', 'bola@example.com',   '{"first_name":"Bola","last_name":"Eze"}'::jsonb),
  ('$FIN',    'chi@example.com',    '{"first_name":"Chi","last_name":"Nwosu"}'::jsonb),
  ('$VEND',   'dave@example.com',   '{"first_name":"Dave","last_name":"Ike"}'::jsonb),
  ('$CUST',   'eve@example.com',    '{"first_name":"Eve","last_name":"Bello"}'::jsonb),
  ('$NOROLE', 'femi@example.com',   '{"first_name":"Femi","last_name":"Ade"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, first_name, last_name)
SELECT u.id, u.email::extensions.citext,
       u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name'
FROM auth.users u
WHERE u.id IN ('$ADMIN1','$ADMIN2','$FIN','$VEND','$CUST','$NOROLE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, status) VALUES
  ('$ADMIN1', 'admin', 'active'),
  ('$ADMIN2', 'admin', 'active'),
  ('$FIN',    'finance', 'active'),
  ('$VEND',   'vendor', 'active'),
  ('$CUST',   'customer', 'active')
ON CONFLICT (user_id, role) DO NOTHING;
SQL

if run_file /tmp/admin_users_seed.sql > /tmp/admin_users_seed.out 2>&1; then
  pass "six people seeded"
  # The signup trigger grants customer to everyone. Femi keeps no roles at all,
  # so the empty case is a real one rather than an accident of the trigger.
  q "delete from public.user_roles where user_id = '$NOROLE'" >/dev/null
else
  fail "six people seeded" "$(head -3 /tmp/admin_users_seed.out)"
fi

step "admin_list_users"

check "lists everyone" "6" "$(q "select count(*) from public.admin_list_users()")"
check "total_count is the unpaged total" "6" "$(q "select distinct total_count from public.admin_list_users(p_limit => 2)")"
check "paging returns the page size, not the total" "2" "$(q "select count(*) from (select 1 from public.admin_list_users(p_limit => 2, p_offset => 0)) s")"
check "the second page starts after the first" "2" "$(q "select count(*) from (select 1 from public.admin_list_users(p_limit => 2, p_offset => 2)) s")"
check "a role filter keeps only that role" "2" "$(q "select count(*) from public.admin_list_users(p_role => 'admin')")"
check "a role filter for a role nobody holds is empty" "0" "$(q "select count(*) from public.admin_list_users(p_role => 'support')")"
check "a search matches an email" "1" "$(q "select count(*) from public.admin_list_users(p_search => 'dave@')")"
check "a search matches a first name without case" "1" "$(q "select count(*) from public.admin_list_users(p_search => 'ADA')")"
check "a search that matches nothing is empty" "0" "$(q "select count(*) from public.admin_list_users(p_search => 'zzzz')")"
check "a blank search returns everyone" "6" "$(q "select count(*) from public.admin_list_users(p_search => '   ')")"
check "roles come back as an array of names" "{admin,customer}" "$(q "select roles from public.admin_list_users(p_search => 'ada@')")"
check "a person with no roles comes back with an empty array" "{}" "$(q "select roles from public.admin_list_users(p_search => 'femi@')")"
check "display_name falls back to first and last name" "Ada Obi" "$(q "select display_name from public.admin_list_users(p_search => 'ada@')")"

q "update public.profiles set status = 'suspended' where id = '$CUST'" >/dev/null
check "a status filter keeps only that status" "1" "$(q "select count(*) from public.admin_list_users(p_status => 'suspended')")"
q "update public.profiles set status = 'active' where id = '$CUST'" >/dev/null

step "admin_get_user"

check "answers null for an unknown id" "" "$(q "select public.admin_get_user('99999999-9999-9999-9999-999999999999')")"
check "answers the person" "ada@example.com" "$(q "select public.admin_get_user('$ADMIN1') ->> 'email'")"
check "includes every role a person holds" "2" "$(q "select jsonb_array_length(public.admin_get_user('$ADMIN1') -> 'roles')")"
check "a person with no roles has an empty list" "0" "$(q "select jsonb_array_length(public.admin_get_user('$NOROLE') -> 'roles')")"

step "Who may change staff access"

expect_error "select public.admin_grant_staff_role('$NOROLE', 'support', '$VEND')" "a vendor cannot grant a role"
expect_error "select public.admin_grant_staff_role('$NOROLE', 'support', null)" "a null actor is refused"
expect_error "select public.admin_grant_staff_role('$NOROLE', 'customer', '$ADMIN1')" "customer cannot be granted as a staff role"
expect_error "select public.admin_grant_staff_role('$NOROLE', 'affiliate', '$ADMIN1')" "affiliate cannot be granted as a staff role"
expect_error "select public.admin_grant_staff_role('$NOROLE', 'vendor', '$ADMIN1')" "vendor cannot be granted as a staff role"
expect_error "select public.admin_grant_staff_role('99999999-9999-9999-9999-999999999999', 'support', '$ADMIN1')" "an unknown person cannot be granted a role"

step "Granting a staff role"

q "select public.admin_grant_staff_role('$NOROLE', 'support', '$ADMIN1')" >/dev/null
check "the role is active" "active" "$(q "select status from public.user_roles where user_id = '$NOROLE' and role = 'support'")"
check "one audit row is written" "1" "$(q "select count(*) from public.audit_log where action = 'staff_role.granted' and entity_id = '$NOROLE:support'")"
check "the audit row records the actor" "$ADMIN1" "$(q "select actor_id from public.audit_log where action = 'staff_role.granted' and entity_id = '$NOROLE:support'")"

q "select public.admin_grant_staff_role('$NOROLE', 'support', '$ADMIN2')" >/dev/null
check "granting twice writes no second audit row" "1" "$(q "select count(*) from public.audit_log where action = 'staff_role.granted' and entity_id = '$NOROLE:support'")"
check "granting twice leaves one role row" "1" "$(q "select count(*) from public.user_roles where user_id = '$NOROLE' and role = 'support'")"

step "Revoking and re-granting"

q "select public.admin_revoke_staff_role('$NOROLE', 'support', '$ADMIN1')" >/dev/null
check "the role is revoked, not deleted" "revoked" "$(q "select status from public.user_roles where user_id = '$NOROLE' and role = 'support'")"
check "a revocation is audited" "1" "$(q "select count(*) from public.audit_log where action = 'staff_role.revoked' and entity_id = '$NOROLE:support'")"

q "select public.admin_revoke_staff_role('$NOROLE', 'support', '$ADMIN1')" >/dev/null
check "revoking twice writes no second audit row" "1" "$(q "select count(*) from public.audit_log where action = 'staff_role.revoked' and entity_id = '$NOROLE:support'")"

q "select public.admin_grant_staff_role('$NOROLE', 'support', '$ADMIN1')" >/dev/null
check "re-granting reactivates the same row" "1" "$(q "select count(*) from public.user_roles where user_id = '$NOROLE' and role = 'support'")"
check "re-granting is active again" "active" "$(q "select status from public.user_roles where user_id = '$NOROLE' and role = 'support'")"
expect_error "select public.admin_revoke_staff_role('$NOROLE', 'vendor', '$ADMIN1')" "a non-staff role cannot be revoked here"

step "The last active admin"

q "select public.admin_revoke_staff_role('$ADMIN2', 'admin', '$ADMIN1')" >/dev/null
check "with a second admin, one admin role can go" "revoked" "$(q "select status from public.user_roles where user_id = '$ADMIN2' and role = 'admin'")"

expect_error "select public.admin_revoke_staff_role('$ADMIN1', 'admin', '$ADMIN1')" "the last active admin cannot be revoked"
check "the last admin still holds the role" "active" "$(q "select status from public.user_roles where user_id = '$ADMIN1' and role = 'admin'")"

expect_error "select public.admin_set_user_status('$ADMIN1', 'suspended', '$ADMIN1')" "the last active admin cannot be suspended"
check "the last admin is still active" "active" "$(q "select status from public.profiles where id = '$ADMIN1'")"

q "select public.admin_grant_staff_role('$ADMIN2', 'admin', '$ADMIN1')" >/dev/null
q "select public.admin_set_user_status('$ADMIN2', 'suspended', '$ADMIN1')" >/dev/null
expect_error "select public.admin_revoke_staff_role('$ADMIN1', 'admin', '$ADMIN1')" "a suspended admin does not count as a second admin"
q "select public.admin_set_user_status('$ADMIN2', 'active', '$ADMIN1')" >/dev/null

step "Status changes"

q "select public.admin_set_user_status('$CUST', 'suspended', '$ADMIN1')" >/dev/null
check "the new status is stored" "suspended" "$(q "select status from public.profiles where id = '$CUST'")"
check "a status change is audited" "1" "$(q "select count(*) from public.audit_log where action = 'user.status_changed' and entity_id = '$CUST'")"
q "select public.admin_set_user_status('$CUST', 'suspended', '$ADMIN1')" >/dev/null
check "setting the same status again writes no audit row" "1" "$(q "select count(*) from public.audit_log where action = 'user.status_changed' and entity_id = '$CUST'")"
expect_error "select public.admin_set_user_status('99999999-9999-9999-9999-999999999999', 'suspended', '$ADMIN1')" "an unknown person cannot be suspended"
q "select public.admin_set_user_status('$CUST', 'active', '$ADMIN1')" >/dev/null
check "a second, different status is audited too" "2" "$(q "select count(*) from public.audit_log where action = 'user.status_changed' and entity_id = '$CUST'")"

step "Verification levels"

q "select public.admin_set_verification_level('$VEND', 'verified', '$ADMIN1')" >/dev/null
check "the level is stored" "verified" "$(q "select verification_level from public.profiles where id = '$VEND'")"
check "the change is audited" "1" "$(q "select count(*) from public.audit_log where action = 'user.verification_changed' and entity_id = '$VEND'")"
q "select public.admin_set_verification_level('$VEND', 'verified', '$ADMIN1')" >/dev/null
check "setting the same level writes no audit row" "1" "$(q "select count(*) from public.audit_log where action = 'user.verification_changed' and entity_id = '$VEND'")"
q "select public.admin_set_verification_level('$VEND', 'pro', '$ADMIN1')" >/dev/null
check "the level can be raised" "pro" "$(q "select verification_level from public.profiles where id = '$VEND'")"

step "The audit log holds no personal data"

check "no audit row mentions an email address" "0" "$(q "select count(*) from public.audit_log where before::text ilike '%@%' or after::text ilike '%@%' or entity_id ilike '%@%'")"
check "no audit payload carries a personal key" "0" "$(q "select count(*) from public.audit_log where coalesce(before, '{}'::jsonb) ?| array['email','display_name','first_name','last_name','full_name','phone'] or coalesce(after, '{}'::jsonb) ?| array['email','display_name','first_name','last_name','full_name','phone']")"

step "The page ceiling"

cat > /tmp/admin_users_bulk.sql <<SQL
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT gen_random_uuid(), 'bulk' || g || '@example.com',
       jsonb_build_object('first_name', 'Bulk', 'last_name', g::text)
FROM generate_series(1, 120) g;

INSERT INTO public.profiles (id, email, first_name, last_name)
SELECT u.id, u.email::extensions.citext, 'Bulk', u.raw_user_meta_data ->> 'last_name'
FROM auth.users u
WHERE u.email LIKE 'bulk%'
ON CONFLICT (id) DO NOTHING;
SQL

run_file /tmp/admin_users_bulk.sql >/dev/null 2>&1
check "126 people exist" "126" "$(q "select count(*) from public.profiles")"
check "a huge limit is clamped to 100 rows" "100" "$(q "select count(*) from (select 1 from public.admin_list_users(p_limit => 5000)) s")"
check "total_count still reports all 126" "126" "$(q "select distinct total_count from public.admin_list_users(p_limit => 10)")"
check "a limit below one becomes one" "1" "$(q "select count(*) from (select 1 from public.admin_list_users(p_limit => 0)) s")"

step "Privileges"

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB -c 'set role anon; select count(*) from public.admin_list_users()'" 2>&1)
if printf '%s' "$out" | grep -q "permission denied"; then pass "anon cannot list users"; else fail "anon cannot list users" "$out"; fi

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB -c 'set role authenticated; select public.admin_grant_staff_role('\"'\"'$NOROLE'\"'\"', '\"'\"'admin'\"'\"', '\"'\"'$ADMIN1'\"'\"')'" 2>&1)
if printf '%s' "$out" | grep -q "permission denied"; then pass "authenticated cannot grant a role"; else fail "authenticated cannot grant a role" "$out"; fi

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB -c 'set role service_role; select count(*) from public.admin_list_users()'" 2>&1)
if [ "$out" = "25" ]; then pass "service_role can list users, one page at a time"; else fail "service_role can list users" "$out"; fi

step "The commented rollback removes everything"

ROLLBACK=$(sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' "$MIGRATION" | sed 's/^-- \{0,1\}//')
if printf '%s\n' "$ROLLBACK" | run_file /dev/stdin > /tmp/admin_users_rollback.out 2>&1; then
  pass "the rollback block runs"
  check "the functions are gone" "" "$(q "select to_regprocedure('public.admin_list_users(text, public.account_status, public.app_role, integer, integer)')")"
  check "the migration row is gone" "0" "$(q "select count(*) from public.app_migrations where version = '20261125000200'")"
  check "the people are still there" "126" "$(q "select count(*) from public.profiles")"
  check "the audit trail is still there" "3" "$(q "select count(*) from public.audit_log where action = 'staff_role.granted'")"
else
  fail "the rollback block runs" "$(head -3 /tmp/admin_users_rollback.out)"
fi

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
