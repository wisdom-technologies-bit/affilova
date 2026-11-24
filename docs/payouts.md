# Payouts

How money leaves the platform: a user's payable balance becomes a Paystack
transfer to their Nigerian bank account, with approvals, a weekday-only calendar
and an append-only ledger behind it.

The database side is `supabase/migrations/20261122000100_payouts.sql` (verified by
`supabase/verify/20261122000100_payouts_verify.sql`, tested by
`supabase/tests/payouts_test.sh`). The code side is `lib/paystack/transfers.ts`,
`lib/payouts/name-match.ts`, `lib/payouts/service.ts`, the webhook transfer
handlers, `app/api/paystack/transfer-approval/[token]/route.ts` and three cron
jobs. Server actions and screens are not part of this work.

Nothing here has ever called Paystack: the sandbox cannot reach it, so every test
runs against a fake fetch and a fake database, and every amount below is asserted
in the harness rather than observed from a real transfer.

## The flow

```
SET UP AN ACCOUNT                     one active account per user
  user gives bank + account number
        |
        v
  GET  /bank/resolve          ->  the name on the account
        |
        v
  namesMatch(profile, resolved)
        |  no  ->  account saved as 'disabled', error name_mismatch
        |  yes ->  POST /transferrecipient  ->  recipient_code
        v
  set_payout_account(...)     stores bank, name, last4 and recipient_code only
        |  previous account, or a bank change ->  frozen_until = now + 72h
        v
  'active'
```

```
AUTOMATIC PAYOUT                      cron: payout-run, 10:00 and 14:00 Mon-Fri
  list_auto_payout_candidates(20)
        |  auto payout on, account active and unfrozen, account old enough,
        |  available >= 500,000 kobo, nothing requested today, not suspended
        v
  request_withdrawal(user, amount, 'auto', 'wd_...')
        |  the same checks as the preview, balance rows locked
        v
  status 'approved' (or 'requested' when the safety rules ask for a person)
```

```
MANUAL WITHDRAWAL                     user asks, Monday to Friday only
  withdrawal_preview(user, amount)  ->  allowed, reasons, gross/fee/net, next day
        |
        v
  request_withdrawal(user, amount, 'manual', 'wd_...')
        |
        +-- needs_approval false ->  'approved'
        +-- needs_approval true  ->  'requested'
                                       |
                                       v
                              approve_withdrawal(actor, id, note)
                                       |  one approver, or two different ones
                                       |  above payout_dual_approval_kobo
                                       v
                                   'approved'
```

```
SENDING                               cron: payout-process, every 5 min, 08:00-17:55
  claim_withdrawals_for_transfer(20)   only on a payout day, inside processing hours
        |  status -> 'processing'  (FOR UPDATE SKIP LOCKED)
        v
  GET /balance                          balance < batch net + fees ?
        |  yes -> release_claimed_withdrawals(ids), log an error, stop
        |  no
        v
  POST /transfer  (source: balance, reason: "Affilova payout", our reference)
        |
        +-- 200 -> mark_transfer_submitted(code, id), wait for the webhook
        +-- duplicate reference -> treated as already submitted, not an error
        +-- definite rejection  -> record_transfer_result(ref, 'failed', reason)
        +-- timeout or network  -> nothing; payout-reconcile settles it later
```

```
SETTLING
  webhook transfer.success   ->  record_transfer_result(ref, 'success', code, null)
  webhook transfer.failed    ->  record_transfer_result(ref, 'failed', code, reason)
  webhook transfer.reversed  ->  record_transfer_result(ref, 'reversed', code, reason)
  cron payout-reconcile      ->  for 'processing' older than 15 minutes:
                                 GET /transfer/verify/:reference, then the same call
```

## States

| Status       | Means                                                          | Can go to                     |
| ------------ | -------------------------------------------------------------- | ----------------------------- |
| `requested`  | waiting for an admin (or two)                                  | `approved`, `rejected`, `cancelled` |
| `approved`   | cleared, waiting for the sending job                           | `processing`                  |
| `processing` | claimed and being sent; the money is in transit                | `paid`, `failed`, `reversed`  |
| `paid`       | Paystack reported success                                      | `reversed`                    |
| `failed`     | Paystack refused it, or reconcile found it failed; money returned | -                          |
| `reversed`   | the money came back after a success; money returned            | -                             |
| `rejected`   | an admin refused it; money returned                            | -                             |
| `cancelled`  | the user withdrew the request before anyone acted; money returned | -                          |

Only `requested` can be cancelled, and only by its owner. `paid`, `failed`,
`reversed`, `rejected` and `cancelled` are final.

## Ledger postings

Money is bigint kobo everywhere. Every posting is one transaction with an
idempotency key, so a retried call posts nothing the second time.

**On request** (`withdrawal_request:<id>`): debit the payable accounts for the
gross, credit `payouts_in_transit` for the gross. `vendor_payable` is drained
first, then `affiliate_payable`, splitting between them when the gross crosses
both. No account is taken below what its party holds as *available* (the 7-day
commission hold stays untouched).

**On success** (`withdrawal_paid:<id>`): debit `payouts_in_transit` gross, credit
`paystack_balance` net, credit `withdrawal_fee_revenue` fee. A second pair moves
the Paystack transfer fee: debit `processor_fees`, credit `paystack_balance`.

**On failure, reversal or rejection** (`withdrawal_return:<id>`): debit
`payouts_in_transit` gross and credit the same payable accounts the request
debited, with `available_at = now()`.

### Worked examples

Withdrawal fee is `compute_withdrawal_fee`: 2% of the gross, minimum 10,000 kobo
(₦100), capped at 200,000 kobo (₦2,000).

| Gross          | Fee             | Net             | Transfer fee | Postings on success                                    |
| -------------- | --------------- | --------------- | ------------ | ------------------------------------------------------ |
| ₦5,000 (500,000)   | ₦100 (10,000)   | ₦4,900 (490,000)  | ₦10 (1,000)  | transit -500,000; paystack_balance +490,000 +1,000; fee revenue +10,000; processor_fees -1,000 |
| ₦20,000 (2,000,000) | ₦400 (40,000)  | ₦19,600 (1,960,000) | ₦25 (2,500) | transit -2,000,000; paystack_balance +1,960,000 +2,500; fee revenue +40,000; processor_fees -2,500 |
| ₦60,000 (6,000,000) | ₦1,200 (120,000) | ₦58,800 (5,880,000) | ₦50 (5,000) | transit -6,000,000; paystack_balance +5,880,000 +5,000; fee revenue +120,000; processor_fees -5,000 |
| ₦100,000 (10,000,000) | ₦2,000 (200,000, the cap) | ₦98,000 (9,800,000) | ₦50 (5,000) | transit -10,000,000; paystack_balance +9,800,000 +5,000; fee revenue +200,000; processor_fees -5,000 |
| ₦2,500 (250,000)   | refused: below the ₦5,000 minimum | | | |

The transfer fee comes from the bands in `paystack_transfer_fee_bands`
(≤ ₦5,000: ₦10, ≤ ₦50,000: ₦25, above: ₦50) **only when Paystack did not tell us
the real fee**. When `data.fee_charged` is present and greater than zero, that
number is used instead, because Paystack is the authority on what it charged.

## Settings

All of these live in `public.settings` and the admin can change them.

| Key                                 | Default                     | What it does                                              |
| ----------------------------------- | --------------------------- | --------------------------------------------------------- |
| `payout_auto_approve_max_kobo`      | `10000000` (₦100,000)       | Above this, a withdrawal needs admin approval             |
| `payout_dual_approval_kobo`         | `50000000` (₦500,000)       | Above this, two different approvers are needed            |
| `payout_first_requires_approval`    | `true`                      | A user's first withdrawal always needs approval           |
| `payout_account_min_age_days`       | `7`                         | Accounts younger than this cannot withdraw                |
| `withdrawal_daily_limit_kobo`       | `100000000` (₦1,000,000)    | Most one user can withdraw in one Lagos day               |
| `payout_bank_change_freeze_hours`   | `72`                        | Freeze after a new account or a bank change               |
| `payout_processing_hours_lagos`     | `[8,18]`                    | Hours (Lagos) the sending job may run                     |
| `paystack_transfer_fee_bands`       | see above                   | Fallback transfer fee bands                               |
| `auto_payout_default`               | existing                    | What a user without a `payout_preferences` row gets       |
| `min_withdrawal_kobo`               | `500000` (₦5,000)           | The minimum the preview and the request enforce (existing setting) |

A blocked date is a row in `public.payout_blackout_dates` (from the commerce migration) with a reason. No withdrawal
can be requested or sent on a blocked date or at a weekend, Lagos time, and the
preview reports `not_payout_day` before anything else is attempted.

## Schedules

| Job                | Cron               | Why                                                     |
| ------------------ | ------------------ | ------------------------------------------------------- |
| `payout-run`       | `0 10,14 * * 1-5`  | Two automatic runs a day; the second catches the morning's approved work |
| `payout-process`   | `*/5 8-17 * * 1-5` | Every five minutes inside processing hours               |
| `payout-reconcile` | `*/30 * * * *`     | Settles anything Paystack never told us about            |

Each stays under 20 seconds: `payout-run` stops requesting after 18 seconds and
`payout-process` releases what it has claimed but not sent after 15 seconds, so
the next run picks the batch up rather than the call being cut off. See
`docs/cron.md`.

## Dashboard configuration

1. **Transfer approval URL.** In the Paystack dashboard, Settings → Transfers (or
   the transfer settings page), set the approval URL to

   ```
   https://<app host>/api/paystack/transfer-approval/<PAYSTACK_TRANSFER_APPROVAL_TOKEN>
   ```

   with `PAYSTACK_TRANSFER_APPROVAL_TOKEN` at least 32 URL-safe characters, e.g.
   `openssl rand -base64 48 | tr -d '/+=' | cut -c1-48`. The token in the path is
   the authentication: the documented approval request carries no signature
   header, so a long random path segment is what proves the caller is Paystack.
   A wrong or missing token is answered `404` with an empty body, which tells a
   prober nothing.

   Our answer is `200` with an empty JSON object to approve and `400` to decline,
   as documented. A transfer is approved only when its reference, its amount in
   kobo and its recipient all match a withdrawal in `processing`; everything else
   is declined and logged by reference alone.

2. **Payout on demand.** Turn this on if the account should be allowed to send
   transfers without a pre-funded payout schedule; the code transfers from the
   `balance` source, so the Paystack balance must cover the batch. Leave the
   Paystack auto-settlement to the bank on whatever cadence finance prefers.

3. **OTP.** Leave the transfer OTP **on**. With it on, a transfer Paystack holds
   for a one-time code arrives as status `otp`; we never automate the code, so the
   withdrawal stays `processing` until reconcile finds it settled or an operator
   finishes it by hand. With OTP off, every transfer is sent with only the
   approval gate in front of it. OTP on is the safer default for a system that
   pays out unattended; the cost is that a held transfer needs a human.

4. **Webhook URL.** `https://<app host>/api/paystack/webhook`, subscribed to
   `transfer.success`, `transfer.failed` and `transfer.reversed` (plus the
   existing charge events). The webhook secret is `PAYSTACK_SECRET_KEY`.

## Runbook

**A transfer failed.** The webhook settles it: the status becomes `failed`, the
return posting gives the money back to the payable accounts with `available_at =
now()`, and the user can request again (a new reference, so no confusion with the
old one). Read `failure_reason` on the row, which is one of our own safe strings
(`paystack_failed`, `reversed`, `reconcile_failed`), never Paystack's free text.

**The balance is low.** `payout-process` claims a batch, sees the balance cannot
cover the batch net plus fees, releases the batch with
`release_claimed_withdrawals` and logs `payout_balance_low`, which is an error on
purpose so Sentry alerts. Nothing is lost: the withdrawals are `approved` again
and the next run tries once the balance is topped up. The Security page shows the
balance and a "Below approved payouts" badge in the same state.

**A user says their payout never arrived.** Look the withdrawal up by its
reference. `processing` older than 15 minutes means reconcile has not settled it:
run `payout-reconcile` and read the transfer with
`GET /transfer/verify/:reference`. `paid` means Paystack says the money left; the
bank is then the place to look, and the recipient code on the account is the only
identifier we can give Paystack support. `failed` with a return posting means the
money is back in their available balance.

**A reversal after a success.** `transfer.reversed` is handled exactly like a
failure for the ledger: `payouts_in_transit` is debited and the payable accounts
are credited again, so a reversal after `paid` still balances. The status becomes
`reversed` and the row keeps both the paid and the reversed history in the ledger.

**Paystack is down.** Requests still work (they are local), approvals still work,
and nothing is sent because `payout-process` fails at `GET /balance` and stops
without claiming anything new. Anything already claimed is released after 15
seconds, or left `processing` and picked up by reconcile once Paystack answers.
Do not retry a send by hand with a new reference: the reference is the
idempotency guard, so a retry uses the same one.

**A date must be blocked** (holiday, partner downtime, maintenance). Add a
`public.payout_blackout_dates` row with the date and a reason. Requests and sends stop
for that Lagos day and the preview says `not_payout_day`.

## Tests

```
supabase/tests/payouts_test.sh                    89 checks: rules, amounts, race,
                                                  privileges, rollback, re-apply
supabase/verify/20261122000100_payouts_verify.sql  the invariants, as SQL
pnpm vitest run lib/paystack/transfers.test.ts     the client against a fake fetch
pnpm vitest run lib/payouts                         name matching and the service
pnpm vitest run app/api/paystack                    webhook and approval route
pnpm vitest run "app/api/cron"                      the three payout jobs
```

The harness builds a database from every migration in order, including this one,
and proves with two real sessions that two racing `request_withdrawal` calls for
the same balance produce exactly one withdrawal.

## Paystack documentation used

Read from the official pages under `https://paystack.com/docs/`:

- List Banks: `GET /bank?country=nigeria&currency=NGN`, cached for six hours
  because the list changes rarely and every account setup needs it.
- Resolve Account Number: `GET /bank/resolve?account_number=&bank_code=`, which
  returns the account name we compare against the profile.
- Create Transfer Recipient: `POST /transferrecipient` with
  `type: "nuban"`, `name`, `account_number`, `bank_code`, `currency: "NGN"`.
- Initiate Transfer: `POST /transfer` with `source: "balance"`, `amount` (integer
  kobo), `recipient`, `reference`, `reason`.
- Transfer status and verify: `GET /transfer/:id_or_code` and
  `GET /transfer/verify/:reference`, used by reconcile.
- Finalize transfer (OTP): `POST /transfer/finalize_transfer`. Not automated.
- Bulk transfer: `POST /transfer/bulk`. Deliberately unused: one transfer per
  withdrawal keeps a single reference per payout, which is what the ledger and the
  approval URL are built on.
- Transfer approvals: the approval URL, its request body (`source`, `amount`,
  `recipient`, `reference`, `reason`), and `200` to approve / `400` to decline.
- Check balance: `GET /balance`, an array of `{currency, balance}` with the
  balance in kobo.
- Webhook events `transfer.success`, `transfer.failed` and `transfer.reversed`,
  each carrying the transfer object with `reference`, `transfer_code`, `amount`
  and `fee_charged`.

### Where the docs and the brief differ

1. **The approval request has no transfer code.** It is sent before the transfer
   exists, so it carries `reference`, `amount`, `recipient` and `reason` only.
   The brief asked us to compare "the transfer code and reference"; we compare
   the reference, the kobo amount and the recipient instead, and the transfer
   code is compared on webhooks, where it does exist.
2. **The docs document no authentication for the approval URL.** No signature
   header, no shared secret in the body. The brief asked for "exactly what the
   docs require"; we follow the documented body and response codes, and add our
   own secret path token because an unauthenticated endpoint that authorises
   money is not acceptable. This is an addition, not a deviation in the protocol.
3. **The docs return the real transfer fee.** The transfer object and the webhook
   payload carry `fee_charged`, so that is preferred and the configured bands are
   only a fallback when it is missing or zero. The brief's band-only approach
   would drift the moment Paystack changes its pricing.
4. **Test mode.** Test transfers succeed immediately, so `transfer.failed` and
   `transfer.reversed` cannot be produced from the dashboard in test mode; those
   paths are proved with fakes and by calling `record_transfer_result` directly.
5. **OTP.** A transfer held for a one-time code arrives with status `otp` and is
   finished through `finalize_transfer`. We do not automate it, so such a
   withdrawal stays `processing` and is reported by reconcile.

### UNVERIFIED

`paystack.com` answers a Cloudflare challenge to non-browser clients, so the pages
above were read through archived copies of the same official URLs. Two points
could not be confirmed from a live page and are assumptions:

- **UNVERIFIED:** that transfer approvals must be enabled for the account by
  Paystack support before the approval URL is called. The dashboard has the field;
  whether support must switch the feature on is not stated on the pages we could
  read. Test with one small live transfer before relying on it.
- **UNVERIFIED:** the exact behaviour of the approval URL when the account has no
  approval setting configured, and whether Paystack retries a declined approval.
  Our endpoint is idempotent by reference and safe to call repeatedly, so either
  answer is handled.

If either turns out differently, only `app/api/paystack/transfer-approval/[token]/route.ts`
and the dashboard steps above change; the ledger, the states and the jobs do not.
