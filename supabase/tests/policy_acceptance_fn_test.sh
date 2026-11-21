#!/usr/bin/env bash
# ============================================================================
# Policy acceptance function harness (migration 20261121000100_policy_acceptance_fn)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies all migrations in order, and tests:
#   1. the verify file
#   2. running the migration twice on the same database
#   3. idempotent inserts into policy_acceptances + single 'policy.accepted' audit row
#   4. multiple policies/versions for the same user
#   5. service_role-only execution (anon and authenticated denied)
#   6. commented rollback block removes the function and app_migrations row
#
# Usage:  supabase/tests/policy_acceptance_fn_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_policy_acceptance_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_policy_acceptance_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261121000100_policy_acceptance_fn.sql"
VERIFY="$ROOT/supabase/verify/20261121000100_policy_acceptance_fn_verify.sql"

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
expected=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
if [ "$count" = "$expected" ]; then pass "$expected migrations applied"; else fail "$expected migrations applied" "got $count"; fi

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "policy_acceptance_fn verify ($total checks)"
else
  fail "policy_acceptance_fn verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261121000100'")
if [ "$again" = "1" ]; then pass "recorded once"; else fail "recorded once" "got $again"; fi

step "Idempotent recording and audit log"
USER_ID="11111111-1111-4111-8111-111111111111"
IP_HASH="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

seed=$(q "insert into auth.users (id, email) values ('$USER_ID', 'vendor@example.com') returning id" | head -1)
if [ "$seed" = "$USER_ID" ]; then pass "test user seeded"; else fail "test user seeded" "$seed"; fi

first_call=$(q "set role service_role; select public.record_policy_acceptance('$USER_ID', 'vendor_agreement', 'draft-2026-11-21', '$IP_HASH')")
if [[ "$first_call" != *ERROR* ]]; then pass "first acceptance call succeeded"; else fail "first acceptance call succeeded" "$first_call"; fi

second_call=$(q "set role service_role; select public.record_policy_acceptance('$USER_ID', 'vendor_agreement', 'draft-2026-11-21', '$IP_HASH')")
if [[ "$second_call" != *ERROR* ]]; then pass "duplicate acceptance call succeeded"; else fail "duplicate acceptance call succeeded" "$second_call"; fi

row_count=$(q "select count(*) from public.policy_acceptances where user_id = '$USER_ID' and policy = 'vendor_agreement' and version = 'draft-2026-11-21'")
audit_count=$(q "select count(*) from public.audit_log where actor_id = '$USER_ID' and action = 'policy.accepted' and after->>'policy' = 'vendor_agreement'")
if [ "$row_count" = "1" ] && [ "$audit_count" = "1" ]; then
  pass "idempotent insert creates one acceptance row and one policy.accepted audit row"
else
  fail "idempotent insert creates one acceptance row and one policy.accepted audit row" "rows=$row_count audit=$audit_count"
fi

third_call=$(q "set role service_role; select public.record_policy_acceptance('$USER_ID', 'terms_of_service', 'draft-2026-11-21', null)")
if [[ "$third_call" != *ERROR* ]]; then pass "distinct policy recorded with null ip_hash"; else fail "distinct policy recorded with null ip_hash" "$third_call"; fi

total_rows=$(q "select count(*) from public.policy_acceptances where user_id = '$USER_ID'")
total_audits=$(q "select count(*) from public.audit_log where actor_id = '$USER_ID' and action = 'policy.accepted'")
if [ "$total_rows" = "2" ] && [ "$total_audits" = "2" ]; then
  pass "distinct policies record separate rows and audit entries"
else
  fail "distinct policies record separate rows and audit entries" "rows=$total_rows audits=$total_audits"
fi

step "Role access restrictions"
as_anon=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role anon; select public.record_policy_acceptance('$USER_ID', 'privacy_policy', 'draft-2026-11-21', null)\"" 2>&1)
if [[ "$as_anon" == *"permission denied"* ]]; then pass "anon cannot execute"; else fail "anon cannot execute" "$as_anon"; fi

as_auth=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB -c \"set role authenticated; select public.record_policy_acceptance('$USER_ID', 'privacy_policy', 'draft-2026-11-21', null)\"" 2>&1)
if [[ "$as_auth" == *"permission denied"* ]]; then pass "authenticated cannot execute"; else fail "authenticated cannot execute" "$as_auth"; fi

step "Commented rollback block"
ROLLBACK_SQL=$(mktemp /tmp/affilova_rollback.XXXXXX.sql)
awk '/^-- ROLLBACK/,0' "$MIGRATION" | sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' | sed 's/^-- //' | sed 's/^--$//' > "$ROLLBACK_SQL"
if run_file "$ROLLBACK_SQL" >/dev/null 2>&1; then pass "rollback block executed"; else fail "rollback block executed"; fi
rm -f "$ROLLBACK_SQL"

fn_exists=$(q "select to_regprocedure('public.record_policy_acceptance(uuid, text, text, text)') is not null")
mig_exists=$(q "select count(*) from public.app_migrations where version = '20261121000100'")
if [ "$fn_exists" = "f" ] && [ "$mig_exists" = "0" ]; then
  pass "rollback dropped function and migration row"
else
  fail "rollback dropped function and migration row" "fn=$fn_exists mig=$mig_exists"
fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
