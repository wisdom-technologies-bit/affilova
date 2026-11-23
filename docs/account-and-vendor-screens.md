# Account and vendor screens

The buyer's account app (`app/hosts/account`) and the vendor's merchant screens
(`app/hosts/merchant`) read their numbers from eight database functions added in
`supabase/migrations/20261121000200_account_vendor_read_models.sql`. This note
records what each screen reads, what it deliberately cannot see, and what each
number means.

## Where the data comes from

Every screen reads through a server action. The actions never take a user id or a
vendor id from the browser: they take the id from the session, check the role, and
pass that id as the first argument of the database function, which checks ownership
again inside the database. Both sides have to agree before a row is returned.

| Screen | Action | Function |
| --- | --- | --- |
| Purchases | `getMyOrdersAction` | `claim_guest_orders`, then `account_orders` |
| Purchase detail | `getMyOrderAction` | `account_order_detail` |
| Download | `downloadMyFileAction` | `account_order_detail` (ownership), `claim_download` |
| Refund request | `requestMyRefundAction` | the existing `requestRefundAction` |
| Merchant overview | `getVendorOverviewAction`, `getVendorDailySeriesAction`, `getVendorTopProductsAction` | `vendor_overview`, `vendor_daily_series`, `vendor_top_products` |
| Merchant sales | `getVendorSalesAction` | `vendor_sales_list` |
| Refund requests | `getVendorRefundRequestsAction`, `decideRefundAction` | `vendor_refund_requests`, existing decision path |
| Merchant analytics | the same three as the overview | `vendor_overview`, `vendor_daily_series`, `vendor_top_products` |

All eight functions are `SECURITY DEFINER`, run with `SET search_path = ''`, are
granted to `service_role` only, and check ownership against the first argument. The
tables they read keep RLS on.

### Guest orders

`claim_guest_orders(p_user)` runs before the purchases list. It claims earlier guest
orders for a person whose auth email is confirmed and matches their profile email,
setting `buyer_user_id` on orders and entitlements where `buyer_user_id is null` and
the buyer email matches case-insensitively. It is idempotent, writes an audit row
when it claims anything, and does nothing at all for an unconfirmed address.

## The account screens

### Purchases (`/`)

Reads one page of the buyer's own orders: order number, status, total, the paid date
(falling back to the created date), the product title and the vendor's name.

States: a skeleton while the first page is on its way, "You have not bought anything
yet." with a link to the marketplace when there is nothing, the error sentence when
the read fails, and Load more only when the database says there is another page.

### Purchase detail (`/purchases/[orderId]`)

Reads one order the buyer owns: the totals, the tax lines, the channel, the refund
window end, any refund request, and the files with their display name, size, download
counts, revocation and scan state.

A file that has not passed its scan shows "Unavailable while we check it" and no
button. A revoked file says it was withdrawn from the order. A file with no downloads
left says so. Storage keys are never returned by the function, so the page cannot
leak one.

The refund area shows the window end in Lagos time and either the form (inside the
window, no request yet) or the state of the request that was made.

### Download

`downloadMyFileAction` proves ownership through `account_order_detail`, then calls
`claim_download` with `p_buyer_user` set to the signed-in user and `p_buyer_email`
null, and presigns a five minute URL. The URL and the storage key are never logged.
Refusals are mapped to plain sentences (not clean yet, no downloads left, withdrawn,
unavailable).

### Receipts (`/receipts`, `/receipts/[orderId]`)

A printable receipt: order number, the date in Lagos time, the vendor's business name,
the product, the amount, any tax line, the payment channel, Affilova named as the
platform, and the legal identity line from `lib/site-config.ts` when one is set. A
print stylesheet hides the controls and the page frame when printing; the Print
button is hidden in print too.

### Support (`/support`) and Profile (`/profile`)

Support explains how to get help and links to `/contact`; there is no ticket system
yet, and the page says so. Profile shows the name and the email (read-only), a sign
out button, and notes that account deletion and a data export are available on
request through the contact page until self-service ships.

## The merchant screens

### Overview

Date presets (last 7 and 30 days, this month, last month) resolve to Lagos days. The
six cards are Orders, Gross sales, Your earnings, Refunds and refund rate, Pending
balance and Available balance, each with its definition in a disclosure. A daily
chart (with a text alternative and a table of the same numbers) and the top products
follow. "Withdrawals are not available yet." sits under the balances until payouts
ship.

### Sales

Tabs All, Paid, Refunded and Disputed, backed by `vendor_sales_list`. Each row is an
order that included one of the vendor's products, with the gross amount, the vendor's
earnings and a "via affiliate" tag. A table on a wide screen, cards on a phone.

### Refund requests

A tab listing the requests on the vendor's own orders: order number, product, reason,
when it was asked for, the amount and the status. A request that is still waiting
offers Approve and Reject. Both go through the existing `decideRefundAction`; a
rejection needs a reason of at least ten characters, which the buyer reads.

### Analytics

The same range controls and numbers, plus the affiliate share: orders that came
through an affiliate divided by all orders in the range.

## Privacy

Vendors never see buyer identity. `vendor_sales_list`, `vendor_refund_requests`,
`vendor_overview` and `vendor_top_products` return no buyer name, email, phone or
address, and no buyer id; the sales list carries only the order number, the product,
the status, the dates, the money and whether an affiliate referred the sale. The
refund request row carries the buyer's own words as the reason, which the buyer wrote
to be read by the vendor, and nothing else about them.

The account functions are the mirror image: they only ever return the signed-in
person's own orders, and the actor id is the first argument, checked inside the
database rather than trusted from the caller.

## Metric definitions

- **Gross sales**: what buyers paid for the vendor's items in the range, before fees,
  including any refunded orders (the refund is counted separately).
- **Your earnings (vendor net)**: the vendor's share after the platform fee, the
  affiliate commission and the VAT on the platform fee.
- **Platform fee**: Affilova's fee on the vendor's items.
- **Affiliate commission**: what affiliates earned on the vendor's items.
- **Refunds**: the count and the kobo refunded in the range, and the refund rate in
  basis points, refunded kobo divided by gross.
- **Pending balance**: money earned but not yet available, including anything inside
  the hold window.
- **Available balance**: money the vendor could withdraw today, once withdrawals
  exist.
- **Affiliate share**: orders that came through an affiliate over all orders in the
  range, in basis points, shown as a percentage.

All money is integer kobo in the database and is formatted with `formatNaira` on the
way to the screen. All times are Africa/Lagos.

## Design review

`docs/design-review/accounts` holds screenshots at 1440x900 and 390x844 of the
purchases list, the purchase detail, the receipt, the profile, the merchant overview,
sales and refund requests, rendered from the real components with fixed mock data by
`scripts/design-review/render-accounts.test.ts` (`SCREENS=1`). The folder is for
review only and is removed before merge.
