# Commerce core: orders, ledger, refunds and VAT

This is the database side of taking money. It covers the order record, the
double-entry ledger, refunds and disputes, VAT periods and the payout rules.

It does **not** talk to Paystack, it does **not** move money out, and it has no
interface. See [What is not in this task](#what-is-not-in-this-task) at the end.

Everything here is defined by `supabase/migrations/20261116000200_commerce_core.sql`.
The checks are in `supabase/verify/20261116000200_commerce_core_verify.sql`, and
the tests are in `supabase/tests/commerce_core_test.sh`.

## Money

Every amount is an integer number of **kobo** in a `bigint`. Nothing is `numeric`,
nothing is floating point. Rates are integers in basis points (`1000` = 10%).

Rounding is **floor** everywhere except one place, called out below: the VAT on
the platform fee is rounded half up, because that is the rule the specification
gives for it.

The vendor absorbs the rounding on a split. That is why `vendor_net_kobo` is
always the remainder (`price - platform fee - affiliate commission`) rather than a
third independently rounded number, and why the three parts always add up to the
price exactly.

## Order numbers

`AFV-<year>-<six digits>`, for example `AFV-2026-000142`. The year is the
**Africa/Lagos** year. The digits come from `public.order_number_seq`, a single
global sequence that is never reset: a number is never reused, even if the order
it belonged to is rolled back.

## The order state machine

```
                    create_order
                         |
                         v
                    +---------+   expire_pending_orders    +---------+
                    | pending | --------------------------> | expired |
                    +---------+                            +---------+
                         |                                       |
      process_paid_order |                                       | process_paid_order
      (amount + currency |                                       | (a late payment is
       must match)       |                                       |  still accepted)
                         v                                       v
                    +------+  request_refund + process_refund  +---------+
                    | paid | --------------------------------> | refunded|
                    +------+                                  +---------+
                       |  ^
        open_dispute   |  |  resolve_dispute('won')
                       v  |
                   +----------+   resolve_dispute('lost')   +---------+
                   | disputed | --------------------------> | refunded|
                   +----------+                             +---------+
```

`failed` exists in the enum for a payment the provider refuses outright. Nothing
in this migration sets it; it is reserved for the Paystack integration task.

Rules the database enforces:

- `paid_at` must be set when the status is `paid`, `refunded` or `disputed`.
- `total_kobo >= subtotal_kobo` always.
- When the tax is added on top (`tax_included` false),
  `total_kobo = subtotal_kobo + tax_kobo`.
- When the price already includes the tax (`tax_included` true),
  `total_kobo = subtotal_kobo`.
- Once an item has its three split amounts, they plus `tax_deducted_kobo` must
  equal `unit_price_kobo`.

## The refund state machine

```
   request_refund (inside the window)          request_refund (after the window)
              |                                          |
              v                                          v
        +----------+                              +-----------+
        | approved | <---- decide_refund -------- | requested |
        +----------+       ('approve')            +-----------+
              |                 |                        |
              |                 |  decide_refund         |
              |                 |  ('reject', note >= 10)|
              |                 v                        v
              |            +----------+            +----------+
              |            | rejected |            | rejected |
              |            +----------+            +----------+
              v
        process_refund
              |
              v
        +-----------+
        | processed |
        +-----------+
```

`failed` is reserved for the Paystack refund call, which is a later task.

Only one open request (`requested` or `approved`) may exist per order; a second
`request_refund` raises `refund_exists`.

## The ledger

Double entry, append only. Every transaction has entries whose debits equal their
credits; a **deferred** constraint trigger checks that at `COMMIT`, so a posting
can be written one row at a time. A transaction that ends up unbalanced raises
`unbalanced_transaction` and the whole transaction rolls back.

`UPDATE`, `DELETE` and `TRUNCATE` raise on `ledger_entries` for every role
including `service_role`, and the privileges are revoked as well. The only role
that can get past the trigger is `postgres`, and only by deliberately disabling it.

An entry is a debit or a credit, never both and never neither.

### Accounts

| id | code | name | kind | what it holds |
|----|------|------|------|----------------|
| 1 | `paystack_balance` | Paystack balance | asset | money the provider holds for us |
| 2 | `processor_fees` | Processor fees | expense | what the provider kept |
| 3 | `vendor_payable` | Vendor payable | liability | owed to vendors |
| 4 | `affiliate_payable` | Affiliate payable | liability | owed to affiliates |
| 5 | `platform_revenue` | Platform revenue | revenue | the platform fee |
| 6 | `withdrawal_fee_revenue` | Withdrawal fee revenue | revenue | the payout fee (not used yet) |
| 7 | `vat_payable` | VAT payable | liability | VAT collected, owed to the tax office |
| 8 | `payouts_in_transit` | Payouts in transit | liability | money sent, not yet settled |

`party_id` is only meaningful on `vendor_payable` and `affiliate_payable`: it is
the vendor or affiliate the balance belongs to.

`available_at` is only meaningful on credits to those two accounts. It is when a
held commission becomes withdrawable: `paid_at + commission_hold_days`.

### Posting example: a plain sale

A 1,000,000 kobo order, affiliate commission 3000 bps, platform fee 1000 bps,
Paystack fee 25,000 kobo, VAT off:

| account | debit | credit | party |
|---------|-------|--------|-------|
| `paystack_balance` | 975,000 | | |
| `processor_fees` | 25,000 | | |
| `vendor_payable` | | 600,000 | vendor |
| `affiliate_payable` | | 300,000 | affiliate |
| `platform_revenue` | | 100,000 | |
| **total** | **1,000,000** | **1,000,000** | |

The vendor's credit carries `available_at = paid_at + 7 days`; the affiliate's
carries the same. `get_party_balance` reports the vendor as 600,000 pending and 0
available until that moment.

The processor fee stays an expense of the platform. It is never taken out of a
vendor's share, and it is never refunded to the vendor when an order is refunded:
the refund reverses the sale, not the provider's charge.

### Posting example: VAT on the platform fee

Same order, `vat_enabled` true, `vat_applies_to = 'platform_fee'`, rate 750 bps.
The platform fee is 100,000, so the VAT is 7,500, carved out of the vendor's
share. The buyer still pays 1,000,000.

| account | debit | credit |
|---------|-------|--------|
| `paystack_balance` | 975,000 | |
| `processor_fees` | 25,000 | |
| `vendor_payable` | | 592,500 |
| `affiliate_payable` | | 300,000 |
| `platform_revenue` | | 100,000 |
| `vat_payable` | | 7,500 |
| **total** | **1,000,000** | **1,000,000** |

The item records `tax_deducted_kobo = 7,500`, which is what makes
`100,000 + 300,000 + 592,500 + 7,500 = 1,000,000` hold.

### Posting example: a refund

The plain sale above, refunded in full:

| account | debit | credit | party |
|---------|-------|--------|-------|
| `paystack_balance` | | 1,000,000 | |
| `vendor_payable` | 600,000 | | vendor |
| `affiliate_payable` | 300,000 | | affiliate |
| `platform_revenue` | 100,000 | | |
| **total** | **1,000,000** | **1,000,000** | |

The `processor_fees` row is untouched: that money is gone. A debit can push a
party's balance below zero, which is allowed and is recovered from future
earnings. `get_party_balance` reports `negative: true` and an `available_kobo` of
0 in that case.

The refund is idempotent on the order (`order_refund:<order id>`), so a retried
call returns `already_processed` and posts nothing.

## VAT

VAT is **off by default** (`vat_enabled` is false) and nothing is added while it
is off: no tax line, no `vat_payable` entry, no change to any amount.

| setting | meaning |
|---------|---------|
| `vat_enabled` | whether VAT applies at all |
| `vat_rate_bps` | the rate in basis points (750 = 7.5%) |
| `vat_applies_to` | `platform_fee`, `product_price` or `both` |
| `prices_include_vat` | whether the listed product price already contains VAT |

### The four cases

**1. `platform_fee`.** Tax = `round_half_up(platform_fee × rate / 10000)`. It is
carved out of the vendor's share and recorded with `supplier = 'affilova'` and
`included = true`. The buyer pays the listed price. The platform fee itself is
not reduced: the platform keeps 100,000 and the vendor loses 7,500.

**2. `product_price`, prices include VAT.** Tax =
`price - floor(price × 10000 / (10000 + rate))`. With a 1,000,000 price at 750 bps
that is `1,000,000 - floor(1,000,000 × 10000 / 10750) = 69,768`. The split runs on
`price - tax = 930,232`, so the platform fee is `93,023`, the affiliate
commission `279,069` and the vendor `558,140`. The buyer pays 1,000,000 and
`tax_deducted_kobo = 69,768`.

**3. `product_price`, prices exclude VAT.** Tax = `floor(price × rate / 10000)`.
With a 1,000,000 price at 750 bps that is 75,000. The split runs on the price, so
platform 100,000, affiliate 300,000, vendor 600,000. The buyer pays
`1,000,000 + 75,000 = 1,075,000`, and `orders.tax_kobo = 75,000` with
`tax_included = false`.

**4. `both`.** Both of the above, each on its own basis. The platform-fee VAT is
carved out of the vendor's share; the product-price VAT follows case 2 or 3.

Every tax amount, whichever case produced it, is credited to `vat_payable`. Only
case 3 raises what the buyer pays.

### VAT periods

`vat_period_summary(date)` returns, for one Lagos calendar month:

| field | meaning |
|-------|---------|
| `output_vat_kobo` | credits to `vat_payable` for orders **paid** in that month |
| `credit_notes_kobo` | debits to `vat_payable` (refunds) **posted** in that month |
| `adjustments_kobo` | the signed sum of `vat_adjustments` for the period |
| `net_payable_kobo` | output − credit notes + adjustments |
| `due_date` | the 21st of the following month |

Output VAT is attributed by the order's `paid_at`, not by when the row was
written, and in **Africa/Lagos** time. An order paid at 23:30 UTC on 31 January is
00:30 on 1 February in Lagos, so it belongs to **February**. A refund is
attributed to the month the reversal was posted, because that is the period the
credit note belongs to.

`set_vat_period_status` moves a period `open → filed → remitted` and nothing else.
Filing needs no amount; remitting needs an amount and a payment reference. A
remitted period is closed: the only way to change its figure is
`add_vat_adjustment`, which stores a signed amount and a reason next to the
original figures instead of editing them. Every change is audited.

## Payout rules

These are the settings the payout job will read. No payout job exists yet.

| setting | seeded value | meaning |
|---------|--------------|---------|
| `withdrawal_fee_bps` | 200 | 2% |
| `withdrawal_fee_min_kobo` | 5,000 | smallest fee (50 NGN) |
| `withdrawal_fee_cap_kobo` | 200,000 | largest fee (2,000 NGN) |
| `min_withdrawal_kobo` | 500,000 | smallest withdrawal (already existed) |
| `auto_payout_default` | true | a new schedule starts on |
| `payout_weekdays` | `[1,2,3,4,5]` | ISO weekdays, Monday is 1 |
| `payout_run_hour_lagos` | 10 | 10:00 in Lagos |
| `processor_fee_bearer` | `"platform"` | who absorbs the provider fee |
| `order_expiry_hours` | 24 | how long an unpaid order lives |
| `guest_checkout_enabled` | true | checkout without an account |

`compute_withdrawal_fee(amount)` is
`LEAST(cap, GREATEST(min, floor(amount × bps / 10000)))`, and it refuses an amount
below `min_withdrawal_kobo` with `invalid_amount`.

`is_payout_day(instant)` answers whether a payout may run at that instant: the
Africa/Lagos weekday must be in `payout_weekdays`, and the Africa/Lagos date must
not be in `payout_blackout_dates`. The Lagos boundary is the point of the
function: 23:30 UTC on a Friday is already Saturday in Lagos.

Blackout dates are added and removed by an admin or finance user, need a reason of
at least five characters, and are audited.

## Downloads

`claim_download` is the only thing that returns a storage key. It checks, in
order: the caller owns the entitlement (by user id, or by the email the
entitlement was sold with), it is not revoked, it is not expired, the download
limit is not reached, the file's `scan_status` is `clean`, and the order is
`paid`. Each refusal is a distinct short code: `forbidden`, `revoked`, `expired`,
`download_limit`, `file_not_clean`, `order_not_paid`.

The counter is incremented under a row lock in the same transaction as the
`download_log` insert, so two simultaneous claims cannot both take the last
download.

## Who can read what

| table | who |
|-------|-----|
| `orders` | the buyer; staff (admin, finance, support) |
| `order_items` | the buyer of the order; the vendor; the affiliate; staff |
| `order_tax_lines` | server only |
| `entitlements` | the buyer, by user id or by email |
| `download_log` | server only |
| `ledger_*` | admin and finance |
| `refund_requests` | the requester; the vendor of the order; admin and finance |
| `order_disputes` | the buyer; staff |
| `vat_*`, `payout_blackout_dates` | admin and finance |

Two read models exist for the portal screens:

- `vendor_sales` — order number, product, unit price, platform fee, vendor net,
  paid date, status, for the calling vendor's own items only.
- `affiliate_commissions` — order number, product, commission, paid date, status,
  for the calling affiliate's own items only.

Neither exposes the buyer's email or name.

`anon` has no privilege on any of these tables and no policy grants it anything.
No client role has `INSERT`, `UPDATE` or `DELETE` anywhere. Every function in this
migration is `SECURITY DEFINER` with an empty `search_path`, `EXECUTE` is revoked
from `public`, `anon` and `authenticated`, and granted to `service_role` only.

## Calling it from the server

All of these are called with the service key, never from the browser.

| function | purpose |
|----------|---------|
| `create_order(buyer, email, name, product, affiliate, click, ip_hash, reference)` | make a pending order |
| `attach_paystack_init(order, access_code)` | store the provider's access code |
| `process_paid_order(reference, txn_id, amount, currency, fees, channel, paid_at)` | turn a confirmed payment into money in the ledger |
| `expire_pending_orders(limit)` | sweep expired orders, returns how many |
| `request_refund(actor, order, reason)` | the buyer asks |
| `decide_refund(actor, request, decision, note)` | the vendor or staff decide |
| `process_refund(request, provider_reference, amount)` | reverse the sale |
| `open_dispute(reference, note)` / `resolve_dispute(order, outcome)` | freeze and settle a chargeback |
| `claim_download(entitlement, user, email, ip_hash)` | hand out a download |
| `get_party_balance(party)` | pending, available and total for a vendor or affiliate |
| `vat_period_summary(period)` | one month's VAT position |
| `set_vat_period_status(actor, period, status, amount, reference, receipt, note)` | file or remit |
| `add_vat_adjustment(actor, period, amount, reason)` | correct a closed period |
| `add_payout_blackout(actor, day, reason)` / `remove_payout_blackout(actor, day)` | the payout calendar |
| `compute_split(price, commission_bps, fee_bps, has_affiliate)` | the split, on its own |
| `compute_withdrawal_fee(amount)` / `is_payout_day(instant)` | payout rules, on their own |

Errors are short codes raised as the exception message: `product_unavailable`,
`guest_checkout_disabled`, `duplicate_reference`, `invalid_split`,
`unbalanced_split`, `unbalanced_transaction`, `invalid_amount`,
`partial_refund_unsupported`, `not_refundable`, `self_decision`, `note_required`,
`download_limit`, `file_not_clean`, `order_not_paid`, `period_closed`,
`forbidden`, `bad_state`.

## What is not in this task

- **No Paystack calls.** `create_order` records the reference; something else has
  to initialise the transaction and store the access code. `process_paid_order`
  assumes a verified webhook; it does not verify a signature. `process_refund`
  records a refund that already happened at the provider; it does not ask for one.
- **No payouts.** No withdrawal request, no batch, no transfer, no reconciliation.
  The `withdrawal_fee_revenue` and `payouts_in_transit` accounts exist and stay
  empty until that work is done.
- **No interface.** No page, no component, no route and no application code.
- **No email.** The `order_paid` job is queued with the order id, number and buyer
  email; whatever consumes it is a separate task.
- **No partial refunds.** `process_refund` refuses anything but the full total
  with `partial_refund_unsupported`.
- **No multi-item orders in practice.** The schema allows several items per order;
  the functions read the first one, because one item per order is the launch
  decision.

## Running the tests

```
supabase/tests/commerce_core_test.sh
```

It needs a local Postgres server and a superuser connection (by default it uses
`su postgres`). It creates a throwaway database, applies every migration in order,
runs every verify file, applies the commerce migration twice, runs the rollback
and re-applies, then runs the assertions and two real two-session concurrency
tests. It exits non-zero if anything fails. It is deliberately not part of
`pnpm test`.
