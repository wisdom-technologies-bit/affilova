#!/usr/bin/env bash
# ============================================================================
# Account and vendor read models harness (migration 20261121000200_account_vendor_read_models)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_account_vendor_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261121000200_account_vendor_read_models.sql"
VERIFY="$ROOT/supabase/verify/20261121000200_account_vendor_read_models_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" 2>&1; }

step "Building $DB for account & vendor read models test"
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
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$BOOT"
rm "$BOOT"

step "Applying earlier migrations"
for m in "$ROOT"/supabase/migrations/*.sql; do
  if [[ "$m" < "$ROOT/supabase/migrations/20261121000200_account_vendor_read_models.sql" ]]; then
    su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$m"
  fi
done

step "Applying target migration"
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$MIGRATION"
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$MIGRATION" -- idempotent test

step "Running verification file"
VERIFY_OUT=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY")
if echo "$VERIFY_OUT" | grep -q "false"; then
  fail "Verification checks failed" "$VERIFY_OUT"
else
  pass "All verification checks passed"
fi

echo ""
echo "Tests summary: $PASSED passed, $FAILED failed."
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
