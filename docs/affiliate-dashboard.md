# The affiliate dashboard

This is the map of the affiliate and merchant affiliate screens: what each one
reads, what the numbers mean, and what is deliberately not here yet.

The screens are thin. Every number comes from a database function in
`supabase/migrations/20261119000100_affiliate_read_models.sql`, called by a
server action in `lib/affiliate/read-actions.ts` that takes the signed-in user's
id from the session and never from the request. No screen does arithmetic on a
figure it was given, and no screen reads a table directly.

## The numbers

Money is an integer number of kobo everywhere. Screens format it with
`formatNaira`; nothing converts to a float on the way.

| Metric | What it is | How it is calculated |
| --- | --- | --- |
| Clicks | Visits through an affiliate's links | One row per human click, filtered for automation before it is stored |
| Unique clicks | Clicks from a distinct visitor | A click is unique when the same link has not seen the same visitor in the previous 30 minutes |
| Orders | Paid orders attributed to a link | Orders whose attribution names one of the affiliate's links and that were paid inside the range |
| Revenue | What buyers paid on those orders | The order total, in kobo |
| Commission | The affiliate's share | The product's commission in basis points applied to each paid order |
| Conversion rate | Orders per unique click | `orders * 10000 / unique_clicks`, in basis points. Zero when there are no unique clicks |
| Earnings per 100 clicks | Commission per hundred clicks | `commission * 100 / clicks`. Zero when there are no clicks |
| Pending balance | Commission still inside the hold | Credited but not yet released, from `get_party_balance` |
| Available balance | Commission that has cleared the hold | Credited minus released minus paid out, never below zero |
| Total balance | Everything the ledger says is theirs | Pending plus available; negative when a refund outran a release |

Conversion rate is orders over **unique** clicks, not raw clicks, because one
person clicking four times is one chance to sell. Earnings per 100 clicks is over
**all** clicks, because that is what the affiliate paid for in effort.

### The hold

A commission is credited when an order is paid and becomes available after
`commission_hold_days` from the settings table. The Earnings screen reads that
number through `getCommissionHoldDays()` and states it in words; it does not
hardcode a figure. `available_at` on each row is the ledger entry's hold end.

### Days

A day is a Lagos day. `lib/dates/lagos.ts` turns a range preset into Lagos day
boundaries and into the UTC instants the overview needs: `fromUtc` is 00:00 on
the first day and `toUtc` is 23:59:59.999 on the last, both on the Lagos clock.
The presets are today, the last 7 days, the last 30 days, this month, and a
custom range of at most 366 days. A custom range with a missing date, a date that
does not exist, a backwards range or one longer than the cap is refused with one
sentence, and the page falls back to the last 30 days.

## What each screen reads

| Screen | Path | Reads |
| --- | --- | --- |
| Overview | `/` (affiliate host) | `affiliate_overview`, `affiliate_daily_series` |
| Marketplace | `/marketplace` | `affiliate_marketplace`, plus `product_categories` for the filter |
| My links | `/my-links` | `affiliate_link_stats` |
| Earnings | `/earnings` | `affiliate_commission_list`, `affiliate_overview` (for the balance only), `settings` for the hold |
| Analytics | `/analytics` | `affiliate_overview`, then `affiliate_link_stats` for "by link" or `affiliate_breakdown` for product, s1 and utm_source |
| Merchant affiliates | `/affiliates` (merchant host) | `vendor_affiliate_requests`, `vendor_affiliate_stats`, `vendor_invites`, `revoke_affiliate_invite` |
| Join | `/join/<token>` (public host) | `accept_affiliate_invite` through the existing action, then the product title |

Every affiliate function takes the affiliate's id as its first argument and
filters by it inside. Every vendor function takes the vendor's id and joins the
products to it. There is no parameter anywhere that names somebody else's rows.

The QR code is made by a server action (`getLinkQrAction`) for a link the caller
owns. There is no public QR route, and the SVG is checked before it is rendered
inline.

## Reading safely

`lib/affiliate/read-actions.ts` follows the same order for every call: who is
calling (from the session), may they (`area:affiliate` or `area:merchant`), is
the input well formed (Zod, strict objects so there is nowhere to put another
id), is the allowance left (120 reads a minute per user, shared across the
reads), then the database.

A failure becomes a sentence from `lib/affiliate/errors.ts`. Database text never
reaches the screen: a code the functions raise on purpose (`invalid_cursor`,
`not_found`, `invalid_range`) gets its own sentence, and anything else gets the
generic one. A page cursor is the database's JSON object, base64url encoded, and
a cursor that does not decode is refused rather than silently restarting at page
one.

## What is intentionally missing

- **Withdrawals.** The Earnings screen says "Withdrawals are not available yet."
  There is no request, no queue and no payout state. The balance is read-only.
- **Impressions.** Clicks are measured; how many times a link was shown is not.
  Nothing in the schema records a view, so no screen estimates one.
- **Geography.** No country, city or region is stored for a click, by design:
  the click row holds a salted hash of the visitor, not an address.
- **Devices and browsers.** Not recorded, for the same reason.
- **Affiliate tiers.** There is one commission rate per product. No tier, no
  bonus, no monthly target.
- **Attribution windows beyond the click.** An order is attributed through the
  click that started it, at checkout. There is no separate lookback report.
- **Declined requests on the merchant screen.** The tabs are Requests (pending),
  Approved and Blocked. Declined rows are kept in the table and returned by
  `vendor_affiliate_requests(p_status => 'rejected')`, but no tab lists them; the
  affiliate can ask again, and approving from Blocked or Requests is the way back.

## Tests

- `lib/dates/lagos.test.ts`: every preset, month and year boundaries, the 23:30
  UTC rollover, custom ranges, invalid ranges and the 366 day cap.
- `lib/affiliate/links.test.ts`: short links and the four share URLs, including a
  hostile title.
- `lib/affiliate/read-actions.test.ts`: roles, ownership, validation, the rate
  limit, safe errors, and that the actor is always the session user.
- `lib/affiliate/qr.test.ts`: the QR output is a script-free SVG.
- `components/affiliate/screens.test.ts`: every screen in loaded, empty, loading
  and error states, the KPI definitions, the marketplace card for each access
  state, the vendor tabs and both join outcomes.
- `app/join/join-page.test.ts`: signed out, wrong role, accepted, failed.
- `supabase/tests/affiliate_read_models_test.sh`: the SQL itself, against a
  throwaway database, with 100000 clicks for the index check.
