#!/usr/bin/env bash
# ============================================================================
# Affiliate tracking harness (migration 20261118000200_affiliate_tracking)
#
# Builds a throwaway local Postgres database that mimics the parts of Supabase
# the migrations depend on, applies EVERY migration in order, then exercises the
# whole tracking feature:
#
#   1. every earlier verify file, then this migration's verify file
#   2. the migration applied twice from the same database
#   3. affiliate_can_promote for every approval mode and every access state
#   4. link creation: codes, aliases, labels, the 50 and 500 limits
#   5. the invite lifecycle, including two sessions taking the last use
#   6. access requests and decisions, and blocked-archives-links
#   7. the click uniqueness window (10 minutes vs 31 minutes)
#   8. get_click_attribution: wrong product, closed window, blocked affiliate
#   9. create_order attribution through the new check, in every case
#  10. a full flow: click, order, payment, rollup, daily stats and the ledger
#  11. the rollup is idempotent
#  12. anomaly flags are created once, not on every run
#  13. the 13 month purge
#  14. RLS: an affiliate sees only their own rows, clicks are service-role only,
#      a vendor sees only their products' access rows, risk flags are staff-only
#  15. the commented rollback, then the migration re-applied
#
# It is deliberately NOT part of `pnpm test`: it needs a local Postgres server
# and a superuser connection.
#
# Usage:  supabase/tests/affiliate_tracking_test.sh
# Env:    AFFILOVA_TEST_DB   database name (default affilova_affiliate_test)
#         SUPER_USER         OS user that owns the server (default postgres)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AFFILOVA_TEST_DB:-affilova_affiliate_test}"
ROLLBACK_DB="${DB}_rollback"
SUPER_USER="${SUPER_USER:-postgres}"
MIGRATION="$ROOT/supabase/migrations/20261118000200_affiliate_tracking.sql"
VERIFY="$ROOT/supabase/verify/20261118000200_affiliate_tracking_verify.sql"

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

q() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${2:-$DB} -c \"$1\"" 2>&1; }
run_file() {
  local f="$1" db="${2:-$DB}"
  chmod 644 "$f"
  su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -d $db" < "$f"
}
run_sql() { su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d ${SQL_DB:-$DB}" 2>&1; }

# A count read as a browser role. SET and RESET print nothing with -q, but the
# answer is taken from the numeric lines only, so the helper cannot be fooled by
# a notice.
rls_count() { run_sql | grep -E '^[0-9]+$' | tail -1; }

# assert_error <name> <expected fragment> ; SQL on stdin
assert_error() {
  local name="$1" want="$2" out
  out=$(run_sql)
  if printf '%s' "$out" | grep -q "$want"; then
    pass "$name"
  else
    fail "$name" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"
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

tmpfile() { mktemp /tmp/affilova_affiliate.XXXXXX.sql; }

bootstrap() {
  local db="$1"
  su "$SUPER_USER" -c "psql -q -c \"DROP DATABASE IF EXISTS $db\"" >/dev/null 2>&1
  su "$SUPER_USER" -c "psql -q -c \"CREATE DATABASE $db\"" >/dev/null || return 1
  local f; f=$(tmpfile)
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
SQL
  run_file "$f" "$db"
  local status=$?
  rm -f "$f"
  return $status
}

apply_migrations() {
  local db="$1" f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    run_file "$f" "$db" >/dev/null 2>&1 || { echo "migration failed: $f"; return 1; }
  done
  return 0
}

# ---------------------------------------------------------------------------
# 0. A fresh database with every migration applied
# ---------------------------------------------------------------------------
step "Building $DB from an empty database"
bootstrap "$DB" >/dev/null || { echo "bootstrap failed"; exit 1; }
apply_migrations "$DB" || exit 1

count=$(q "select count(*) from public.app_migrations")
if [ "$count" = "13" ]; then pass "thirteen migrations applied"; else fail "thirteen migrations applied" "got $count"; fi

step "Verify files"
for v in "$ROOT"/supabase/verify/*.sql; do
  out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$v" 2>&1)
  total=$(printf '%s\n' "$out" | grep -c '|' || true)
  bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
  name=$(basename "$v")
  if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
    pass "$name ($total checks)"
  else
    fail "$name" "$bad false of $total"
    printf '%s\n' "$out" | grep '|f$' | sed 's/^/       /'
  fi
done

step "The migration applied twice"
if run_file "$MIGRATION" >/dev/null 2>&1; then pass "second run succeeds"; else fail "second run succeeds"; fi
again=$(q "select count(*) from public.app_migrations where version = '20261118000200'")
if [ "$again" = "1" ]; then pass "one app_migrations row"; else fail "one app_migrations row" "got $again"; fi

# ---------------------------------------------------------------------------
# 1. Seed
# ---------------------------------------------------------------------------
step "Seed"

V1='11111111-1111-4111-8111-111111111101'
V2='11111111-1111-4111-8111-111111111102'
A1='22222222-2222-4222-8222-222222222201'
A2='22222222-2222-4222-8222-222222222202'
A3='22222222-2222-4222-8222-222222222203'
A_SUSPENDED='22222222-2222-4222-8222-222222222204'
NO_ROLE='22222222-2222-4222-8222-222222222205'
BUYER='33333333-3333-4333-8333-333333333301'
ADMIN='44444444-4444-4444-8444-444444444401'
MODERATOR='44444444-4444-4444-8444-444444444402'
SUPPORT='44444444-4444-4444-8444-444444444403'
P_OPEN='55555555-5555-4555-8555-555555555501'
P_APPROVAL='55555555-5555-4555-8555-555555555502'
P_INVITE='55555555-5555-4555-8555-555555555503'
P_DRAFT='55555555-5555-4555-8555-555555555504'
P_V2='55555555-5555-4555-8555-555555555505'

run_sql >/dev/null <<SQL
INSERT INTO auth.users (id, email) VALUES
  ('$V1','vendor1@example.com'),
  ('$V2','vendor2@example.com'),
  ('$A1','aff1@example.com'),
  ('$A2','aff2@example.com'),
  ('$A3','aff3@example.com'),
  ('$A_SUSPENDED','aff4@example.com'),
  ('$NO_ROLE','norole@example.com'),
  ('$BUYER','buyer@example.com'),
  ('$ADMIN','admin@example.com'),
  ('$MODERATOR','moderator@example.com'),
  ('$SUPPORT','support@example.com');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('$V1','vendor'),
  ('$V2','vendor'),
  ('$A1','affiliate'),
  ('$A2','affiliate'),
  ('$A3','affiliate'),
  ('$A_SUSPENDED','affiliate'),
  ('$ADMIN','admin'),
  ('$MODERATOR','moderator'),
  ('$SUPPORT','support');

INSERT INTO public.vendor_profiles (user_id, business_name, slug, support_email) VALUES
  ('$V1','Vendor One','vendor-one','one@vendor.test'),
  ('$V2','Vendor Two','vendor-two','two@vendor.test');

INSERT INTO public.affiliate_profiles (user_id, username) VALUES
  ('$A1','affiliate_one'),
  ('$A2','affiliate_two'),
  ('$A3','affiliate_three'),
  ('$A_SUSPENDED','affiliate_four');

UPDATE public.affiliate_profiles SET status = 'suspended' WHERE user_id = '$A_SUSPENDED';

INSERT INTO public.products
  (id, vendor_id, category_id, title, slug, short_description, description, price_kobo, commission_bps, status, affiliate_approval)
VALUES
  ('$P_OPEN',     '$V1', 1, 'Open Product',     'open-product',     'A short description here', 'Long description', 500000, 2000, 'live',  'open'),
  ('$P_APPROVAL', '$V1', 1, 'Approval Product', 'approval-product', 'A short description here', 'Long description', 500000, 2000, 'live',  'approval'),
  ('$P_INVITE',   '$V1', 1, 'Invite Product',   'invite-product',   'A short description here', 'Long description', 500000, 2000, 'live',  'invite'),
  ('$P_DRAFT',    '$V1', 1, 'Draft Product',    'draft-product',    'A short description here', 'Long description', 500000, 2000, 'draft', 'open'),
  ('$P_V2',       '$V2', 1, 'Other Store',      'other-store',      'A short description here', 'Long description', 500000, 2000, 'live',  'open');
SQL
pass "seed inserted"

# ---------------------------------------------------------------------------
# 2. affiliate_can_promote
# ---------------------------------------------------------------------------
step "affiliate_can_promote"

assert_value "open product, active affiliate" "t" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_OPEN');
SQL

assert_value "approval product, no access row" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_APPROVAL');
SQL

assert_value "invite product, no access row" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_INVITE');
SQL

assert_value "draft product is never promotable" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_DRAFT');
SQL

assert_value "suspended affiliate profile" "f" <<SQL
SELECT public.affiliate_can_promote('$A_SUSPENDED','$P_OPEN');
SQL

assert_value "user without the affiliate role" "f" <<SQL
SELECT public.affiliate_can_promote('$NO_ROLE','$P_OPEN');
SQL

assert_value "null affiliate" "f" <<SQL
SELECT public.affiliate_can_promote(NULL,'$P_OPEN');
SQL

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_product_access (affiliate_id, product_id, status) VALUES
  ('$A1','$P_APPROVAL','pending'),
  ('$A1','$P_INVITE','approved'),
  ('$A2','$P_OPEN','blocked');
SQL

assert_value "approval product, pending" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_APPROVAL');
SQL

assert_value "invite product, approved row" "t" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_INVITE');
SQL

assert_value "open product, blocked row wins" "f" <<SQL
SELECT public.affiliate_can_promote('$A2','$P_OPEN');
SQL

run_sql >/dev/null <<SQL
UPDATE public.affiliate_product_access SET status = 'approved' WHERE affiliate_id = '$A1' AND product_id = '$P_APPROVAL';
SQL

assert_value "approval product, approved" "t" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_APPROVAL');
SQL

run_sql >/dev/null <<SQL
UPDATE public.affiliate_product_access SET status = 'rejected' WHERE affiliate_id = '$A1' AND product_id = '$P_APPROVAL';
SQL

assert_value "approval product, rejected" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_APPROVAL');
SQL

run_sql >/dev/null <<SQL
UPDATE public.affiliate_product_access SET status = 'approved' WHERE affiliate_id = '$A1' AND product_id = '$P_APPROVAL';
UPDATE public.vendor_profiles SET status = 'suspended' WHERE user_id = '$V2';
SQL

assert_value "suspended vendor" "f" <<SQL
SELECT public.affiliate_can_promote('$A1','$P_V2');
SQL

run_sql >/dev/null <<SQL
UPDATE public.vendor_profiles SET status = 'active' WHERE user_id = '$V2';
SQL

# ---------------------------------------------------------------------------
# 3. Links
# ---------------------------------------------------------------------------
step "Creating links"

LINK_JSON=$(q "select public.create_affiliate_link('$A1','$P_OPEN','main','ada-deals')::text")
CODE=$(q "select code from public.affiliate_links where affiliate_id = '$A1' and product_id = '$P_OPEN' and label = 'main'")
if printf '%s' "$LINK_JSON" | grep -q '"code"'; then pass "a link is created"; else fail "a link is created" "$LINK_JSON"; fi

if printf '%s' "$CODE" | grep -Eq '^[a-hj-km-np-z2-9]{8}$'; then
  pass "the code is eight characters from the allowed alphabet"
else
  fail "the code is eight characters from the allowed alphabet" "got $CODE"
fi

assert_value "the alias is stored" "ada-deals" <<SQL
SELECT alias::text FROM public.affiliate_links WHERE affiliate_id = '$A1' AND product_id = '$P_OPEN' AND label = 'main';
SQL

assert_error "a taken alias is refused" "alias_taken" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','second','ada-deals');
SQL

assert_value "an alias is normalised to lower case" "ada-second" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','alias-test','Ada-Second') ->> 'alias';
SQL

assert_error "an alias is unique whatever the case" "alias_taken" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','alias-test-2','ADA-SECOND');
SQL

assert_error "a reserved alias is refused" "invalid_alias" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','fourth','admin');
SQL

assert_error "a two character alias is refused" "invalid_alias" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','fifth','ab');
SQL

assert_error "an alias with an underscore is refused" "invalid_alias" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN','sixth','ada_deals');
SQL

assert_error "a 61 character label is refused" "invalid_label" <<SQL
SELECT public.create_affiliate_link('$A1','$P_OPEN', repeat('x',61), NULL);
SQL

q "select public.create_affiliate_link('$A1','$P_V2',NULL,NULL)" >/dev/null

assert_error "two unlabelled links for one product are refused" "label_taken" <<SQL
SELECT public.create_affiliate_link('$A1','$P_V2', NULL, NULL);
SQL

assert_error "a product the affiliate cannot promote is refused" "not_allowed" <<SQL
SELECT public.create_affiliate_link('$A2','$P_OPEN', 'blocked-one', NULL);
SQL

assert_error "archiving someone else's link is not found" "not_found" <<SQL
SELECT public.archive_affiliate_link('$A2', (SELECT id FROM public.affiliate_links WHERE affiliate_id = '$A1' LIMIT 1));
SQL

# 48 more labels take the product to 49 active links.
out=$(run_sql <<SQL
DO \$\$
DECLARE i int;
BEGIN
  FOR i IN 1..48 LOOP
    PERFORM public.create_affiliate_link('$A1','$P_V2', 'label-' || i, NULL);
  END LOOP;
END \$\$;
SQL
)
if [ -n "$out" ]; then fail "the 48 extra links are created" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"; fi

active=$(q "select count(*) from public.affiliate_links where affiliate_id = '$A1' and product_id = '$P_V2' and status = 'active'")
if [ "$active" = "49" ]; then pass "49 active links so far"; else fail "49 active links so far" "got $active"; fi

q "select public.create_affiliate_link('$A1','$P_V2', 'the-fiftieth', NULL)" >/dev/null

assert_value "the 50th active link is allowed" "50" <<SQL
SELECT count(*) FROM public.affiliate_links
WHERE affiliate_id = '$A1' AND product_id = '$P_V2' AND status = 'active';
SQL

assert_error "the 51st active link for one product is refused" "link_limit" <<SQL
SELECT public.create_affiliate_link('$A1','$P_V2', 'the-fifty-first', NULL);
SQL

# 500 links for A2 across ten other products, then one more.
out=$(run_sql <<SQL
DO \$\$
DECLARE
  p uuid;
  n int;
  i int;
BEGIN
  FOR n IN 1..10 LOOP
    p := ('66666666-6666-4666-8666-6666666666' || lpad(n::text, 2, '0'))::uuid;
    INSERT INTO public.products
      (id, vendor_id, category_id, title, slug, short_description, description, price_kobo, commission_bps, status, affiliate_approval)
    VALUES
      (p, '$V1', 1, 'Bulk ' || n, 'bulk-' || n, 'A short description here', 'Long description', 500000, 2000, 'live', 'open');

    FOR i IN 1..50 LOOP
      INSERT INTO public.affiliate_links (affiliate_id, product_id, code, label)
      VALUES (
        '$A2', p,
        translate(substr(md5(p::text || i::text), 1, 8), '01', '78'),
        'bulk-' || i
      );
    END LOOP;
  END LOOP;
END \$\$;
SQL
)
if [ -n "$out" ]; then fail "the 500 bulk links are created" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"; fi

bulk=$(q "select count(*) from public.affiliate_links where affiliate_id = '$A2' and status = 'active'")
if [ "$bulk" = "500" ]; then pass "500 active links for one affiliate"; else fail "500 active links for one affiliate" "got $bulk"; fi

assert_error "the 501st active link for one affiliate is refused" "link_limit" <<SQL
SELECT public.create_affiliate_link('$A2','$P_V2', 'over-the-line', NULL);
SQL

# ---------------------------------------------------------------------------
# 4. Invites
# ---------------------------------------------------------------------------
step "Invites"

H1=$(printf 'a%.0s' {1..64})
H2=$(printf 'b%.0s' {1..64})
H3=$(printf 'c%.0s' {1..64})
H4=$(printf 'd%.0s' {1..64})
H5=$(printf 'e%.0s' {1..64})

assert_value "a vendor can create an invite" "t" <<SQL
SELECT public.create_affiliate_invite('$V1','$P_INVITE','$H1',1,7) IS NOT NULL;
SQL

assert_error "a non-vendor cannot create an invite" "forbidden" <<SQL
SELECT public.create_affiliate_invite('$A1','$P_INVITE','$H2',1,7);
SQL

assert_error "a short token hash is refused" "invalid_token" <<SQL
SELECT public.create_affiliate_invite('$V1','$P_INVITE','abc',1,7);
SQL

assert_error "zero uses is refused" "invalid_max_uses" <<SQL
SELECT public.create_affiliate_invite('$V1','$P_INVITE','$H3',0,7);
SQL

assert_error "a 366 day invite is refused" "invalid_expiry" <<SQL
SELECT public.create_affiliate_invite('$V1','$P_INVITE','$H4',1,366);
SQL

assert_value "a valid invite is accepted" "approved" <<SQL
SELECT public.accept_affiliate_invite('$A2','$H1') ->> 'status';
SQL

assert_value "the accepted invite is recorded as approved" "approved" <<SQL
SELECT status FROM public.affiliate_product_access WHERE affiliate_id = '$A2' AND product_id = '$P_INVITE';
SQL

assert_value "the use was counted" "1" <<SQL
SELECT uses FROM public.affiliate_invites WHERE token_hash = '$H1';
SQL

assert_error "an exhausted invite is refused" "invite_invalid" <<SQL
SELECT public.accept_affiliate_invite('$A2','$H1');
SQL

assert_error "an unknown token is refused" "invite_invalid" <<SQL
SELECT public.accept_affiliate_invite('$A2', repeat('f',64));
SQL

assert_error "a non-affiliate cannot accept" "invite_invalid" <<SQL
SELECT public.accept_affiliate_invite('$NO_ROLE', repeat('f',64));
SQL

q "select public.create_affiliate_invite('$V1','$P_INVITE','$H2',5,7)" >/dev/null
q "update public.affiliate_invites set expires_at = now() - interval '1 hour' where token_hash = '$H2'" >/dev/null

assert_error "an expired invite is refused" "invite_invalid" <<SQL
SELECT public.accept_affiliate_invite('$A3','$H2');
SQL

q "select public.create_affiliate_invite('$V1','$P_INVITE','$H3',5,7)" >/dev/null
q "update public.affiliate_invites set revoked_at = now() where token_hash = '$H3'" >/dev/null

assert_error "a revoked invite is refused" "invite_invalid" <<SQL
SELECT public.accept_affiliate_invite('$A3','$H3');
SQL

step "Invites: two sessions taking the last use"

q "select public.create_affiliate_invite('$V1','$P_INVITE','$H5',1,7)" >/dev/null

A=$(tmpfile); B=$(tmpfile)
cat > "$A" <<SQL
BEGIN;
SELECT public.accept_affiliate_invite('$A3','$H5');
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$B" <<SQL
SELECT public.accept_affiliate_invite('$A1','$H5');
SQL
chmod 644 "$A" "$B"

su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$A" > "$A.out" 2>&1 &
apid=$!
sleep 0.6
su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $DB" < "$B" > "$B.out" 2>&1
wait "$apid"

a_ok=$(grep -c '"approved"' "$A.out" || true)
b_ok=$(grep -c '"approved"' "$B.out" || true)
b_bad=$(grep -c 'invite_invalid' "$B.out" || true)
uses=$(q "select uses from public.affiliate_invites where token_hash = '$H5'")

if [ $((a_ok + b_ok)) -eq 1 ] && [ "$b_bad" = "1" ] && [ "$uses" = "1" ]; then
  pass "exactly one session took the last use"
else
  fail "exactly one session took the last use" "A(ok=$a_ok) B(ok=$b_ok invalid=$b_bad) uses=$uses"
fi
rm -f "$A" "$A.out" "$B" "$B.out"

# ---------------------------------------------------------------------------
# 5. Access requests and decisions
# ---------------------------------------------------------------------------
step "Access requests and decisions"

assert_error "an open product takes no access request" "not_allowed" <<SQL
SELECT public.request_product_access('$A3','$P_OPEN','please');
SQL

assert_value "an approval product takes a request" "pending" <<SQL
SELECT public.request_product_access('$A3','$P_APPROVAL','please');
SQL

assert_value "a second request returns the same status" "pending" <<SQL
SELECT public.request_product_access('$A3','$P_APPROVAL','again');
SQL

assert_value "one row per affiliate and product" "1" <<SQL
SELECT count(*) FROM public.affiliate_product_access WHERE affiliate_id = '$A3' AND product_id = '$P_APPROVAL';
SQL

assert_error "a stranger cannot decide" "forbidden" <<SQL
SELECT public.decide_product_access('$A2','$A3','$P_APPROVAL','approved',NULL);
SQL

assert_error "an invalid decision is refused" "invalid_decision" <<SQL
SELECT public.decide_product_access('$V1','$A3','$P_APPROVAL','maybe',NULL);
SQL

q "select public.decide_product_access('$V1','$A3','$P_APPROVAL','approved',NULL)" >/dev/null

assert_value "the vendor's approval opens the product" "t" <<SQL
SELECT public.affiliate_can_promote('$A3','$P_APPROVAL');
SQL

q "select public.create_affiliate_link('$A3','$P_APPROVAL','after-approval',NULL)" >/dev/null
q "select public.decide_product_access('$ADMIN','$A3','$P_APPROVAL','blocked','clicks from one address')" >/dev/null

assert_value "a block closes the product" "f" <<SQL
SELECT public.affiliate_can_promote('$A3','$P_APPROVAL');
SQL

assert_value "a block archives the affiliate's active links for that product" "0" <<SQL
SELECT count(*) FROM public.affiliate_links
WHERE affiliate_id = '$A3' AND product_id = '$P_APPROVAL' AND status = 'active';
SQL

assert_error "a blocked affiliate cannot ask again" "blocked" <<SQL
SELECT public.request_product_access('$A3','$P_APPROVAL','let me back in');
SQL

assert_value "the decision is audited" "t" <<SQL
SELECT EXISTS (
  SELECT 1 FROM public.audit_log
  WHERE action = 'affiliate_access.decided'
    AND entity_id = '$A3:$P_APPROVAL'
);
SQL

# ---------------------------------------------------------------------------
# 6. Clicks
# ---------------------------------------------------------------------------
step "Recording clicks"

C_MAIN=$(q "select code from public.affiliate_links where affiliate_id = '$A1' and product_id = '$P_OPEN' and label = 'main'")

assert_value "an unknown code answers ok false" "false" <<SQL
SELECT (public.record_click('77777777-7777-4777-8777-777777777701','zzzzzzzz',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) ->> 'ok');
SQL

assert_value "a human click resolves the product" "open-product" <<SQL
SELECT (public.record_click('77777777-7777-4777-8777-777777777702','$C_MAIN','iphash-1','uahash-1','news.example.com','ng','mobile','s1','s2','s3','newsletter','email','launch') ->> 'product_slug');
SQL

assert_value "the first click from a device is unique" "t" <<SQL
SELECT is_unique FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777702';
SQL

assert_value "the country is stored in upper case" "NG" <<SQL
SELECT country FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777702';
SQL

assert_value "only the referrer host is stored" "news.example.com" <<SQL
SELECT referrer_host FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777702';
SQL

assert_value "a click by alias resolves too" "open-product" <<SQL
SELECT (public.record_click('77777777-7777-4777-8777-777777777703','ADA-DEALS',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) ->> 'product_slug');
SQL

q "update public.affiliate_clicks set created_at = now() - interval '10 minutes' where id = '77777777-7777-4777-8777-777777777702'" >/dev/null
q "select public.record_click('77777777-7777-4777-8777-777777777704','$C_MAIN','iphash-1','uahash-1',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

assert_value "a second click ten minutes later is not unique" "f" <<SQL
SELECT is_unique FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777704';
SQL

q "select public.record_click('77777777-7777-4777-8777-777777777708','$C_MAIN','iphash-2','uahash-2',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null
q "update public.affiliate_clicks set created_at = now() - interval '31 minutes' where id = '77777777-7777-4777-8777-777777777708'" >/dev/null
q "select public.record_click('77777777-7777-4777-8777-777777777709','$C_MAIN','iphash-2','uahash-2',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

assert_value "a click thirty-one minutes later is unique again" "t" <<SQL
SELECT is_unique FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777709';
SQL

q "select public.record_click('77777777-7777-4777-8777-777777777710','$C_MAIN','iphash-3','uahash-3',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null
q "update public.affiliate_clicks set created_at = now() - interval '10 minutes' where id = '77777777-7777-4777-8777-777777777710'" >/dev/null
q "select public.record_click('77777777-7777-4777-8777-777777777711','$C_MAIN','iphash-3','uahash-3',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

assert_value "the same device ten minutes later is not unique" "f" <<SQL
SELECT is_unique FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777711';
SQL

q "update public.affiliate_links set status = 'archived' where affiliate_id = '$A1' and product_id = '$P_V2' and label = 'label-1'" >/dev/null
C_ARCHIVED=$(q "select code from public.affiliate_links where affiliate_id = '$A1' and label = 'label-1'")

assert_value "an archived link answers ok false" "false" <<SQL
SELECT (public.record_click('77777777-7777-4777-8777-777777777706','$C_ARCHIVED',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) ->> 'ok');
SQL

# A live link whose affiliate was blocked afterwards. The row is inserted
# directly because create_affiliate_link would refuse it, which is the point.
q "insert into public.affiliate_links (affiliate_id, product_id, code, label) values ('$A2','$P_OPEN','bcdmnpqr','blocked-live')" >/dev/null

assert_value "a blocked affiliate's live link answers ok false" "false" <<SQL
SELECT (public.record_click('77777777-7777-4777-8777-777777777707','bcdmnpqr',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) ->> 'ok');
SQL

# ---------------------------------------------------------------------------
# 7. Attribution
# ---------------------------------------------------------------------------
step "get_click_attribution"

assert_value "a fresh click attributes its affiliate" "$A1" <<SQL
SELECT public.get_click_attribution('77777777-7777-4777-8777-777777777709','$P_OPEN');
SQL

assert_value "a click for another product attributes nobody" "NULL" <<SQL
SELECT coalesce(public.get_click_attribution('77777777-7777-4777-8777-777777777709','$P_APPROVAL')::text,'NULL');
SQL

assert_value "an unknown click attributes nobody" "NULL" <<SQL
SELECT coalesce(public.get_click_attribution('77777777-7777-4777-8777-777777777799','$P_OPEN')::text,'NULL');
SQL

q "update public.affiliate_clicks set created_at = now() - interval '31 days' where id = '77777777-7777-4777-8777-777777777709'" >/dev/null

assert_value "a click older than the 30 day window attributes nobody" "NULL" <<SQL
SELECT coalesce(public.get_click_attribution('77777777-7777-4777-8777-777777777709','$P_OPEN')::text,'NULL');
SQL

q "update public.affiliate_clicks set created_at = now() where id = '77777777-7777-4777-8777-777777777709'" >/dev/null
q "insert into public.affiliate_product_access (affiliate_id, product_id, status) values ('$A1','$P_OPEN','blocked') on conflict (affiliate_id, product_id) do update set status = 'blocked'" >/dev/null

assert_value "an affiliate blocked later attributes nobody" "NULL" <<SQL
SELECT coalesce(public.get_click_attribution('77777777-7777-4777-8777-777777777709','$P_OPEN')::text,'NULL');
SQL

q "delete from public.affiliate_product_access where affiliate_id = '$A1' and product_id = '$P_OPEN'" >/dev/null

# ---------------------------------------------------------------------------
# 8. create_order attribution
# ---------------------------------------------------------------------------
step "create_order attribution"

CLICK_OPEN='77777777-7777-4777-8777-777777777709'

assert_value "open product with a valid click keeps the affiliate" "true" <<SQL
SELECT (public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$A1','$CLICK_OPEN',NULL,'REF-OPEN-1') ->> 'affiliate_applied');
SQL

q "select public.create_affiliate_link('$A3','$P_INVITE','invite-link',NULL)" >/dev/null
q "select public.record_click('77777777-7777-4777-8777-777777777801',(select code from public.affiliate_links where affiliate_id='$A3' and product_id='$P_INVITE'),'iphash-9','uahash-9',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

assert_value "approval product with approved access keeps the affiliate" "true" <<SQL
SELECT (public.create_order('$BUYER','buyer@example.com','Buyer','$P_INVITE','$A3','77777777-7777-4777-8777-777777777801',NULL,'REF-INVITE-1') ->> 'affiliate_applied');
SQL

q "delete from public.affiliate_product_access where affiliate_id = '$A3' and product_id = '$P_INVITE'" >/dev/null
q "select public.record_click('77777777-7777-4777-8777-777777777802',(select code from public.affiliate_links where affiliate_id='$A3' and product_id='$P_INVITE'),'iphash-10','uahash-10',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

assert_value "approval product without access drops the affiliate" "false" <<SQL
SELECT (public.create_order('$BUYER','buyer@example.com','Buyer','$P_INVITE','$A3','77777777-7777-4777-8777-777777777802',NULL,'REF-INVITE-2') ->> 'affiliate_applied');
SQL

assert_value "a vendor cannot be their own affiliate" "false" <<SQL
SELECT (public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$V1','$CLICK_OPEN',NULL,'REF-SELF-1') ->> 'affiliate_applied');
SQL

assert_value "a buyer cannot be their own affiliate" "false" <<SQL
SELECT (public.create_order('$A1','aff1@example.com','Buyer','$P_OPEN','$A1','$CLICK_OPEN',NULL,'REF-SELF-2') ->> 'affiliate_applied');
SQL

# ---------------------------------------------------------------------------
# 9. Full flow
# ---------------------------------------------------------------------------
step "Full flow: click, order, payment, rollup"

q "select public.create_affiliate_link('$A1','$P_OPEN','flow-link',NULL)" >/dev/null
C_FLOW=$(q "select code from public.affiliate_links where affiliate_id = '$A1' and product_id = '$P_OPEN' and label = 'flow-link'")

CLICK_FLOW='77777777-7777-4777-8777-777777777901'
q "select public.record_click('$CLICK_FLOW','$C_FLOW','iphash-flow','uahash-flow','ref.example','NG','desktop',NULL,NULL,NULL,NULL,NULL,NULL)" >/dev/null

ORDER_JSON=$(q "select public.create_order('$BUYER','buyer@example.com','Buyer','$P_OPEN','$A1','$CLICK_FLOW',NULL,'REF-FLOW-1')::text")
ORDER_ID=$(q "select id from public.orders where paystack_reference = 'REF-FLOW-1'")
if printf '%s' "$ORDER_JSON" | grep -q '"affiliate_applied": true'; then
  pass "the order carries the affiliate"
else
  fail "the order carries the affiliate" "$ORDER_JSON"
fi

PAID=$(q "select (public.process_paid_order('REF-FLOW-1', 9901, 500000, 'NGN', 25000, 'card', now()) ->> 'status')")
if [ "$PAID" = "processed" ]; then pass "the order is paid"; else fail "the order is paid" "got $PAID"; fi

TODAY=$(q "select (now() at time zone 'Africa/Lagos')::date")
q "select public.rollup_affiliate_stats('$TODAY','$TODAY')" >/dev/null

assert_value "the rollup records the click and the order" "1|1|1" <<SQL
SELECT clicks || '|' || unique_clicks || '|' || orders
FROM public.affiliate_daily_stats
WHERE affiliate_id = '$A1' AND product_id = '$P_OPEN'
  AND link_id = (SELECT id FROM public.affiliate_links WHERE code = '$C_FLOW');
SQL

assert_value "the rollup records the unit price as revenue" "500000" <<SQL
SELECT order_revenue_kobo FROM public.affiliate_daily_stats
WHERE affiliate_id = '$A1' AND product_id = '$P_OPEN'
  AND link_id = (SELECT id FROM public.affiliate_links WHERE code = '$C_FLOW');
SQL

assert_value "the rollup records the commission" "100000" <<SQL
SELECT commission_kobo FROM public.affiliate_daily_stats
WHERE affiliate_id = '$A1' AND product_id = '$P_OPEN'
  AND link_id = (SELECT id FROM public.affiliate_links WHERE code = '$C_FLOW');
SQL

assert_value "the ledger credits the affiliate" "100000" <<SQL
SELECT credit_kobo FROM public.ledger_entries
WHERE account_id = 4 AND party_id = '$A1'
  AND txn_id = (SELECT id FROM public.ledger_transactions WHERE ref_id = '$ORDER_ID'::uuid);
SQL

assert_value "the ledger balances" "0" <<SQL
SELECT sum(debit_kobo) - sum(credit_kobo)
FROM public.ledger_entries
WHERE txn_id = (SELECT id FROM public.ledger_transactions WHERE ref_id = '$ORDER_ID'::uuid);
SQL

step "The rollup is idempotent"

before=$(q "select string_agg(clicks || ':' || unique_clicks || ':' || orders || ':' || order_revenue_kobo || ':' || commission_kobo, ',' ORDER BY affiliate_id, product_id, coalesce(link_id,'00000000-0000-0000-0000-000000000000'::uuid)) from public.affiliate_daily_stats")
q "select public.rollup_affiliate_stats('$TODAY','$TODAY')" >/dev/null
q "select public.rollup_affiliate_stats('$TODAY','$TODAY')" >/dev/null
after=$(q "select string_agg(clicks || ':' || unique_clicks || ':' || orders || ':' || order_revenue_kobo || ':' || commission_kobo, ',' ORDER BY affiliate_id, product_id, coalesce(link_id,'00000000-0000-0000-0000-000000000000'::uuid)) from public.affiliate_daily_stats")

if [ "$before" = "$after" ] && [ -n "$before" ]; then
  pass "two more runs change nothing"
else
  fail "two more runs change nothing" "before=$before after=$after"
fi

assert_error "an inverted range is refused" "invalid_range" <<SQL
SELECT public.rollup_affiliate_stats('$TODAY'::date, '$TODAY'::date - 1);
SQL

# ---------------------------------------------------------------------------
# 10. Anomalies
# ---------------------------------------------------------------------------
step "Anomaly flags"

C_BURST=$(q "select code from public.affiliate_links where affiliate_id = '$A2' order by code limit 1")

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks (id, link_id, affiliate_id, product_id, ip_hash, ua_hash, is_unique, created_at)
SELECT gen_random_uuid(),
       (SELECT id FROM public.affiliate_links WHERE code = '$C_BURST'),
       '$A2',
       (SELECT product_id FROM public.affiliate_links WHERE code = '$C_BURST'),
       'burst-ip', 'burst-ua-' || n::text, false, now() - interval '5 minutes'
FROM generate_series(1, 201) AS n;
SQL

created=$(q "select public.scan_click_anomalies()")
if [ "$created" = "1" ]; then pass "one burst flag is created"; else fail "one burst flag is created" "got $created"; fi

assert_value "the burst flag is for the right affiliate" "$A2" <<SQL
SELECT affiliate_id FROM public.risk_flags WHERE kind = 'click_burst';
SQL

created=$(q "select public.scan_click_anomalies()")
if [ "$created" = "0" ]; then pass "a second scan creates no duplicate"; else fail "a second scan creates no duplicate" "got $created"; fi

assert_value "there is still exactly one burst flag" "1" <<SQL
SELECT count(*) FROM public.risk_flags WHERE kind = 'click_burst';
SQL

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks (id, link_id, affiliate_id, product_id, ip_hash, ua_hash, is_unique, created_at)
SELECT gen_random_uuid(),
       (SELECT id FROM public.affiliate_links WHERE affiliate_id = '$A3' LIMIT 1),
       '$A3',
       (SELECT product_id FROM public.affiliate_links WHERE affiliate_id = '$A3' LIMIT 1),
       'farm-ip-' || n::text, 'farm-ua-' || n::text, true, now() - interval '2 hours'
FROM generate_series(1, 501) AS n;
SQL

created=$(q "select public.scan_click_anomalies()")
if [ "$created" = "1" ]; then pass "one clicks-without-sales flag is created"; else fail "one clicks-without-sales flag is created" "got $created"; fi

assert_value "the sales-less flag is for the right affiliate" "$A3" <<SQL
SELECT affiliate_id FROM public.risk_flags WHERE kind = 'clicks_without_sales';
SQL

# ---------------------------------------------------------------------------
# 11. Purge
# ---------------------------------------------------------------------------
step "Purging old clicks"

run_sql >/dev/null <<SQL
INSERT INTO public.affiliate_clicks (id, link_id, affiliate_id, product_id, ip_hash, ua_hash, is_unique, created_at)
VALUES (
  '77777777-7777-4777-8777-777777777990',
  (SELECT id FROM public.affiliate_links WHERE code = '$C_MAIN'),
  '$A1', '$P_OPEN', 'old-ip', 'old-ua', true, now() - interval '14 months'
);
SQL

deleted=$(q "select public.purge_old_clicks(13)")
if [ "$deleted" = "1" ]; then pass "the 14 month old click is purged"; else fail "the 14 month old click is purged" "got $deleted"; fi

assert_value "the recent clicks are kept" "0" <<SQL
SELECT count(*) FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777990';
SQL

assert_value "a recent click survives" "t" <<SQL
SELECT EXISTS (SELECT 1 FROM public.affiliate_clicks WHERE id = '77777777-7777-4777-8777-777777777702');
SQL

# ---------------------------------------------------------------------------
# 12. RLS
# ---------------------------------------------------------------------------
step "Row level security"

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$A1';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_links WHERE affiliate_id <> '$A1';
RESET ROLE;
SQL
)
if [ "$rows" = "0" ]; then pass "another affiliate's links are invisible"; else fail "another affiliate's links are invisible" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$A1';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_links;
RESET ROLE;
SQL
)
mine=$(q "select count(*) from public.affiliate_links where affiliate_id = '$A1'")
if [ "$rows" = "$mine" ]; then pass "an affiliate sees all of their own links ($mine)"; else fail "an affiliate sees all of their own links" "saw $rows of $mine"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$A1';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_product_access WHERE affiliate_id <> '$A1';
RESET ROLE;
SQL
)
if [ "$rows" = "0" ]; then pass "an affiliate sees only their own access rows"; else fail "an affiliate sees only their own access rows" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$V1';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_product_access
WHERE product_id NOT IN (SELECT id FROM public.products WHERE vendor_id = '$V1');
RESET ROLE;
SQL
)
if [ "$rows" = "0" ]; then pass "a vendor sees only their products' access rows"; else fail "a vendor sees only their products' access rows" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$V2';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_product_access;
RESET ROLE;
SQL
)
if [ "$rows" = "0" ]; then pass "another vendor sees nothing"; else fail "another vendor sees nothing" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$SUPPORT';
SET ROLE authenticated;
SELECT count(*) FROM public.risk_flags;
RESET ROLE;
SQL
)
if [ "$rows" = "0" ]; then pass "support cannot read risk flags"; else fail "support cannot read risk flags" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$ADMIN';
SET ROLE authenticated;
SELECT count(*) FROM public.risk_flags;
RESET ROLE;
SQL
)
if [ "$rows" -ge 1 ] 2>/dev/null; then pass "an admin reads risk flags"; else fail "an admin reads risk flags" "got $rows"; fi

rows=$(rls_count <<SQL
SET request.jwt.claim.sub = '$MODERATOR';
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_links;
RESET ROLE;
SQL
)
if [ "$rows" -ge 1 ] 2>/dev/null; then pass "a moderator reads every link"; else fail "a moderator reads every link" "got $rows"; fi

assert_error "clicks are not readable by a signed-in person" "permission denied" <<'SQL'
SET ROLE authenticated;
SELECT count(*) FROM public.affiliate_clicks;
SQL

assert_error "a signed-in person cannot write a link" "permission denied" <<SQL
SET request.jwt.claim.sub = '$A1';
SET ROLE authenticated;
INSERT INTO public.affiliate_links (affiliate_id, product_id, code) VALUES ('$A1','$P_OPEN','zzzzzzzz');
SQL

assert_error "anon cannot read links" "permission denied" <<'SQL'
SET ROLE anon;
SELECT count(*) FROM public.affiliate_links;
SQL

assert_error "a signed-in person cannot call record_click" "permission denied" <<SQL
SET ROLE authenticated;
SELECT public.record_click(gen_random_uuid(), '$C_MAIN', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SQL

# ---------------------------------------------------------------------------
# 13. Rollback
# ---------------------------------------------------------------------------
step "Rollback"

bootstrap "$ROLLBACK_DB" >/dev/null || { echo "rollback bootstrap failed"; exit 1; }
apply_migrations "$ROLLBACK_DB" || exit 1

RB=$(tmpfile)
awk '
  /^-- ROLLBACK/ { inblock = 1 }
  inblock && /^-- BEGIN;/ { capture = 1 }
  capture { line = $0; sub(/^-- ?/, "", line); print line }
  capture && /^-- COMMIT;/ { exit }
' "$MIGRATION" > "$RB"

if grep -q 'DROP TABLE IF EXISTS public.risk_flags' "$RB"; then
  pass "the rollback block was extracted"
else
  fail "the rollback block was extracted"
fi

run_file "$RB" "$ROLLBACK_DB" >/dev/null 2>&1 || fail "the rollback runs"

gone=$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('affiliate_product_access','affiliate_invites','affiliate_links','affiliate_clicks','affiliate_daily_stats','risk_flags')" "$ROLLBACK_DB")
if [ "$gone" = "0" ]; then pass "the tables are gone"; else fail "the tables are gone" "got $gone"; fi

recorded=$(q "select count(*) from public.app_migrations where version = '20261118000200'" "$ROLLBACK_DB")
if [ "$recorded" = "0" ]; then pass "the app_migrations row is gone"; else fail "the app_migrations row is gone" "got $recorded"; fi

run_file "$MIGRATION" "$ROLLBACK_DB" >/dev/null 2>&1 || fail "the migration re-applies"

out=$(su "$SUPER_USER" -c "psql -v ON_ERROR_STOP=1 -q -At -d $ROLLBACK_DB" < "$VERIFY" 2>&1)
bad=$(printf '%s\n' "$out" | grep -c '|f$' || true)
total=$(printf '%s\n' "$out" | grep -c '|' || true)
if [ "$bad" = "0" ] && [ "$total" -gt 0 ]; then
  pass "the verify file passes again ($total checks)"
else
  fail "the verify file passes again" "$bad false of $total"
fi
rm -f "$RB"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n============================================\n'
printf 'PASSED: %d\n' "$PASSED"
printf 'FAILED: %d\n' "$FAILED"
printf '============================================\n'

[ "$FAILED" -eq 0 ] || exit 1
