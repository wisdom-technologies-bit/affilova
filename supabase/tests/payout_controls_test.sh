#!/usr/bin/env bash
# ============================================================================
# Payout controls harness (migration 20261123000100_payout_controls)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies every migration in order, and tests:
#   1. the verify file and running the migration twice
#   2. create_step_up_code: cooldown, hourly cap, invalidation, expiry bounds
#   3. verify_step_up_code: newest code only, single use, five wrong guesses,
#      expiry, another user cannot verify, purposes do not mix
#   4. update_setting: roles, whitelist, types, ranges, pairs, history, audit
#   5. list_blackout_dates, get_payout_screen_data and admin_withdrawal_queue
#   6. privileges, row level security
#   7. the commented rollback block, then re-applying the migration
#
# Usage:  supabase/tests/payout_controls_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_payout_controls_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_payout_controls_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261123000100_payout_controls.sql"
VERIFY="$ROOT/supabase/verify/20261123000100_payout_controls_verify.sql"

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

# SQL arrives on stdin so a statement may contain any quoting it likes.
q() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" 2>&1; }
# Same, but a SQL error is the expected outcome.
qx() { printf '%s\n' "$1" | su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB" 2>&1; }

run_file() {
  local f="$1"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $DB" < "$f"
}

expect() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2] got [$3]"; fi
}

contains() { # name needle haystack
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1" "expected to contain [$2], got [$3]" ;;
  esac
}

set_clock() { # ISO timestamp
  q "INSERT INTO public.settings (key, value) VALUES ('payout_clock_override_iso', to_jsonb('$1'::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;" >/dev/null
}

# A user with one vendor_payable credit, available since yesterday.
seed_user() { # id email kobo age_days
  q "INSERT INTO auth.users (id, email) VALUES ('$1', '$2');
     UPDATE public.profiles SET created_at = now() - interval '$4 days' WHERE id = '$1';
     BEGIN;
     INSERT INTO public.ledger_transactions (kind, idempotency_key) VALUES ('seed', 'seed:$1');
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
       SELECT id, 1, NULL, $3, 0 FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
       SELECT id, 3, '$1', 0, $3, '2026-11-16 00:00:00+00'::timestamptz
         FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     COMMIT;" >/dev/null
}

# A user whose balance is split across vendor_payable and affiliate_payable.
seed_split_user() { # id email vendor_kobo affiliate_kobo
  q "INSERT INTO auth.users (id, email) VALUES ('$1', '$2');
     UPDATE public.profiles SET created_at = now() - interval '30 days' WHERE id = '$1';
     BEGIN;
     INSERT INTO public.ledger_transactions (kind, idempotency_key) VALUES ('seed', 'seed:$1');
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
       SELECT id, 1, NULL, $3::bigint + $4::bigint, 0
         FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
       SELECT id, 3, '$1', 0, $3, '2026-11-16 00:00:00+00'::timestamptz
         FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
       SELECT id, 4, '$1', 0, $4, '2026-11-16 00:00:00+00'::timestamptz
         FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     COMMIT;" >/dev/null
}

account() { # user id -> uuid
  q "SELECT public.set_payout_account('$1', '058', 'GTBank', '1234', 'ADAEZE OKONKWO', 'RCP_$1', true);"
}

# ============================================================================
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

count=$(q "SELECT count(*) FROM public.app_migrations")
expected=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
expect "$expected migrations applied" "$expected" "$count"

step "Verify file"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "payout controls verify ($total checks)"
else
  fail "payout controls verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi


step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261123000100'")
expect "recorded once" "1" "$again"

# ============================================================================
step "Seed"
U1=11111111-1111-4111-8111-111111111111
U2=22222222-2222-4222-8222-222222222222
ADMIN=33333333-3333-4333-8333-333333333333
FIN=44444444-4444-4444-8444-444444444444
PLAIN=55555555-5555-4555-8555-555555555555

seed_user "$U1" u1@example.com 10000000 30
seed_user "$U2" u2@example.com 0 30
seed_user "$ADMIN" admin@example.com 0 30
seed_user "$FIN" fin@example.com 0 30
seed_user "$PLAIN" plain@example.com 0 30
q "INSERT INTO public.user_roles (user_id, role) VALUES ('$ADMIN', 'admin'), ('$FIN', 'finance')
   ON CONFLICT DO NOTHING;" >/dev/null

HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HASH_C="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

set_clock "2026-11-23T10:00:00+01:00"   # Monday 10:00 Lagos
clock=$(q "SELECT to_char(public.payout_now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI')")
expect "the injected clock is Monday 10:00 Lagos" "2026-11-23 10:00" "$clock"

# ============================================================================
step "create_step_up_code: cooldown, hourly cap, invalidation"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_A', 600)")
contains "the first code is issued" '"ok": true' "$r"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_B', 600)")
contains "a second code inside 60 seconds is refused" '"ok": false' "$r"
contains "the retry delay is 60 seconds at the same instant" '"retry_after_seconds": 60' "$r"

set_clock "2026-11-23T10:00:30+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_B', 600) ->> 'retry_after_seconds'")
expect "30 seconds later the retry delay is 30" "30" "$r"

set_clock "2026-11-23T10:00:59+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_B', 600) ->> 'ok'")
expect "59 seconds later it is still refused" "false" "$r"

set_clock "2026-11-23T10:01:00+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_B', 600) ->> 'ok'")
expect "at exactly 60 seconds a new code is issued" "true" "$r"
unused=$(q "SELECT count(*) FROM public.step_up_codes WHERE user_id = '$U1' AND purpose = 'withdrawal' AND used_at IS NULL")
expect "issuing a code invalidates the older unused one" "1" "$unused"

# A different purpose has its own cooldown.
r=$(q "SELECT public.create_step_up_code('$U1', 'bank_change', '$HASH_A', 600) ->> 'ok'")
expect "another purpose is not blocked by the cooldown" "true" "$r"
# A different user has their own cooldown.
r=$(q "SELECT public.create_step_up_code('$U2', 'withdrawal', '$HASH_A', 600) ->> 'ok'")
expect "another user is not blocked by the cooldown" "true" "$r"

# Codes 3, 4, 5 for U1/withdrawal, one minute apart.
set_clock "2026-11-23T10:02:00+01:00"
q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_A', 600)" >/dev/null
set_clock "2026-11-23T10:03:00+01:00"
q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_B', 600)" >/dev/null
set_clock "2026-11-23T10:04:00+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_C', 600) ->> 'ok'")
expect "the fifth code in the hour is issued" "true" "$r"
set_clock "2026-11-23T10:05:00+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_A', 600)")
contains "the sixth code in the hour is refused" '"ok": false' "$r"
# The oldest of the five (10:00:00) leaves the window at 11:00:00: 55 minutes.
contains "the retry delay is until the oldest code leaves the hour (3300 s)" '"retry_after_seconds": 3300' "$r"
count=$(q "SELECT count(*) FROM public.step_up_codes WHERE user_id = '$U1' AND purpose = 'withdrawal'")
expect "a refused request stores nothing" "5" "$count"

set_clock "2026-11-23T11:00:01+01:00"
r=$(q "SELECT public.create_step_up_code('$U1', 'withdrawal', '$HASH_A', 600) ->> 'ok'")
expect "once the oldest code is over an hour old a new code is issued" "true" "$r"

step "create_step_up_code: input checks"
e=$(qx "SELECT public.create_step_up_code(NULL, 'withdrawal', '$HASH_A', 600)")
contains "a null user is refused" "invalid_user" "$e"
e=$(qx "SELECT public.create_step_up_code('99999999-9999-4999-8999-999999999999', 'withdrawal', '$HASH_A', 600)")
contains "an unknown user is refused" "invalid_user" "$e"
e=$(qx "SELECT public.create_step_up_code('$U2', 'login', '$HASH_A', 600)")
contains "an unknown purpose is refused" "invalid_purpose" "$e"
e=$(qx "SELECT public.create_step_up_code('$U2', 'bank_change', 'short', 600)")
contains "a short hash is refused" "invalid_code_hash" "$e"
e=$(qx "SELECT public.create_step_up_code('$U2', 'bank_change', '$HASH_A', 10)")
contains "an expiry under 60 seconds is refused" "invalid_expiry" "$e"
e=$(qx "SELECT public.create_step_up_code('$U2', 'bank_change', '$HASH_A', 7200)")
contains "an expiry over an hour is refused" "invalid_expiry" "$e"

# ============================================================================
step "verify_step_up_code"
set_clock "2026-11-24T10:00:00+01:00"
V=66666666-6666-4666-8666-666666666666
seed_user "$V" v@example.com 0 30
W=77777777-7777-4777-8777-777777777777
seed_user "$W" w@example.com 0 30

q "SELECT public.create_step_up_code('$V', 'withdrawal', '$HASH_A', 600)" >/dev/null
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_A')")
expect "the right code verifies" "t" "$r"
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_A')")
expect "a used code cannot be used again" "f" "$r"

set_clock "2026-11-24T10:01:00+01:00"
q "SELECT public.create_step_up_code('$V', 'withdrawal', '$HASH_A', 600)" >/dev/null
r=$(q "SELECT public.verify_step_up_code('$W', 'withdrawal', '$HASH_A')")
expect "another user cannot verify this user's code" "f" "$r"
r=$(q "SELECT public.verify_step_up_code('$V', 'bank_change', '$HASH_A')")
expect "a code for one purpose does not verify another" "f" "$r"
r=$(q "SELECT attempts FROM public.step_up_codes WHERE user_id = '$V' AND used_at IS NULL")
expect "another user's guess does not use up this user's attempts" "0" "$r"

r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_B')")
expect "a wrong code is refused" "f" "$r"
r=$(q "SELECT attempts FROM public.step_up_codes WHERE user_id = '$V' AND used_at IS NULL")
expect "a wrong code counts one attempt" "1" "$r"
for i in 2 3 4; do q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_B')" >/dev/null; done
r=$(q "SELECT attempts FROM public.step_up_codes WHERE user_id = '$V' AND used_at IS NULL")
expect "four wrong attempts leave the code alive" "4" "$r"
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_B')")
expect "the fifth wrong attempt is refused" "f" "$r"
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_A')")
expect "after five wrong attempts even the right code no longer works" "f" "$r"
voided=$(q "SELECT count(*) FROM public.step_up_codes WHERE user_id = '$V' AND attempts = 5 AND used_at IS NOT NULL")
expect "the voided code is closed" "1" "$voided"

# Expiry
set_clock "2026-11-24T11:00:00+01:00"
q "SELECT public.create_step_up_code('$V', 'withdrawal', '$HASH_A', 600)" >/dev/null
set_clock "2026-11-24T11:09:59+01:00"
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_A')")
expect "a code verifies one second before it expires" "t" "$r"
set_clock "2026-11-24T12:00:00+01:00"
q "SELECT public.create_step_up_code('$V', 'withdrawal', '$HASH_A', 600)" >/dev/null
set_clock "2026-11-24T12:10:00+01:00"
r=$(q "SELECT public.verify_step_up_code('$V', 'withdrawal', '$HASH_A')")
expect "a code does not verify at its expiry time" "f" "$r"

# Newest code only
set_clock "2026-11-24T13:00:00+01:00"
q "SELECT public.create_step_up_code('$W', 'bank_change', '$HASH_A', 600)" >/dev/null
set_clock "2026-11-24T13:01:00+01:00"
q "SELECT public.create_step_up_code('$W', 'bank_change', '$HASH_B', 600)" >/dev/null
r=$(q "SELECT public.verify_step_up_code('$W', 'bank_change', '$HASH_A')")
expect "an older code no longer verifies once a newer one exists" "f" "$r"
r=$(q "SELECT public.verify_step_up_code('$W', 'bank_change', '$HASH_B')")
expect "the newest code verifies" "t" "$r"

r=$(q "SELECT public.verify_step_up_code(NULL, 'withdrawal', '$HASH_A')")
expect "a null user does not verify" "f" "$r"
r=$(q "SELECT public.verify_step_up_code('$W', 'withdrawal', NULL)")
expect "a null hash does not verify" "f" "$r"
stored=$(q "SELECT count(*) FROM public.step_up_codes WHERE code_hash NOT IN ('$HASH_A', '$HASH_B', '$HASH_C')")
expect "only the supplied hashes are stored" "0" "$stored"

# ============================================================================
step "update_setting: roles"
e=$(qx "SELECT public.update_setting('$PLAIN', 'withdrawal_fee_bps', '250'::jsonb)")
contains "a user without a staff role is forbidden" "forbidden" "$e"
e=$(qx "SELECT public.update_setting(NULL, 'withdrawal_fee_bps', '250'::jsonb)")
contains "a null actor is forbidden" "forbidden" "$e"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '250'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'withdrawal_fee_bps'")
expect "an admin may change a setting" "250" "$v"
q "SELECT public.update_setting('$FIN', 'withdrawal_fee_bps', '200'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'withdrawal_fee_bps'")
expect "finance may change a setting" "200" "$v"

step "update_setting: whitelist, types and ranges"
e=$(qx "SELECT public.update_setting('$ADMIN', 'paystack_transfer_fee_bands', '[]'::jsonb)")
contains "a setting outside the whitelist is refused" "setting_not_allowed" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'payout_clock_override_iso', '\"2026-01-01T00:00:00Z\"'::jsonb)")
contains "the clock override cannot be set" "setting_not_allowed" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'no_such_key', '1'::jsonb)")
contains "an unknown key is refused" "setting_not_allowed" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', NULL, '1'::jsonb)")
contains "a null key is refused" "setting_not_allowed" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', NULL)")
contains "a null value is refused" "invalid_value" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '\"200\"'::jsonb)")
contains "a string where a number is required is refused" "invalid_value" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '2.5'::jsonb)")
contains "a fraction is refused" "invalid_value" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'auto_payout_default', '1'::jsonb)")
contains "a number where a boolean is required is refused" "invalid_value" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'payout_first_requires_approval', '\"true\"'::jsonb)")
contains "a string where a boolean is required is refused" "invalid_value" "$e"

e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '1001'::jsonb)")
contains "withdrawal_fee_bps above 1000 is refused" "out_of_range" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '-1'::jsonb)")
contains "withdrawal_fee_bps below 0 is refused" "out_of_range" "$e"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '1000'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'withdrawal_fee_bps'")
expect "withdrawal_fee_bps 1000 is accepted" "1000" "$v"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '0'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'withdrawal_fee_bps'")
expect "withdrawal_fee_bps 0 is accepted" "0" "$v"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '200'::jsonb)" >/dev/null

e=$(qx "SELECT public.update_setting('$ADMIN', 'platform_fee_bps', '3001'::jsonb)")
contains "platform_fee_bps above 3000 is refused" "out_of_range" "$e"
q "SELECT public.update_setting('$ADMIN', 'platform_fee_bps', '3000'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'platform_fee_bps'")
expect "platform_fee_bps 3000 is accepted" "3000" "$v"
q "SELECT public.update_setting('$ADMIN', 'platform_fee_bps', '1000'::jsonb)" >/dev/null

e=$(qx "SELECT public.update_setting('$ADMIN', 'commission_hold_days', '61'::jsonb)")
contains "commission_hold_days above 60 is refused" "out_of_range" "$e"
q "SELECT public.update_setting('$ADMIN', 'commission_hold_days', '0'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'commission_hold_days'")
expect "commission_hold_days 0 is accepted" "0" "$v"
q "SELECT public.update_setting('$ADMIN', 'commission_hold_days', '7'::jsonb)" >/dev/null

e=$(qx "SELECT public.update_setting('$ADMIN', 'min_withdrawal_kobo', '0'::jsonb)")
contains "a zero minimum withdrawal is refused" "out_of_range" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_daily_limit_kobo', '-5'::jsonb)")
contains "a negative daily limit is refused" "out_of_range" "$e"

step "update_setting: values that must stay in order"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_min_kobo', '200001'::jsonb)")
contains "a fee minimum above the cap is refused" "invalid_combination" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_cap_kobo', '4999'::jsonb)")
contains "a fee cap below the minimum is refused" "invalid_combination" "$e"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_min_kobo', '200000'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'withdrawal_fee_min_kobo'")
expect "a fee minimum equal to the cap is accepted" "200000" "$v"
q "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_min_kobo', '5000'::jsonb)" >/dev/null

e=$(qx "SELECT public.update_setting('$ADMIN', 'payout_dual_approval_kobo', '9999999'::jsonb)")
contains "dual approval below auto approve is refused" "invalid_combination" "$e"
e=$(qx "SELECT public.update_setting('$ADMIN', 'payout_auto_approve_max_kobo', '50000001'::jsonb)")
contains "auto approve above dual approval is refused" "invalid_combination" "$e"
q "SELECT public.update_setting('$ADMIN', 'payout_dual_approval_kobo', '10000000'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'payout_dual_approval_kobo'")
expect "dual approval equal to auto approve is accepted" "10000000" "$v"
q "SELECT public.update_setting('$ADMIN', 'payout_dual_approval_kobo', '50000000'::jsonb)" >/dev/null

step "update_setting: history and audit"
before_h=$(q "SELECT count(*) FROM public.settings_history WHERE key = 'min_withdrawal_kobo'")
q "SELECT public.update_setting('$ADMIN', 'min_withdrawal_kobo', '1000000'::jsonb)" >/dev/null
after_h=$(q "SELECT count(*) FROM public.settings_history WHERE key = 'min_withdrawal_kobo'")
expect "a change adds exactly one settings_history row" "$((before_h + 1))" "$after_h"
hist=$(q "SELECT old_value::text || '>' || new_value::text || '|' || changed_by::text FROM public.settings_history WHERE key = 'min_withdrawal_kobo' ORDER BY id DESC LIMIT 1")
expect "the history row holds before, after and the actor" "500000>1000000|$ADMIN" "$hist"
aud=$(q "SELECT actor_id || '|' || action || '|' || entity_id || '|' || (before ->> 'value') || '|' || (after ->> 'value') FROM public.audit_log WHERE action = 'setting.updated' AND entity_id = 'min_withdrawal_kobo' ORDER BY id DESC LIMIT 1")
expect "the audit row holds the actor, before and after" "$ADMIN|setting.updated|min_withdrawal_kobo|500000|1000000" "$aud"
upd=$(q "SELECT updated_by FROM public.settings WHERE key = 'min_withdrawal_kobo'")
expect "settings.updated_by is the actor" "$ADMIN" "$upd"

before_h=$(q "SELECT count(*) FROM public.settings_history WHERE key = 'min_withdrawal_kobo'")
before_a=$(q "SELECT count(*) FROM public.audit_log WHERE action = 'setting.updated'")
q "SELECT public.update_setting('$ADMIN', 'min_withdrawal_kobo', '1000000'::jsonb)" >/dev/null
after_h=$(q "SELECT count(*) FROM public.settings_history WHERE key = 'min_withdrawal_kobo'")
after_a=$(q "SELECT count(*) FROM public.audit_log WHERE action = 'setting.updated'")
expect "saving the same value writes no history" "$before_h" "$after_h"
expect "saving the same value writes no audit row" "$before_a" "$after_a"

q "SELECT public.update_setting('$FIN', 'min_withdrawal_kobo', '500000'::jsonb)" >/dev/null
hist=$(q "SELECT changed_by FROM public.settings_history WHERE key = 'min_withdrawal_kobo' ORDER BY id DESC LIMIT 1")
expect "a later change by finance records finance" "$FIN" "$hist"

refused_a=$(q "SELECT count(*) FROM public.audit_log WHERE action = 'setting.updated'")
qx "SELECT public.update_setting('$ADMIN', 'withdrawal_fee_bps', '5000'::jsonb)" >/dev/null
refused_b=$(q "SELECT count(*) FROM public.audit_log WHERE action = 'setting.updated'")
expect "a refused change writes no audit row" "$refused_a" "$refused_b"

q "SELECT public.update_setting('$ADMIN', 'auto_payout_default', 'false'::jsonb)" >/dev/null
v=$(q "SELECT value FROM public.settings WHERE key = 'auto_payout_default'")
expect "a boolean setting changes" "false" "$v"
q "SELECT public.update_setting('$ADMIN', 'auto_payout_default', 'true'::jsonb)" >/dev/null
claim=$(q "SELECT coalesce(current_setting('request.jwt.claim.sub', true), '')")
expect "the actor claim does not leak out of the call" "" "$claim"

# ============================================================================
step "list_blackout_dates"
q "SELECT public.add_payout_blackout('$ADMIN', '2026-12-25', 'Christmas Day')" >/dev/null
q "SELECT public.add_payout_blackout('$ADMIN', '2026-12-01', 'Bank system upgrade')" >/dev/null
q "SELECT public.add_payout_blackout('$ADMIN', '2027-03-01', 'Outside the window')" >/dev/null
rows=$(q "SELECT string_agg(day::text || ':' || reason, ',' ORDER BY day) FROM public.list_blackout_dates('2026-11-24', '2026-12-31')")
expect "dates in range come back in order with their reasons" "2026-12-01:Bank system upgrade,2026-12-25:Christmas Day" "$rows"
rows=$(q "SELECT count(*) FROM public.list_blackout_dates('2026-12-25', '2026-12-25')")
expect "both ends of the range are included" "1" "$rows"
e=$(qx "SELECT * FROM public.list_blackout_dates('2026-12-31', '2026-12-01')")
contains "a reversed range is refused" "invalid_range" "$e"
e=$(qx "SELECT * FROM public.list_blackout_dates(NULL, '2026-12-01')")
contains "a null bound is refused" "invalid_range" "$e"
e=$(qx "SELECT * FROM public.list_blackout_dates('2024-01-01', '2026-12-31')")
contains "a range over 800 days is refused" "invalid_range" "$e"

# ============================================================================
step "get_payout_screen_data"
set_clock "2026-11-23T10:00:00+01:00"
SD=88888888-8888-4888-8888-888888888888
seed_user "$SD" sd@example.com 7000000 30
d=$(q "SELECT public.get_payout_screen_data('$SD')")
r=$(q "SELECT public.get_payout_screen_data('$SD') -> 'account'")
expect "no account gives a null account" "" "$(printf '%s' "$r" | sed 's/^null$//')"
r=$(q "SELECT (public.get_payout_screen_data('$SD') ->> 'available_kobo') || '|' || (public.get_payout_screen_data('$SD') ->> 'pending_kobo') || '|' || (public.get_payout_screen_data('$SD') ->> 'total_kobo')")
expect "balance is available 7000000, pending 0, total 7000000" "7000000|0|7000000" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') ->> 'auto_payout'")
expect "auto payout falls back to the default (true)" "true" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') ->> 'today_is_payout_day'")
expect "Monday is a payout day" "true" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') ->> 'next_payout_day'")
expect "next payout day is today" "2026-11-23" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') -> 'blackout_reason'")
expect "no blackout reason on a normal day" "null" "$r"
r=$(q "SELECT (s ->> 'min_withdrawal_kobo') || '|' || (s ->> 'withdrawal_fee_bps') || '|' || (s ->> 'withdrawal_fee_min_kobo') || '|' || (s ->> 'withdrawal_fee_cap_kobo') || '|' || (s ->> 'commission_hold_days')
      FROM (SELECT public.get_payout_screen_data('$SD') -> 'settings' AS s) x")
expect "the explained settings are returned" "500000|200|5000|200000|7" "$r"
r=$(q "SELECT jsonb_array_length(public.get_payout_screen_data('$SD') -> 'withdrawals')")
expect "no withdrawals gives an empty list" "0" "$r"

q "SELECT public.set_payout_account('$SD', '058', 'GTBank', '4321', 'SD USER', 'RCP_SECRET_SD', true)" >/dev/null
r=$(q "SELECT (a ->> 'bank_name') || '|' || (a ->> 'account_last4') || '|' || (a ->> 'account_name') || '|' || (a -> 'frozen_until')::text
      FROM (SELECT public.get_payout_screen_data('$SD') -> 'account' AS a) x")
expect "a first account is shown in safe form and not frozen" "GTBank|4321|SD USER|null" "$r"
d=$(q "SELECT public.get_payout_screen_data('$SD')::text")
case "$d" in *RCP_SECRET_SD*|*recipient*) fail "the screen data never contains the recipient code" "$d" ;; *) pass "the screen data never contains the recipient code" ;; esac
r=$(q "SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.get_payout_screen_data('$SD') -> 'account') k)::text")
expect "the account holds only four safe fields" "{account_last4,account_name,bank_name,frozen_until}" "$r"

q "SELECT public.set_payout_account('$SD', '044', 'Access Bank', '9999', 'SD USER', 'RCP_SECRET_SD2', true)" >/dev/null
r=$(q "SELECT (a ->> 'bank_name') || '|' || ((a ->> 'frozen_until')::timestamptz > public.payout_now() + interval '71 hours')::text
      FROM (SELECT public.get_payout_screen_data('$SD') -> 'account' AS a) x")
expect "a changed account shows the new bank and a freeze of about 72 hours" "Access Bank|true" "$r"

q "SELECT public.set_auto_payout('$SD', false)" >/dev/null
r=$(q "SELECT public.get_payout_screen_data('$SD') ->> 'auto_payout'")
expect "auto payout off is returned" "false" "$r"

set_clock "2026-11-21T10:00:00+01:00"   # Saturday
r=$(q "SELECT (public.get_payout_screen_data('$SD') ->> 'today_is_payout_day') || '|' || (public.get_payout_screen_data('$SD') ->> 'next_payout_day') || '|' || coalesce(public.get_payout_screen_data('$SD') ->> 'blackout_reason', 'none')")
expect "Saturday is not a payout day, the next is Monday, no blackout reason" "false|2026-11-23|none" "$r"

set_clock "2026-12-25T10:00:00+01:00"
r=$(q "SELECT (public.get_payout_screen_data('$SD') ->> 'today_is_payout_day') || '|' || (public.get_payout_screen_data('$SD') ->> 'blackout_reason')")
expect "a blackout day returns its reason" "false|Christmas Day" "$r"

set_clock "2026-11-23T10:00:00+01:00"
q "SELECT public.set_auto_payout('$SD', true)" >/dev/null
q "SELECT public.set_payout_account('$SD', '058', 'GTBank', '4321', 'SD USER', 'RCP_SECRET_SD3', true)" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$SD'" >/dev/null
for n in 1 2 3; do
  q "INSERT INTO public.withdrawals (user_id, payout_account_id, kind, status, gross_kobo, fee_kobo, net_kobo, reference, note, requested_at)
     SELECT '$SD', a.id, 'manual', CASE WHEN $n = 3 THEN 'rejected' ELSE 'paid' END, 500000, 10000, 490000,
            'wd_screendata00000000$n', CASE WHEN $n = 3 THEN 'Name did not match' ELSE 'internal admin note' END,
            now() - interval '$n hours'
       FROM public.payout_accounts a WHERE a.user_id = '$SD' AND a.status = 'active'" >/dev/null
done
r=$(q "SELECT jsonb_array_length(public.get_payout_screen_data('$SD') -> 'withdrawals')")
expect "withdrawals are listed" "3" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') -> 'withdrawals' -> 0 ->> 'status'")
expect "the newest withdrawal is first" "paid" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') -> 'withdrawals' -> 2 ->> 'reason'")
expect "a rejected withdrawal carries its reason" "Name did not match" "$r"
r=$(q "SELECT public.get_payout_screen_data('$SD') -> 'withdrawals' -> 0 ->> 'reason'")
expect "a paid withdrawal never carries the admin note" "" "$(printf '%s' "$r")"
d=$(q "SELECT public.get_payout_screen_data('$SD')::text")
case "$d" in *wd_screendata*|*"internal admin note"*) fail "no reference or private note is returned" ;; *) pass "no reference or private note is returned" ;; esac

for n in $(seq 4 25); do
  q "INSERT INTO public.withdrawals (user_id, payout_account_id, kind, status, gross_kobo, fee_kobo, net_kobo, reference, requested_at)
     SELECT '$SD', a.id, 'manual', 'paid', 500000, 10000, 490000,
            'wd_screendatamany' || lpad('$n', 4, '0'), now() - interval '$n days'
       FROM public.payout_accounts a WHERE a.user_id = '$SD' AND a.status = 'active'" >/dev/null
done
r=$(q "SELECT jsonb_array_length(public.get_payout_screen_data('$SD') -> 'withdrawals')")
expect "only the last 20 withdrawals are returned" "20" "$r"

# A pending credit (held) is pending, not available.
PD=99999999-9999-4999-8999-999999999999
seed_user "$PD" pd@example.com 0 30
q "BEGIN;
   INSERT INTO public.ledger_transactions (kind, idempotency_key) VALUES ('seed', 'seed:pending:$PD');
   INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo)
     SELECT id, 1, NULL, 3000000, 0 FROM public.ledger_transactions WHERE idempotency_key = 'seed:pending:$PD';
   INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
     SELECT id, 3, '$PD', 0, 3000000, '2026-12-30 00:00:00+00'::timestamptz
       FROM public.ledger_transactions WHERE idempotency_key = 'seed:pending:$PD';
   COMMIT;" >/dev/null
r=$(q "SELECT (public.get_payout_screen_data('$PD') ->> 'available_kobo') || '|' || (public.get_payout_screen_data('$PD') ->> 'pending_kobo')")
expect "a held credit is pending, not available" "0|3000000" "$r"

e=$(qx "SELECT public.get_payout_screen_data(NULL)")
contains "a null user is refused" "invalid_user" "$e"
e=$(qx "SELECT public.get_payout_screen_data('00000000-0000-4000-8000-000000000000')")
contains "an unknown user is refused" "invalid_user" "$e"

# ============================================================================
step "admin_withdrawal_queue"
e=$(qx "SELECT public.admin_withdrawal_queue('$PLAIN', 'paid', 10, NULL)")
contains "a user without a staff role is forbidden" "forbidden" "$e"
e=$(qx "SELECT public.admin_withdrawal_queue(NULL, 'paid', 10, NULL)")
contains "a null actor is forbidden" "forbidden" "$e"
e=$(qx "SELECT public.admin_withdrawal_queue('$ADMIN', 'everything', 10, NULL)")
contains "an unknown tab is refused" "invalid_tab" "$e"
e=$(qx "SELECT public.admin_withdrawal_queue('$ADMIN', NULL, 10, NULL)")
contains "a null tab is refused" "invalid_tab" "$e"

r=$(q "SELECT jsonb_array_length(public.admin_withdrawal_queue('$FIN', 'paid', 100, NULL) -> 'rows')")
expect "finance may read the paid tab (24 paid rows seeded)" "24" "$r"
r=$(q "SELECT jsonb_array_length(public.admin_withdrawal_queue('$ADMIN', 'closed', 100, NULL) -> 'rows')")
expect "the closed tab holds the rejected withdrawal" "1" "$r"
r=$(q "SELECT jsonb_array_length(public.admin_withdrawal_queue('$ADMIN', 'needs_approval', 100, NULL) -> 'rows')")
expect "nothing needs approval yet" "0" "$r"

r=$(q "SELECT (x ->> 'bank_name') || '|' || (x ->> 'account_last4') || '|' || (x ->> 'account_name')
        FROM (SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 1, NULL) -> 'rows' -> 0 AS x) y")
expect "a row carries the bank name, last four and account name" "GTBank|4321|SD USER" "$r"
d=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 100, NULL)::text")
case "$d" in *RCP_SECRET*|*recipient*|*wd_screendata*|*reference*) fail "the queue never carries a recipient code or a reference" ;; *) pass "the queue never carries a recipient code or a reference" ;; esac

r=$(q "SELECT (public.admin_withdrawal_queue('$ADMIN', 'paid', 100, NULL) -> 'rows' -> 0 ->> 'is_first') || '|' || (public.admin_withdrawal_queue('$ADMIN', 'paid', 100, NULL) -> 'rows' -> 23 ->> 'is_first')")
expect "only the user's oldest withdrawal is the first" "false|true" "$r"

# Paging: 10 per page, 24 rows, no gap and no repeat.
p1=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 10, NULL)::text")
cur=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 10, NULL) -> 'next_cursor'")
p2=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 10, '$cur'::jsonb)::text")
cur2=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'paid', 10, '$cur'::jsonb) -> 'next_cursor'")
p3=$(q "SELECT jsonb_array_length(public.admin_withdrawal_queue('$ADMIN', 'paid', 10, '$cur2'::jsonb) -> 'rows')")
expect "the third page holds the last four rows" "4" "$p3"
ids=$(q "SELECT count(DISTINCT id) FROM (
           SELECT x ->> 'id' AS id FROM jsonb_array_elements(public.admin_withdrawal_queue('$ADMIN', 'paid', 10, NULL) -> 'rows') x
           UNION ALL
           SELECT x ->> 'id' FROM jsonb_array_elements(public.admin_withdrawal_queue('$ADMIN', 'paid', 10, '$cur'::jsonb) -> 'rows') x
           UNION ALL
           SELECT x ->> 'id' FROM jsonb_array_elements(public.admin_withdrawal_queue('$ADMIN', 'paid', 10, '$cur2'::jsonb) -> 'rows') x
         ) z")
expect "the three pages hold 24 different withdrawals" "24" "$ids"

# A dual-approval withdrawal with one approval so far, and a risk flag.
TW=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
seed_user "$TW" tw@example.com 0 30
q "SELECT public.set_payout_account('$TW', '058', 'GTBank', '5555', 'TW USER', 'RCP_SECRET_TW', true)" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$TW'" >/dev/null
q "INSERT INTO public.withdrawals (user_id, payout_account_id, kind, status, gross_kobo, fee_kobo, net_kobo, reference, approved_by)
   SELECT '$TW', a.id, 'manual', 'requested', 60000000, 200000, 59800000, 'wd_dualapproval0000001', '$ADMIN'
     FROM public.payout_accounts a WHERE a.user_id = '$TW' AND a.status = 'active'" >/dev/null
q "INSERT INTO public.withdrawal_approvals (withdrawal_id, approver, decision)
   SELECT id, '$ADMIN', 'approved' FROM public.withdrawals WHERE reference = 'wd_dualapproval0000001'" >/dev/null
r=$(q "SELECT (x ->> 'approvals') || '|' || (x ->> 'needs_two_approvers') || '|' || (x ->> 'needs_second_approver') || '|' || (x ->> 'is_first') || '|' || (x ->> 'has_risk_flag') || '|' || (x ->> 'first_approver')
        FROM (SELECT public.admin_withdrawal_queue('$FIN', 'needs_approval', 10, NULL) -> 'rows' -> 0 AS x) y")
expect "one approval so far, two approvers needed, a second is needed, first withdrawal, no risk flag" "1|true|true|true|false|$ADMIN" "$r"

q "INSERT INTO public.affiliate_profiles (user_id, username) VALUES ('$TW', 'twuser') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO public.risk_flags (affiliate_id, kind) VALUES ('$TW', 'click_burst')" >/dev/null
r=$(q "SELECT public.admin_withdrawal_queue('$FIN', 'needs_approval', 10, NULL) -> 'rows' -> 0 ->> 'has_risk_flag'")
expect "an unresolved risk flag is shown" "true" "$r"
q "UPDATE public.risk_flags SET resolved_at = now() WHERE affiliate_id = '$TW'" >/dev/null
r=$(q "SELECT public.admin_withdrawal_queue('$FIN', 'needs_approval', 10, NULL) -> 'rows' -> 0 ->> 'has_risk_flag'")
expect "a resolved risk flag is not shown" "false" "$r"

q "UPDATE public.withdrawals SET status = 'processing' WHERE reference = 'wd_dualapproval0000001'" >/dev/null
r=$(q "SELECT jsonb_array_length(public.admin_withdrawal_queue('$ADMIN', 'processing', 10, NULL) -> 'rows')")
expect "a processing withdrawal is in the processing tab" "1" "$r"
r=$(q "SELECT public.admin_withdrawal_queue('$ADMIN', 'processing', 10, NULL) -> 'rows' -> 0 ->> 'needs_second_approver'")
expect "a processing withdrawal no longer needs a second approver" "false" "$r"
q "UPDATE public.withdrawals SET status = 'requested' WHERE reference = 'wd_dualapproval0000001'" >/dev/null

# ============================================================================
step "Privileges and row level security"
for fn in "create_step_up_code('$U1', 'withdrawal', '$HASH_A', 600)" "verify_step_up_code('$U1', 'withdrawal', '$HASH_A')" \
          "update_setting('$ADMIN', 'withdrawal_fee_bps', '200'::jsonb)" "list_blackout_dates('2026-12-01', '2026-12-31')" \
          "get_payout_screen_data('$U1')" "admin_withdrawal_queue('$ADMIN', 'paid', 10, NULL)"; do
  name="${fn%%(*}"
  e=$(qx "SET ROLE anon; SELECT public.$fn")
  contains "anon cannot execute $name" "permission denied" "$e"
  e=$(qx "SET ROLE authenticated; SET request.jwt.claim.sub = '$ADMIN'; SELECT public.$fn")
  contains "authenticated cannot execute $name" "permission denied" "$e"
done
r=$(q "SET ROLE service_role; SELECT public.get_payout_screen_data('$U1') ->> 'today_is_payout_day'")
expect "service_role can execute the screen function" "true" "$r"

e=$(qx "SET ROLE authenticated; SET request.jwt.claim.sub = '$U1'; SELECT count(*) FROM public.step_up_codes")
contains "authenticated cannot read step_up_codes" "permission denied" "$e"
e=$(qx "SET ROLE authenticated; SET request.jwt.claim.sub = '$U1'; INSERT INTO public.step_up_codes (user_id, purpose, code_hash, expires_at) VALUES ('$U1', 'withdrawal', '$HASH_A', now())")
contains "authenticated cannot write step_up_codes" "permission denied" "$e"
e=$(qx "SET ROLE anon; SELECT count(*) FROM public.step_up_codes")
contains "anon cannot read step_up_codes" "permission denied" "$e"
rls=$(q "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.step_up_codes'::regclass")
expect "row level security is on for step_up_codes" "t" "$rls"
pol=$(q "SELECT count(*) FROM pg_policies WHERE tablename = 'step_up_codes'")
expect "step_up_codes has no client policy" "0" "$pol"
e=$(qx "INSERT INTO public.step_up_codes (user_id, purpose, code_hash, expires_at) VALUES ('$U1', 'login', '$HASH_A', now())")
contains "the purpose check constraint holds" "violates check constraint" "$e"

# ============================================================================
step "Commented rollback block, then re-apply"
ROLLBACK_SQL=$(mktemp /tmp/affilova_rollback.XXXXXX.sql)
awk '/^-- ROLLBACK/,0' "$MIGRATION" | sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' | sed 's/^-- //' | sed 's/^--$//' > "$ROLLBACK_SQL"
if run_file "$ROLLBACK_SQL" >/dev/null 2>&1; then pass "rollback block executed"; else fail "rollback block executed"; fi
rm -f "$ROLLBACK_SQL"

tbl=$(q "SELECT count(*) FROM pg_class WHERE relname = 'step_up_codes' AND relnamespace = 'public'::regnamespace")
expect "rollback dropped step_up_codes" "0" "$tbl"
fns=$(q "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('create_step_up_code', 'verify_step_up_code', 'update_setting', 'list_blackout_dates', 'get_payout_screen_data', 'admin_withdrawal_queue')")
expect "rollback dropped the six functions" "0" "$fns"
mig=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261123000100'")
expect "rollback removed the migration row" "0" "$mig"
pay=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261122000100'")
expect "the payouts migration is untouched by the rollback" "1" "$pay"

if run_file "$MIGRATION" >/dev/null 2>&1; then pass "re-applied after rollback"; else fail "re-applied after rollback"; fi
back=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261123000100'")
expect "the re-applied migration is recorded" "1" "$back"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
expect "the verify file passes again" "0" "$bad"

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
