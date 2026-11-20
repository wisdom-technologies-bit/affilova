# Paystack checkout

How money is taken, confirmed, refunded and disputed, and what the code does at
each step. Everything here is built from the official Paystack documentation
(pages listed at the bottom) and from the SQL in
`supabase/migrations/20261116000200_commerce_core.sql` and
`supabase/migrations/20261117000100_checkout_support.sql`.

The account is in **test mode** until the owner switches the key.

---

## 1. The pieces

| Piece | Where |
| --- | --- |
| Environment, mode, webhook switch | `lib/env.ts` → `getPaystackEnv()` |
| The three API calls | `lib/paystack/client.ts` |
| Webhook authenticity | `lib/paystack/signature.ts` |
| Webhook endpoint | `app/api/paystack/webhook/route.ts` |
| Checkout orchestration | `lib/commerce/checkout.ts` |
| Server actions (checkout, refunds) | `lib/commerce/actions.ts` |
| SQL wrappers | `lib/commerce/db.ts` |
| Refund submission | `lib/commerce/refund-submit.ts`, handler in `lib/jobs/handlers.ts` |
| Pending-order reconciliation | `lib/commerce/reconcile.ts`, `app/api/cron/[job]/route.ts` |
| Order status for the return page | `lib/commerce/order-status.ts` |
| Turnstile, redeemed on the server | `lib/security/turnstile-verify.ts` |

---

## 2. Checkout, step by step

```
buyer                    app (server)                       database                Paystack
  |                          |                                 |                       |
  |-- startCheckoutAction -->|                                 |                       |
  |   {productId, email,     |                                 |                       |
  |    name, turnstileToken} |                                 |                       |
  |                          |-- 1. validate the form -------->|                       |
  |                          |-- 2. rate limit ip (10/10m) --->| rate_limits           |
  |                          |-- 2. rate limit email (5/10m) ->| rate_limits           |
  |                          |-- 3. siteverify(token) ----------------------------------------->|
  |                          |<-- success, action=checkout, hostname ---------------------------|
  |                          |-- 4. create_order(...) -------->| orders (pending)      |
  |                          |<-- {order_id, number, total_kobo}                       |
  |                          |-- 5. POST /transaction/initialize ------------------------------>|
  |                          |    amount = total_kobo (from the database)              |
  |                          |<-- authorization_url, access_code ------------------------------|
  |                          |-- 6. attach_paystack_init ----->| orders.access_code    |
  |<-- {ok, authorizationUrl}|                                 |                       |
  |                                                                                  |
  |-- browser goes to checkout.paystack.com and pays ------------------------------->|
  |                                                                                  |
  |                          |<-- webhook charge.success ------------------------------|
  |                          |-- GET /transaction/verify/:reference --------------------------->|
  |                          |<-- data.status = success, amount, fees, channel, paid_at, id ---|
  |                          |-- process_paid_order(...) ----->| ledger, entitlements  |
  |-- callback to /checkout/return?reference=...                                    |
  |-- getOrderStatusAction({reference}) -> {status, number}                          |
```

Rules the code follows, and why:

- **The amount is the database's.** `create_order` prices the order (product
  price plus VAT lines). `initializeTransaction` is called with that
  `total_kobo`, never with anything from the request. A browser cannot change
  what it pays.
- **The Turnstile token is redeemed once, on the server, before the order
  exists.** The token is single use; the check requires `success`, `action =
  "checkout"` and a hostname in the configured app hosts. Every failure refuses
  the checkout (`lib/security/turnstile-verify.ts`).
- **Both rate limits deny when the database cannot count.** 10 per 10 minutes
  per IP, 5 per 10 minutes per email, keys hashed with SHA-256.
- **The IP is stored as a hash** (`orders.ip_hash`), never as an address.
- **A Paystack failure fails the order.** `fail_order` moves only a pending
  order, so a paid order can never be failed by a retry.
- **`metadata` carries the order identity only**: `{ order_id, order_number }`.
  Paystack documents it as a stringified JSON object, so it is sent with
  `JSON.stringify`.
- **The reference is `afv_` plus 24 lowercase alphanumerics.** Paystack accepts
  `-`, `.`, `=` and alphanumeric characters in a reference; this is inside that
  set and unguessable.
- **Channels offered:** `card`, `bank`, `ussd`, `bank_transfer`.
- **The affiliate is an extension point.** `readAttribution()` returns `null`
  today and is passed through `create_order`'s `p_affiliate`/`p_click`, so the
  tracking task only has to fill in that one function.

### Order statuses the buyer can see

`getOrderStatusAction({ reference })` returns one of `pending`, `paid`,
`failed`, `expired`, `refunded`, `unknown`, plus the order number. No email, no
amount, no items. A `disputed` order reports `paid`: the payment did happen and
the downloads are frozen while the dispute is open.

---

## 3. Webhooks

**The URL to configure in the Paystack dashboard:**

```
https://affilova.vercel.app/api/paystack/webhook
```

`POST` only. The route is dynamic, reads the raw body, and answers:

| Situation | Answer | What Paystack does |
| --- | --- | --- |
| Signature missing or wrong | `401`, empty body | Retries |
| Body over 64 KB | `413` | Treats the delivery as failed |
| Body already seen (same SHA-256) | `200` | Stops |
| Handled, ignored, or a business failure | `200` | Stops |
| Database or Paystack unreachable | `500` | Retries |

### Signature

Two headers are documented and both are checked, in constant time
(`lib/paystack/signature.ts`):

1. `x-paystack-signature` — HMAC-SHA512 of the raw request body, keyed with the
   secret key (`sk_...`), lowercase hex, 128 characters, no timestamp. This is
   what events carry today.
2. `Paystack-Signature` — `t=<unix seconds>,v1=<key id>:<signature>`. The
   signature is HMAC-SHA512 over `<t>.<raw body>`, keyed with the webhook signing
   secret (`whsec_...`), and `t` must be within 300 seconds of server time. An
   event can carry several `v1` values during a key rotation, so every one is
   tried.

The body is never parsed before it is checked, and never re-serialised: either
would change the bytes and fail the check.

### Source addresses

Paystack documents these three, in test and live mode alike:

```
52.31.139.75
52.49.173.169
52.214.14.220
```

`PAYSTACK_WEBHOOK_ENFORCE_IPS=true` makes the route refuse anything else with
`401`. Left off (the default), an unexpected address is logged as
`paystack_webhook_ip_unexpected` and the delivery is still processed, because
the signature is the real check.

### Duplicates

Every delivery is recorded in `public.webhook_events` by the SHA-256 of its body,
with a unique key on `(provider, body_sha256)`. The insert is
`ON CONFLICT DO NOTHING`, so two instances receiving the same retry produce one
row and the second answers `200 {"duplicate":true}` without running a handler.

### The events

| Event | What happens |
| --- | --- |
| `charge.success` | Verify the reference with Paystack. Require `data.status = success`. Call `process_paid_order` with the **verified** amounts, currency, fees, channel, transaction id and `paid_at`. |
| `refund.pending` | No action (the processor has not answered yet). |
| `refund.processing` | No action. |
| `refund.needs-attention` | No action: Paystack needs the customer's bank details from a person. |
| `refund.processed` | `find_open_refund(reference)` then `process_refund` with the order total. |
| `refund.failed` | `mark_refund_failed` on the open request. |
| `charge.dispute.create` | `open_dispute(reference, note)`: the order is frozen and downloads revoked. |
| `charge.dispute.resolve` | `resolve_dispute(order, outcome)` with the mapping below. |
| `charge.dispute.remind` | Recorded as ignored (Paystack resends it every 4 hours). |
| anything else | Recorded as ignored, answered `200`. |

**Money never comes from the webhook body.** For `charge.success` the body only
names the reference; every figure comes from the verify response. A mismatch
between the verified amount and the order is logged at error level as
`paystack_amount_mismatch`, recorded as `failed`, and answered `200`: it is not
retried, because retrying cannot fix it. A reference we do not have is logged at
warn level as `paystack_order_not_found`.

### The dispute resolution mapping

Paystack documents two resolution values, and they map straight onto what
happens to the money:

| `data.resolution` | Meaning | Our outcome | Effect |
| --- | --- | --- | --- |
| `merchant-accepted` | We accepted the chargeback; the customer is refunded | `lost` | Ledger reversed, order `refunded`, downloads stay revoked |
| `declined` | We rejected the chargeback and it did not stand | `won` | Order back to `paid`, downloads restored |

Any other value is logged as `paystack_dispute_resolution_unknown` and ignored.
Guessing would either reverse a sale that stands or keep money that went back.

### Retries (documented behaviour)

- Live mode: every 3 minutes for the first 4 attempts, then hourly for 72 hours.
- Test mode: hourly for 10 hours.
- Each attempt times out after 30 seconds.
- Failed and resent events are signed again with a new `t`, so the 300-second
  window does not reject them.

That is why a transient failure answers `500`: a lost `charge.success` would
leave a paid order pending until the reconciliation sweep finds it.

---

## 4. Refunds

```
buyer            app                        database                     Paystack
  |-- requestRefundAction -->|                 |                            |
  |                          |-- request_refund ->| refund_requests           |
  |                          |                   | inside the window?        |
  |                          |                   |  yes -> approved (auto)   |
  |                          |                   |  no  -> requested         |
  |                          |<- request_id, auto_approved                  |
  |                          |-- enqueue refund_submit (auto only) -> jobs   |
  |                                                                         |
vendor / staff                                                             |
  |-- decideRefundAction -->|                 |                            |
  |                          |-- decide_refund -->| approved or rejected     |
  |                          |-- enqueue refund_submit (on approve) -> jobs  |
  |                                                                         |
queue worker (process-queue)                                               |
  |-- refund_submit job -->| read the request and the order (money from DB)|
  |                        |-- POST /refund ------------------------------->|
  |                        |    transaction = order reference              |
  |                        |    amount = order total_kobo                  |
  |                        |    reference = afv_refund_<request id>        |
  |                        |<-- refund object (pending) ------------------|
  |                        |-- mark_refund_submitted ->| provider_reference |
  |                                                                         |
  |<-- refund.processed webhook -------------------------------------------|
  |-- find_open_refund -> process_refund -> ledger reversed, order refunded |
```

- **The ledger is only reversed by the webhook.** Paystack accepting a refund
  means "queued"; the books move when `refund.processed` arrives.
- **Two guards against paying twice.** The job is enqueued with the de-duplication
  key `refund_submit:<request id>`, and Paystack accepts a given refund
  reference once. A `409 Conflict` therefore means "already submitted", and is
  recorded as such rather than as a failure.
- **Retryable errors rethrow** so the queue tries again. Terminal errors call
  `mark_refund_failed` with a short code such as `paystack_bad_request`.
- **Only full refunds.** `process_refund` refuses any amount other than the order
  total, so a partial refund is not possible by accident.
- Processed refunds can still take up to 10 business days to reach the customer;
  that is Paystack's processing, not ours.

---

## 5. Reconciliation and expiry

`GET /api/cron/reconcile-pending` (every 10 minutes) asks
`list_orders_needing_verification(50)` for pending orders between 10 minutes and
24 hours old, verifies each one sequentially, and calls `process_paid_order` when
Paystack says `success`. It stops starting new checks after 18 seconds so the
endpoint always answers inside its 30-second limit.

This exists because Paystack only sends webhooks for successful charges, so a
lost webhook is otherwise invisible until the buyer complains.

`GET /api/cron/expire-orders` (hourly) calls `expire_pending_orders(500)`.
Abandoned orders are left to this job, not failed by the sweep.

---

## 6. Test mode

1. In the Paystack dashboard, stay in **test mode** and copy the test secret key
   (`sk_test_...`) into `PAYSTACK_SECRET_KEY`, and the test public key into
   `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`.
2. Set the webhook URL to
   `https://affilova.vercel.app/api/paystack/webhook`. Localhost cannot receive
   events; use a deployed preview on a registered Turnstile hostname.
3. Pay with a test card from the Test Payments page. The refund scenario cards
   are `4084 0800 0067 1803` (the refund will fail) and
   `4084 0800 0067 1902` (the refund will need attention); `5192 6027 2058 4796`
   is the reusable bank-authorisation card.
4. Check, in order:
   - `webhook_events` has a row with `status = processed`;
   - the order moved to `paid` and `ledger_transactions` has one `order_paid`
     row;
   - the admin Security page shows **Test mode** and the counts.
5. To test a refund, request one from the buyer account, approve it as the
   vendor, and watch `refund_requests.status` go `approved` → `processed` and the
   order go `refunded`.

### The two URLs and the Turnstile hosts

Copy these exactly; both are on the public host, and Paystack treats a trailing
slash or a different subdomain as a different endpoint.

| What | Value |
| --- | --- |
| Callback URL (where the buyer comes back) | `https://affilova.vercel.app/checkout/return` |
| Webhook URL (what Paystack calls) | `https://affilova.vercel.app/api/paystack/webhook` |

The callback is built by `appUrl("public", "/checkout/return")` in
`lib/commerce/checkout.ts`, so it follows `NEXT_PUBLIC_HOST_PUBLIC` rather than
being written into the code. Paystack appends `?reference=...` (and sometimes
`trxref`) to it; `/checkout/return` reads either and asks
`getOrderStatusAction` about it.

**Cloudflare Turnstile hostnames.** The widget can only be solved on a hostname
Cloudflare knows, and the token it produces carries that hostname. The server
checks it against the five configured hosts, so all five must be registered on
the Turnstile widget (Cloudflare dashboard → Turnstile → your site → Hostnames),
or a checkout started from one of them is refused with `wrong_hostname`:

```
affilova.vercel.app                  NEXT_PUBLIC_HOST_PUBLIC
affiliates.affilova.vercel.app       NEXT_PUBLIC_HOST_AFFILIATE
merchants.affilova.vercel.app        NEXT_PUBLIC_HOST_MERCHANT
account.affilova.vercel.app          NEXT_PUBLIC_HOST_ACCOUNT
admin.affilova.vercel.app            NEXT_PUBLIC_HOST_ADMIN
```

In development `localhost` and `127.0.0.1` are accepted as well, but only when
`NEXT_PUBLIC_APP_ENV=development` (`checkoutAllowedHostnames()` in
`lib/security/turnstile-verify.ts`). The action name is `checkout` on both sides:
the widget sends it and the verifier requires it.

Switching to live is only the key: `sk_live_...` reports **Live mode** on the
Security page, and the same webhook URL receives live events.

---

## 7. What a failure looks like

Every failure leaves one JSON log line through `lib/logger.ts`. `logger.error`
also reports any `Error` value among its fields to Sentry (only when
`NEXT_PUBLIC_SENTRY_DSN` is set), so the lines below with an attached error
become Sentry issues:

| Event | Level | Sentry issue? | Meaning |
| --- | --- | --- | --- |
| `paystack_webhook_signature_invalid` | warn | no | A delivery failed the HMAC check. Check the key, and whether a signing secret was rotated. |
| `paystack_webhook_ip_unexpected` | warn | no | A delivery came from an address outside the documented list. Expected while the allowlist is off and a proxy is in front. |
| `paystack_webhook_record_failed` | error | no (no Error attached) | The delivery could not be recorded; answered 500 so Paystack retries. |
| `paystack_paid_order_failed` | error | **yes** | The database refused the payment. The order stays pending; the sweep or the next retry will try again. |
| `paystack_amount_mismatch` | error | no (no Error attached) | The verified amount does not match the order. Answered 200 on purpose; a person must look. |
| `paystack_order_not_found` | warn | no | A charge for a reference we do not have. |
| `paystack_refund_process_failed` | error | **yes** | The refund reversal could not be posted; answered 500 so the event is retried. |
| `paystack_dispute_failed` / `paystack_dispute_resolve_failed` | error | **yes** | A dispute could not be opened or resolved; answered 500. |
| `paystack_verify_retry` | warn | no | A verify attempt failed and is being retried (5xx, timeout or network). |
| `paystack_unexpected_response` | error | **yes** | Paystack answered with a shape the schema refuses. The Zod error is attached. |
| `checkout_initialize_failed` | error | **yes** | Paystack refused to initialise. The order was failed with `paystack_<code>`. |
| `checkout_order_failed` | warn | no | `create_order` refused (product unavailable, guest checkout off, duplicate reference). |
| `reconcile_amount_mismatch` | error | no | A swept order was paid for the wrong amount. |
| `reconcile_paid_order_failed` | error | **yes** | A swept payment could not be posted. |
| `refund_submit_enqueue_failed` | error | no | The decision was recorded but the job could not be queued. The request stays approved. |
| `refund_submit_already_exists` | warn | no | Paystack already holds this refund reference: a retry of a call that landed. |
| `turnstile_verify_failed` / `turnstile_rejected` | error / warn | no | The checkout was refused because the challenge could not be verified. |

No log line ever contains the secret key, a signature, a raw response body, an
authorization code, an email address (the logger masks them) or a full payload.

---

## 8. Differences between the brief and the documentation

Everything below was found on the official pages and the code follows the
documentation.

1. **There are two signature headers, not one.** The brief names only
   `x-paystack-signature`. The current docs describe `Paystack-Signature`
   (`t=<unix>,v1=<key id>:<signature>`, HMAC-SHA512 over `<t>.<body>`, keyed with
   the webhook signing secret `whsec_...`, 300-second tolerance), and say to keep
   verifying `x-paystack-signature` until events carry the new header. Both are
   implemented; `PAYSTACK_WEBHOOK_SECRET` is optional and the new header is only
   accepted when it is set.
2. **Refund events include `refund.needs-attention`.** The brief lists pending,
   processing, processed and failed. The documented statuses are `pending`,
   `processing`, `needs-attention`, `failed`, `processed`, each with its own
   event. `needs-attention` is recorded as ignored: it needs a person.
3. **`refund.failed` means the money came back to us.** The docs say the refund
   failed and the account is credited with the amount, and the transaction stays
   successful. That matches marking the request failed without touching the
   ledger.
4. **A refund can carry our own reference.** `POST /refund` accepts `reference`
   (8–64 characters: letters, digits, `_`, `-`, unique per integration), which
   the brief does not mention. It is used as the idempotency guard, and a `409
   Conflict` is documented for a duplicate.
5. **`transaction` on a refund is a reference or a numeric id.** Both are
   accepted; the code sends the order's Paystack reference.
6. **A refund amount is optional.** Without it Paystack refunds the full
   transaction. The code always sends the order total, so the amount is explicit.
7. **Dispute resolutions are `merchant-accepted` and `declined`,** not won/lost.
   The docs also list `charge.dispute.remind`, sent every 4 hours for unresolved
   chargebacks, which the brief does not mention.
8. **Webhooks are only sent for successful transactions.** The Verify Payments
   page says so explicitly. There is no `charge.failed` event to handle, which is
   why reconciliation exists.
9. **`response.status` is the API status, not the transaction status.** The
   transaction status is `response.data.status`, with the documented values
   `abandoned`, `failed`, `ongoing`, `pending`, `processing`, `queued`,
   `reversed`, `success`.
10. **A transaction id is an unsigned 64-bit integer.** It is stored in a bigint
    column and validated as a JavaScript safe integer before use.
11. **`amount` is documented as a string** in the subunit of the currency, and
    `metadata` as a stringified JSON object. Both are sent in those forms.
12. **The documented channel list is longer than the four we use:**
    `card`, `bank`, `apple_pay`, `ussd`, `qr`, `mobile_money`, `bank_transfer`,
    `eft`, `capitec_pay`, `payattitude`. We offer the four the brief asked for.
13. **Reference characters for Initialize Transaction are restricted to `-`,
    `.`, `=` and alphanumerics.** `afv_` plus lowercase alphanumerics fits.
14. **Refund retries have their own endpoint** (`Retry Refund`) and a refund can
    need bank details (`needs-attention`). Neither is used: a failed refund is
    recorded and left to a person.
15. **The webhook retry windows differ by mode** (live: 3 minutes four times then
    hourly for 72 hours; test: hourly for 10 hours) with a 30-second timeout per
    attempt. This is why the route acknowledges quickly and answers 500 only for
    transient failures.

---

## 9. Pages used

Official Paystack documentation only:

- https://paystack.com/docs/api/transaction/ — Initialize Transaction, Verify
  Transaction (request fields, `data.fees`, `data.paid_at`, `data.channel`,
  `data.id`, channels list, reference alphabet, metadata as a string)
- https://paystack.com/docs/payments/verify-payments/ — transaction statuses,
  verifying from the callback, `response.status` vs `response.data.status`,
  "webhooks are only sent for successful transactions"
- https://paystack.com/docs/payments/webhooks/ — creating an endpoint, signature
  validation (`Paystack-Signature`), the legacy `x-paystack-signature`, IP
  whitelisting, the go-live checklist, retry behaviour
- https://paystack.com/docs/api/refund/ — Create Refund, Retry Refund, List
  Refunds, Fetch Refund (refund object fields and statuses)
- https://paystack.com/docs/payments/refunds/ — refund statuses, refund events,
  own reference rules, the 10-business-day note
- https://paystack.com/docs/payments/manage-disputes/ — the dispute flow,
  `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve`
- https://paystack.com/docs/api/dispute/ — Resolve a Dispute (`merchant-accepted`
  | `declined`, `refund_amount`, `uploaded_filename`), dispute object fields
- https://paystack.com/docs/api/webhook-events/ — the event log and resend APIs
- https://paystack.com/docs/payments/payment-channels/ — channel behaviour
- https://paystack.com/docs/payments/test-payments/ — test cards, including the
  refund scenario cards
