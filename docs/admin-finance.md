# Admin finance

The money side of the admin app: what happened, what is owed, what needs a person,
and the monthly VAT routine. Everything here is read through one migration
(`20261124000100_admin_finance.sql`) and one set of server actions
(`lib/admin/finance-actions.ts`).

## Who can see what

Roles never imply each other, and every rule is enforced twice: in
`lib/identity/permissions.ts` for the screens and again inside the database
function, which takes the actor id first and raises `forbidden` for anyone else.

| Screen | Admin | Finance | Support | Moderator | Vendor |
| --- | --- | --- | --- | --- | --- |
| Overview, day by day | yes | yes | no | no | no |
| Orders list and detail | yes | yes | yes | no | no |
| Refunds queue | yes | yes | read only | no | no |
| Dispute decision | yes | yes | no | no | no |
| Ledger, trial balance, reconciliation | yes | yes | no | no | no |
| VAT months, export, adjustments | yes | yes | no | no | no |

`orders:read` (admin, finance, support), `refunds:manage`, `disputes:manage`,
`ledger:read` and `reconciliation:read` (admin, finance) and the existing
`vat:manage` (admin, finance) are the actions behind the table.

## Staff privacy

A list never shows a whole buyer address. `mask_email` keeps the first letter and
the domain: `b***@gmail.com`. The same masked value is what the orders list, the
refunds list, the disputes list and every export carries.

The whole address appears in exactly one place: the order detail page, for admin
and support only. Finance sees the masked address there too, with a note saying
so. Every order detail read by admin or support writes an `audit_log` row
`order.viewed_by_staff` with the actor and the order id and nothing else. Support
can look because answering a customer starts there; support cannot move money.

Account numbers, tokens and secrets never appear in any of these screens. The
ledger shows account codes, not bank details.

## What each screen shows

**Finance overview** (`/finance`). A date range (today, 7 days, 30 days, this month, or custom),
eight key figures, a bar per Lagos day with the same numbers in a table, and a
"Needs attention" panel that lists every counter that is not zero with a link to
the page that clears it. When all of them are zero it says "Nothing needs
attention".

The figures: gross sales (paid orders in the range), orders, platform revenue
(fee postings in the range, net of reversals), processor fees, net margin (revenue
minus processor fees), refunds that moved money, and the two current payable
balances. Payables are all-time balances; the rest are the selected days.

**Transactions** (`/transactions`), five tabs:

- *Orders*: search by order number prefix, exact Paystack reference, or exact
  buyer address (admin and support only; finance searching an address finds
  nothing). Status and date filters, a table on a desktop and cards on a phone.
- *Refunds*: the queue by status. A failed submission has a Retry button, which
  resets the request to approved and queues the existing `refund_submit` job under
  the same dedupe key. Approving or rejecting happens on the order detail page
  through the same decision the vendor screen uses.
- *Disputes*: what Paystack said, and whether a person still has to decide. The
  dialog explains both outcomes before you confirm.
- *Ledger*: filter by account and date, every transaction with its entries, and a
  visible "Balanced" line from the trial balance.
- *Reconciliation*: the trial balance with totals and the two checks, and the last
  30 runs with the ledger balance, the Paystack balance and the difference.

**Order detail** (`/transactions/orders/[orderId]`). The order, the split
(platform fee, affiliate commission, vendor net, tax), the tax lines, the buyer,
the vendor, the affiliate, the entitlements summary, the refund requests, the
disputes, the Paystack events for the reference (type, status, time, error code),
the emails sent, and, for admin and finance, the ledger postings of the order.

**VAT** (`/vat` and `/vat/[period]`). A year selector, twelve months with a status
sentence, and one month with its summary, adjustments, tax lines, a CSV export and
the workflow buttons. When VAT is switched off the screen says so and shows the
current rate and basis from settings.

## Reconciliation

Every day at 02:00 Lagos time, `reconcile-daily` asks Paystack for its balance and
asks our ledger for the balance of `paystack_balance` (debits minus credits, which
is what the platform holds), and stores both numbers with the difference.

A non-zero difference is information, not an outage, and it never fails the cron.
Above ₦1,000 (100,000 kobo) the difference is logged at error level, which is what
reaches Sentry.

What a difference usually means, in the order it is worth checking:

1. **Timing.** A payment landed at Paystack a minute before the run, or a
   settlement is in flight. It clears on the next run.
2. **A transfer we have not confirmed.** A withdrawal was sent and Paystack has
   not delivered `transfer.success` yet. `payout-reconcile` resolves it.
3. **Fees.** Paystack's balance is net of fees it has already taken while our
   ledger records the fee on the payment. A small persistent difference is usually
   this.
4. **A missed webhook.** A payment Paystack took that we never recorded. This is
   the one that needs a person: check `webhook_events` for the reference.

## The dispute decision procedure

1. Paystack decides the chargeback and sends `charge.dispute.resolve`. The
   webhook records what it said on the dispute and sets `needs_decision`; it
   changes nothing else. The order, the buyer's downloads and the ledger are
   untouched.
2. The overview counts the dispute under "Needs attention". Open the disputes tab,
   read the provider's resolution, and open the order to see the split and the
   access.
3. Decide **Won** or **Lost** and write a note of at least 10 characters saying
   why. The note is what the next person reads.
   - **Won**: the buyer keeps the order, the downloads are available again, the
     vendor keeps the money, no refund is sent.
   - **Lost**: the buyer is refunded, the downloads stay revoked, the vendor's
     balance is reversed and the platform fee comes back off revenue. A refund is
     submitted to Paystack.
4. Only `resolve_dispute` moves money, and only a person can call it. There is no
   automatic path from a webhook to a refund.

## The VAT monthly routine

1. On the 14th and 19th, and every day after the 21st, finance and admin accounts
   get one reminder for the previous month, if it has activity or was filed but
   not remitted. The reminder is claimed in `email_log`, so it is sent once per
   month, per reminder and per person.
2. Open `/vat`, choose the month, and **Export CSV**. The file has the order
   number, the Lagos paid date, the basis, the rate, the base, the tax, the
   supplier and whether the order was refunded. It never contains buyer data, and
   a cell a spreadsheet would run as a formula is prefixed with a single quote.
   The export writes an `audit_log` row `vat.exported`.
3. File the return with the tax authority.
4. Pay it.
5. Record it: **Mark as remitted**, with the amount you actually paid (typed, never
   filled in for you) and the payment reference. **Mark as filed** records the day
   the return was filed, which is separate from the money.
6. A remitted month is closed. If something needs correcting afterwards, use
   **Add adjustment** with a signed amount in naira and a reason; the filed history
   stays intact.

Credit notes appear in the month the refund posted, not the month of the original
sale. That is what the ledger says, and the screen reports the ledger.
