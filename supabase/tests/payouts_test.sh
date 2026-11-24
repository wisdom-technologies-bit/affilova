#!/usr/bin/env bash
# ============================================================================
# Payouts harness (migration 20261122000100_payouts)
#
# Builds a throwaway local Postgres database that mimics Supabase's auth/roles,
# applies every migration in order, and tests:
#   1. the verify file
#   2. running the migration twice on the same database
#   3. the fee arithmetic and every refusal reason, with exact kobo amounts
#   4. the request, paid, return and reversal postings, and their idempotency
#   5. dual approval, the owner-approval refusal and the approval audit rows
#   6. the claim window, the low-balance release and the stuck sweep
#   7. two sessions racing for the same balance: exactly one succeeds
#   8. the auto payout candidate list
#   9. privileges, row level security, the safe view and the append-only ledger
#  10. the commented rollback block, then re-applying the migration
#
# Usage:  supabase/tests/payouts_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_payouts_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_payouts_test}"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261122000100_payouts.sql"
VERIFY="$ROOT/supabase/verify/20261122000100_payouts_verify.sql"

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
       SELECT id, 3, '$1', 0, $3, now() - interval '1 day'
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
       SELECT id, 3, '$1', 0, $3, now() - interval '1 day'
         FROM public.ledger_transactions WHERE idempotency_key = 'seed:$1';
     INSERT INTO public.ledger_entries (txn_id, account_id, party_id, debit_kobo, credit_kobo, available_at)
       SELECT id, 4, '$1', 0, $4, now() - interval '1 day'
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
  pass "payouts verify ($total checks)"
else
  fail "payouts verify" "$bad false of $total"
  printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
fi

step "Migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run"; else fail "second run"; fi
again=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261122000100'")
expect "recorded once" "1" "$again"

# ============================================================================
step "Seed"
OWNER=11111111-1111-4111-8111-111111111111
ADMIN1=22222222-2222-4222-8222-222222222222
ADMIN2=33333333-3333-4333-8333-333333333333
STAFF_FIN=44444444-4444-4444-8444-444444444444
PLAIN=55555555-5555-4555-8555-555555555555

seed_user "$OWNER" owner@example.com 10000000 30
seed_user "$ADMIN1" admin1@example.com 0 30
seed_user "$ADMIN2" admin2@example.com 0 30
seed_user "$STAFF_FIN" finance@example.com 0 30
seed_user "$PLAIN" plain@example.com 0 30

q "INSERT INTO public.user_roles (user_id, role) VALUES
     ('$ADMIN1', 'admin'), ('$ADMIN2', 'admin'), ('$STAFF_FIN', 'finance'), ('$OWNER', 'admin')
   ON CONFLICT DO NOTHING;" >/dev/null

set_clock "2026-11-23T10:00:00+01:00"   # Monday, inside 08:00-18:00 Lagos
clock=$(q "SELECT to_char(public.payout_now() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI')")
expect "the injected clock is Monday 10:00 Lagos" "2026-11-23 10:00" "$clock"

acct=$(account "$OWNER")
if [ -n "$acct" ] && [[ "$acct" != *ERROR* ]]; then pass "payout account set"; else fail "payout account set" "$acct"; fi
last4=$(q "SELECT account_last4 FROM public.payout_accounts WHERE user_id = '$OWNER' AND status = 'active'")
expect "only the last four digits are stored" "1234" "$last4"

# ============================================================================
step "Fee arithmetic and the preview"
fee100k=$(q "SELECT public.withdrawal_preview('$OWNER', 10000000) ->> 'fee_kobo'")
net100k=$(q "SELECT public.withdrawal_preview('$OWNER', 10000000) ->> 'net_kobo'")
expect "2% of 100,000 NGN is capped at 2,000 NGN (200000 kobo)" "200000" "$fee100k"
expect "net of 100,000 NGN is 98,000 NGN (9800000 kobo)" "9800000" "$net100k"

fee5k=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'fee_kobo'")
expect "5,000 NGN carries a 100 NGN fee (10000 kobo)" "10000" "$fee5k"

small=$(q "SELECT public.withdrawal_preview('$OWNER', 250000) ->> 'reasons'")
contains "2,500 NGN is refused as below_minimum" "below_minimum" "$small"

needs=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'needs_approval'")
expect "the first withdrawal needs approval" "true" "$needs"

nextday=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'next_payout_day'")
expect "next payout day is today" "2026-11-23" "$nextday"

step "Weekend and blackout refusals"
set_clock "2026-11-21T10:00:00+01:00"   # Saturday
weekend=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'reasons'")
contains "a Saturday is refused as not_payout_day" "not_payout_day" "$weekend"
claimed=$(q "SELECT count(*) FROM public.claim_withdrawals_for_transfer(20)")
expect "nothing is claimed on a Saturday" "0" "$claimed"

set_clock "2026-11-23T10:00:00+01:00"
q "INSERT INTO public.payout_blackout_dates (day, reason, created_by)
   VALUES ('2026-11-24', 'payment partner downtime', '$ADMIN1') ON CONFLICT DO NOTHING;" >/dev/null
set_clock "2026-11-24T10:00:00+01:00"   # Tuesday, blocked
blocked=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'reasons'")
contains "a blacked out date is refused as not_payout_day" "not_payout_day" "$blocked"
set_clock "2026-11-23T10:00:00+01:00"

step "Account rules"
q "INSERT INTO auth.users (id, email) VALUES ('66666666-6666-4666-8666-666666666666', 'new@example.com');
   UPDATE public.profiles SET created_at = now() - interval '2 days'
    WHERE id = '66666666-6666-4666-8666-666666666666';" >/dev/null
NEWUSER=66666666-6666-4666-8666-666666666666
account "$NEWUSER" >/dev/null
young=$(q "SELECT public.withdrawal_preview('$NEWUSER', 500000) ->> 'reasons'")
contains "a 2 day old user account is account_too_new" "account_too_new" "$young"

mismatch=$(qx "SELECT public.set_payout_account('$NEWUSER', '058', 'GTBank', '4321', 'SOMEONE ELSE', 'RCP_x', false)")
contains "a name that does not match is refused" "name_mismatch" "$mismatch"
still=$(q "SELECT count(*) FROM public.payout_accounts WHERE user_id = '$NEWUSER'")
expect "a mismatched name stores no account" "1" "$still"

# A second account replaces the first and starts the 72 hour freeze.
account "$OWNER" >/dev/null
frozen=$(q "SELECT public.withdrawal_preview('$OWNER', 500000) ->> 'reasons'")
contains "a changed bank account is account_frozen" "account_frozen" "$frozen"
replaced=$(q "SELECT count(*) FROM public.payout_accounts WHERE user_id = '$OWNER' AND status = 'replaced'")
expect "the previous account is replaced" "1" "$replaced"
freeze=$(q "SELECT (frozen_until > public.payout_now() + interval '71 hours')::text
              FROM public.payout_accounts WHERE user_id = '$OWNER' AND status = 'active'")
expect "the freeze is about 72 hours" "true" "$freeze"

# Rewind the freeze so the rest of the harness can withdraw.
q "UPDATE public.payout_accounts SET frozen_until = public.payout_now() - interval '1 minute'
    WHERE user_id = '$OWNER' AND status = 'active';" >/dev/null

step "Daily limit"
DAILY=abababab-abab-4bab-8bab-abababababab
seed_user "$DAILY" daily@example.com 2000000 30
account "$DAILY" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$DAILY';" >/dev/null
q "INSERT INTO public.settings (key, value) VALUES ('withdrawal_daily_limit_kobo', '600000'::jsonb)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;" >/dev/null
first=$(q "SELECT public.request_withdrawal('$DAILY', 500000, 'manual', 'wd_dailylimitfirst000001') ->> 'status'")
expect "a first request under the daily limit is accepted" "requested" "$first"
limited=$(q "SELECT public.withdrawal_preview('$DAILY', 500000) ->> 'reasons'")
contains "a second request over the daily limit is daily_limit" "daily_limit" "$limited"
q "UPDATE public.settings SET value = '100000000'::jsonb WHERE key = 'withdrawal_daily_limit_kobo';" >/dev/null
q "SELECT public.cancel_withdrawal('$DAILY', id) FROM public.withdrawals
    WHERE reference = 'wd_dailylimitfirst000001';" >/dev/null

# ============================================================================
step "Request, claim and success posting"
req=$(q "SELECT public.request_withdrawal('$OWNER', 10000000, 'manual', 'wd_successcase0000000001')")
contains "the request needs approval" '"needs_approval": true' "$req"
WID=$(q "SELECT id FROM public.withdrawals WHERE reference = 'wd_successcase0000000001'")
reqstate=$(q "SELECT status FROM public.withdrawals WHERE id = '$WID'")
expect "it starts in requested" "requested" "$reqstate"

balance=$(q "SELECT public.get_party_balance('$OWNER') ->> 'available_kobo'")
expect "the request took the whole available balance" "0" "$balance"

owner_try=$(qx "SELECT public.approve_withdrawal('$OWNER', '$WID', 'self')")
contains "the account owner cannot approve" "owner_cannot_approve" "$owner_try"
plain_try=$(qx "SELECT public.approve_withdrawal('$PLAIN', '$WID', 'nope')")
contains "a user without admin or finance cannot approve" "forbidden" "$plain_try"
short_reason=$(qx "SELECT public.reject_withdrawal('$ADMIN1', '$WID', 'no')")
contains "a rejection reason under 10 characters is refused" "invalid_reason" "$short_reason"

approved=$(q "SELECT public.approve_withdrawal('$ADMIN1', '$WID', 'first withdrawal, checked') ->> 'status'")
expect "an admin approves it" "approved" "$approved"

claim_row=$(q "SELECT reference || '|' || net_kobo || '|' || recipient_code FROM public.claim_withdrawals_for_transfer(20)")
expect "an approved withdrawal is claimed inside the window" "wd_successcase0000000001|9800000|RCP_$OWNER" "$claim_row"
again_claim=$(q "SELECT count(*) FROM public.claim_withdrawals_for_transfer(20)")
expect "a claimed withdrawal is not claimed twice" "0" "$again_claim"

q "SELECT public.mark_transfer_submitted('$WID', 'TRF_success0001', 424242);" >/dev/null
submitted=$(q "SELECT paystack_transfer_code || '|' || paystack_transfer_id FROM public.withdrawals WHERE id = '$WID'")
expect "the transfer code is recorded" "TRF_success0001|424242" "$submitted"

paid=$(q "SELECT public.record_transfer_result('wd_successcase0000000001', 'success', 'TRF_success0001', NULL, 1000) ->> 'status'")
expect "transfer.success marks it paid" "paid" "$paid"
paidrow=$(q "SELECT status || '|' || transfer_fee_kobo FROM public.withdrawals WHERE id = '$WID'")
expect "the reported transfer fee is stored" "paid|1000" "$paidrow"

entries=$(q "SELECT string_agg(account_id || ':' || debit_kobo || ':' || credit_kobo, ',' ORDER BY account_id, id)
               FROM public.ledger_entries WHERE txn_id = (SELECT id FROM public.ledger_transactions
                                                           WHERE idempotency_key = 'withdrawal_paid:$WID')")
expect "the paid posting debits transit and credits balance, fee revenue and the processor fee" \
  "1:0:9800000,1:0:1000,2:1000:0,6:0:200000,8:10000000:0" "$entries"

balanced=$(q "SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries")
expect "the whole ledger is balanced" "true" "$balanced"

dup=$(q "SELECT public.record_transfer_result('wd_successcase0000000001', 'success', 'TRF_success0001', NULL, 1000) ->> 'applied'")
expect "a duplicate success posts nothing" "false" "$dup"
paid_txns=$(q "SELECT count(*) FROM public.ledger_transactions WHERE idempotency_key = 'withdrawal_paid:$WID'")
expect "there is still one paid posting" "1" "$paid_txns"

unknown=$(q "SELECT public.record_transfer_result('wd_doesnotexist00000001', 'success', NULL, NULL, NULL) ->> 'status'")
expect "an unknown reference is not_found" "not_found" "$unknown"
mismatch_code=$(q "SELECT public.record_transfer_result('wd_successcase0000000001', 'success', 'TRF_other', NULL, NULL) ->> 'status'")
expect "a mismatched transfer code is refused" "mismatch" "$mismatch_code"

step "The Paystack fee bands"
for pair in "500000:1000" "2000000:2500" "6000000:5000"; do
  amount=${pair%%:*}
  want=${pair##*:}
  got=$(q "SELECT public.payout_transfer_fee($amount)")
  expect "a ${amount} kobo transfer costs ${want} kobo" "$want" "$got"
done

step "Reversal after paid returns the money"
rev=$(q "SELECT public.record_transfer_result('wd_successcase0000000001', 'reversed', 'TRF_success0001', 'bank returned it', NULL) ->> 'status'")
expect "a reversal after paid is recorded" "reversed" "$rev"
back=$(q "SELECT public.get_party_balance('$OWNER') ->> 'available_kobo'")
expect "the user has the gross back" "10000000" "$back"
return_entries=$(q "SELECT string_agg(account_id || ':' || debit_kobo || ':' || credit_kobo, ',' ORDER BY account_id, id)
                      FROM public.ledger_entries WHERE txn_id = (SELECT id FROM public.ledger_transactions
                                                                  WHERE idempotency_key = 'withdrawal_return:$WID')")
expect "the reversal debits the balance and the fee revenue and credits the payable" \
  "1:9800000:0,3:0:10000000,6:200000:0" "$return_entries"
balanced=$(q "SELECT (sum(debit_kobo) = sum(credit_kobo))::text FROM public.ledger_entries")
expect "the ledger is balanced after the reversal" "true" "$balanced"

# ============================================================================
step "Failure restores the exact payable accounts"
SPLIT=77777777-7777-4777-8777-777777777777
seed_split_user "$SPLIT" split@example.com 400000 300000
account "$SPLIT" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$SPLIT';" >/dev/null
q "SELECT public.request_withdrawal('$SPLIT', 600000, 'manual', 'wd_failurecase0000000001');" >/dev/null
SWID=$(q "SELECT id FROM public.withdrawals WHERE reference = 'wd_failurecase0000000001'")
q "SELECT public.approve_withdrawal('$ADMIN1', '$SWID', 'ok to send');" >/dev/null
q "SELECT public.claim_withdrawals_for_transfer(20);" >/dev/null
q "SELECT public.mark_transfer_submitted('$SWID', 'TRF_failure001', 424243);" >/dev/null
failed=$(q "SELECT public.record_transfer_result('wd_failurecase0000000001', 'failed', 'TRF_failure001', 'declined by bank', NULL) ->> 'status'")
expect "transfer.failed marks it failed" "failed" "$failed"
split_entries=$(q "SELECT string_agg(account_id || ':' || debit_kobo || ':' || credit_kobo, ',' ORDER BY account_id, id)
                    FROM public.ledger_entries WHERE txn_id = (SELECT id FROM public.ledger_transactions
                                                                WHERE idempotency_key = 'withdrawal_return:$SWID')")
expect "the failure returns 400,000 to vendor and 200,000 to affiliate" \
  "3:0:400000,4:0:200000,8:600000:0" "$split_entries"
split_avail=$(q "SELECT coalesce(sum(available_kobo), 0) FROM public.payout_available_by_account('$SPLIT')")
expect "the split balance is whole again" "700000" "$split_avail"

# ============================================================================
step "Dual approval"
DUAL=88888888-8888-4888-8888-888888888888
seed_user "$DUAL" dual@example.com 60000000 30
account "$DUAL" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$DUAL';" >/dev/null
q "SELECT public.request_withdrawal('$DUAL', 60000000, 'manual', 'wd_dualapproval000000001');" >/dev/null
DWID=$(q "SELECT id FROM public.withdrawals WHERE reference = 'wd_dualapproval000000001'")
one=$(q "SELECT public.approve_withdrawal('$ADMIN1', '$DWID', 'first half')")
contains "the first approval keeps it requested" '"status": "requested"' "$one"
contains "and asks for a second approver" '"needs_second_approval": true' "$one"
same=$(qx "SELECT public.approve_withdrawal('$ADMIN1', '$DWID', 'again')")
contains "the same approver cannot approve twice" "already_approved_by_you" "$same"
two=$(q "SELECT public.approve_withdrawal('$ADMIN2', '$DWID', 'second half') ->> 'status'")
expect "a second, different approver approves it" "approved" "$two"
approvals=$(q "SELECT count(DISTINCT approver) FROM public.withdrawal_approvals WHERE withdrawal_id = '$DWID'")
expect "two approvals by two people are recorded" "2" "$approvals"

# ============================================================================
step "Release, stuck sweep and the overview"
q "SELECT public.claim_withdrawals_for_transfer(20);" >/dev/null
released=$(q "SELECT public.release_claimed_withdrawals(ARRAY['$DWID']::uuid[])")
expect "a claimed withdrawal is released" "1" "$released"
released_state=$(q "SELECT status FROM public.withdrawals WHERE id = '$DWID'")
expect "and is approved again" "approved" "$released_state"

q "SELECT public.claim_withdrawals_for_transfer(20);" >/dev/null
q "UPDATE public.withdrawals SET processed_at = public.payout_now() - interval '40 minutes'
    WHERE id = '$DWID';" >/dev/null
stuck=$(q "SELECT count(*) FROM public.list_stuck_withdrawals('15 minutes')")
expect "a processing withdrawal older than 15 minutes is stuck" "1" "$stuck"
fresh=$(q "SELECT count(*) FROM public.list_stuck_withdrawals('2 hours')")
expect "and is not stuck inside the interval" "0" "$fresh"

overview=$(q "SELECT public.payout_overview('$ADMIN1') -> 'counts' ->> 'processing'")
expect "the overview counts processing withdrawals" "1" "$overview"
forbidden_overview=$(qx "SELECT public.payout_overview('$PLAIN')")
contains "a plain user cannot read the overview" "forbidden" "$forbidden_overview"
rows=$(q "SELECT pg_catalog.jsonb_array_length(public.admin_withdrawals('$ADMIN1', 'processing', 10, NULL) -> 'rows')")
expect "admin_withdrawals lists the processing page" "1" "$rows"
no_code=$(q "SELECT (public.admin_withdrawals('$ADMIN1', NULL, 50, NULL)::text LIKE '%recipient_code%')::text")
expect "admin_withdrawals never returns a recipient code" "false" "$no_code"

# ============================================================================
step "Auto payout candidates"
CAND=99999999-9999-4999-8999-999999999999
seed_user "$CAND" cand@example.com 2000000 30
account "$CAND" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$CAND';" >/dev/null
is_cand=$(q "SELECT count(*) FROM public.list_auto_payout_candidates(100) WHERE user_id = '$CAND'")
expect "a user with an active account and a balance is a candidate" "1" "$is_cand"
q "SELECT public.set_auto_payout('$CAND', false);" >/dev/null
is_cand=$(q "SELECT count(*) FROM public.list_auto_payout_candidates(100) WHERE user_id = '$CAND'")
expect "switching auto payout off removes them" "0" "$is_cand"
q "SELECT public.set_auto_payout('$CAND', true);" >/dev/null
q "SELECT public.request_withdrawal('$CAND', 500000, 'auto', 'wd_candidatealready000001');" >/dev/null
is_cand=$(q "SELECT count(*) FROM public.list_auto_payout_candidates(100) WHERE user_id = '$CAND'")
expect "a user who already requested today is not a candidate" "0" "$is_cand"
set_clock "2026-11-21T10:00:00+01:00"
weekend_cands=$(q "SELECT count(*) FROM public.list_auto_payout_candidates(100)")
expect "no candidates on a Saturday" "0" "$weekend_cands"
set_clock "2026-11-23T10:00:00+01:00"

# ============================================================================
step "Two sessions racing for the same balance"
RACE=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
seed_user "$RACE" race@example.com 500000 30
account "$RACE" >/dev/null
q "UPDATE public.payout_accounts SET frozen_until = NULL WHERE user_id = '$RACE';" >/dev/null
# The first request needs approval and would be refused for a different reason,
# so let this user have a settled first withdrawal out of the way.
q "SELECT public.request_withdrawal('$RACE', 250000, 'manual', 'wd_racefirst000000000001');" >/dev/null
RWID=$(q "SELECT id FROM public.withdrawals WHERE reference = 'wd_racefirst000000000001'")
q "SELECT public.cancel_withdrawal('$RACE', '$RWID');" >/dev/null

RACE_A=$(mktemp /tmp/race_a.XXXXXX.sql)
RACE_B=$(mktemp /tmp/race_b.XXXXXX.sql)
cat > "$RACE_A" <<SQL
BEGIN;
SELECT public.request_withdrawal('$RACE', 500000, 'manual', 'wd_racewinner00000000001') ->> 'status';
SELECT pg_sleep(3);
COMMIT;
SQL
cat > "$RACE_B" <<SQL
SELECT public.request_withdrawal('$RACE', 500000, 'manual', 'wd_raceloser000000000001') ->> 'status';
SQL

( su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB" < "$RACE_A" > /tmp/race_a.out 2>&1 ) &
sleep 1
( su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=0 -q -At -d $DB" < "$RACE_B" > /tmp/race_b.out 2>&1 ) &
wait
rm -f "$RACE_A" "$RACE_B"

winners=$(q "SELECT count(*) FROM public.withdrawals
              WHERE reference IN ('wd_racewinner00000000001', 'wd_raceloser000000000001')")
expect "exactly one racing request is recorded" "1" "$winners"
loser=$(cat /tmp/race_b.out)
contains "the losing session is told insufficient_balance" "insufficient_balance" "$loser"
race_avail=$(q "SELECT coalesce(sum(available_kobo), 0) FROM public.payout_available_by_account('$RACE')")
expect "the racing requests cannot overspend" "0" "$race_avail"

# ============================================================================
step "Privileges and row level security"
as_anon=$(qx "SET ROLE anon; SELECT count(*) FROM public.withdrawals")
contains "anon cannot read withdrawals" "permission denied" "$as_anon"
as_anon_fn=$(qx "SET ROLE anon; SELECT public.request_withdrawal('$OWNER', 500000, 'manual', 'wd_anonforbidden000000001')")
contains "anon cannot execute request_withdrawal" "permission denied" "$as_anon_fn"
as_auth_fn=$(qx "SET ROLE authenticated; SELECT public.withdrawal_preview('$OWNER', 500000)")
contains "authenticated cannot execute withdrawal_preview" "permission denied" "$as_auth_fn"
as_auth_code=$(qx "SET ROLE authenticated; SET request.jwt.claim.sub = '$OWNER'; SELECT recipient_code FROM public.payout_accounts")
contains "authenticated cannot read recipient_code" "permission denied" "$as_auth_code"

# The OWNER is also an admin, so the isolation check uses a plain user who has
# one withdrawal of their own.
own=$(q "SET ROLE authenticated;
         SET request.jwt.claim.sub = '$SPLIT';
         SELECT count(*) FROM public.withdrawals WHERE user_id <> '$SPLIT';")
expect "a user sees no other user's withdrawals" "0" "$own"
own_rows=$(q "SET ROLE authenticated;
              SET request.jwt.claim.sub = '$SPLIT';
              SELECT count(*) > 0 FROM public.withdrawals WHERE user_id = '$SPLIT';")
expect "a user sees their own withdrawals" "t" "$own_rows"
staff_rows=$(q "SET ROLE authenticated;
                SET request.jwt.claim.sub = '$ADMIN1';
                SELECT count(*) > 1 FROM public.withdrawals;")
expect "an admin sees every withdrawal" "t" "$staff_rows"
safe_cols=$(q "SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'payout_accounts_safe'
                  AND column_name = 'recipient_code'")
expect "the safe view has no recipient_code column" "0" "$safe_cols"
safe_rows=$(q "SET ROLE authenticated;
               SET request.jwt.claim.sub = '$SPLIT';
               SELECT count(*) FROM public.payout_accounts_safe;")
expect "a user reads their own payout account through the view" "1" "$safe_rows"

step "The ledger is still append-only"
ledger_update=$(qx "UPDATE public.ledger_entries SET debit_kobo = 1 WHERE id = (SELECT min(id) FROM public.ledger_entries)")
contains "a ledger entry cannot be updated" "ledger_entries_append_only" "$ledger_update"
ledger_delete=$(qx "DELETE FROM public.ledger_entries WHERE id = (SELECT min(id) FROM public.ledger_entries)")
contains "a ledger entry cannot be deleted" "ledger_entries_append_only" "$ledger_delete"

# ============================================================================
step "Commented rollback block, then re-apply"
ROLLBACK_SQL=$(mktemp /tmp/affilova_rollback.XXXXXX.sql)
awk '/^-- ROLLBACK/,0' "$MIGRATION" | sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' | sed 's/^-- //' | sed 's/^--$//' > "$ROLLBACK_SQL"
if run_file "$ROLLBACK_SQL" >/dev/null 2>&1; then pass "rollback block executed"; else fail "rollback block executed"; fi
rm -f "$ROLLBACK_SQL"

tables=$(q "SELECT count(*) FROM pg_class WHERE relname IN ('payout_accounts', 'payout_preferences', 'withdrawals', 'withdrawal_approvals')
             AND relnamespace = 'public'::regnamespace")
expect "rollback dropped the payout tables" "0" "$tables"
mig=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261122000100'")
expect "rollback removed the migration row" "0" "$mig"

if run_file "$MIGRATION" >/dev/null 2>&1; then pass "re-applied after rollback"; else fail "re-applied after rollback"; fi
back=$(q "SELECT count(*) FROM public.app_migrations WHERE version = '20261122000100'")
expect "the re-applied migration is recorded" "1" "$back"
out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$VERIFY" 2>&1)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
expect "the verify file passes again" "0" "$bad"

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ] || exit 1
