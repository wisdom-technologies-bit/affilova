# Email

Affilova sends transactional email and nothing else: a purchase receipt with the
download link, a resend of that link, a withdrawal notice, and a step-up code
before a payout setting is changed. There is no newsletter, no drip campaign and
no marketing list, so there is no unsubscribe link to get wrong.

## How a message is sent

Everything goes through `sendEmail()` in `lib/email/brevo.ts`, which posts to
Brevo's `POST /v3/smtp/email`.

- **Server only.** The module imports `server-only`, so an accidental import from
  a client component is a build error rather than a leaked key.
- **The content comes from `lib/email/templates.ts`.** A template is a function
  that returns `{ subject, html, text }` from named values. The `template` field
  on a send is a short name (`purchase_receipt`, `step_up_code`,
  `access_link_resend`, `withdrawal_notice`, `admin_email_test`) used for logs and
  for the failures table. It is never the subject.
- **Ten second timeout, three attempts at most.** A 5xx or a refused connection
  is retried; a 4xx is our mistake and retrying it only delays the failure.
- **Nothing sensitive is ever logged.** Not the recipient, not the subject, not
  the body, not the key and not Brevo's error body. A log line carries the
  template name, the status, the reason and whether the failure is retryable.

### What is stored

`public.email_log` records one claim per `(kind, order, recipient hash)` so a
retried job never sends the same receipt twice. The address itself is not in that
table: it holds a truncated SHA-256 of it.

`public.email_failures` records one row per message that was finally given up on:
the template name (cut to 60 characters), the provider's HTTP status (`0` when the
request never got an answer), a reason from the list below, and the time. No
address, no subject, no body, no provider message. A row is written once per
message, after the last attempt, never once per retry, and the write is bounded
at one second so diagnostics can never hold up a send. The daily `cleanup` job
calls `public.purge_old_email_failures(30)` and forgets anything older than
thirty days.

## The failure reasons

A failed send is described by one of these, never by Brevo's words. The mapping
lives in `lib/email/reasons.ts`; the status decides, and the machine code and the
message only break the ties the status leaves open.

| reason | what it means | what to do |
| --- | --- | --- |
| `unauthorized` | Brevo refused the API key (401 or 403). | Check `BREVO_API_KEY`. It must be an **API key**, not an SMTP key. |
| `ip_not_authorized` | Brevo refused the connection because the IP is not on the account's allowlist (401 or 403 whose message or code mentions an unrecognised or unauthorised IP). | Vercel's egress addresses change, so either allowlist them or turn the IP restriction off: Brevo, **Security**, **Authorized IPs**. |
| `invalid_sender` | Brevo refused the sender (400 whose message or code mentions the sender or a free mail domain). | `EMAIL_FROM` must be on a domain the account has authenticated. A `gmail.com` address is never accepted as a sender. |
| `invalid_request` | Brevo refused the request itself (any other 400, or an undocumented 4xx). | Usually a malformed sender address or a missing field. Check that `EMAIL_FROM` is a plain address with no display name. |
| `quota` | Brevo refused the message for a quota or rate reason (402, 429). | Check the plan's daily sending limit and the account's credit balance. |
| `provider_error` | Brevo answered 5xx. The send is retried first. | Usually clears on its own. If it does not, check Brevo's status page. |
| `network` | The request never completed: a timeout, a refused connection or DNS. | The send is retried first. If it persists, the deployment cannot reach `api.brevo.com`. |
| `not_configured` | `BREVO_API_KEY` or `EMAIL_FROM` is missing. No request is made. | Set both in the deployment. |
| `suppressed` | The address is on the suppression list: an earlier message to it hard bounced, was blocked or was marked as spam. No request is made and **no failure row is written**, because nothing failed at Brevo. | Nothing, until an admin removes the entry on the Security page. See [The suppression list](#the-suppression-list). |

The reason drives what a person is told. `quota`, `provider_error` and `network`
produce "We could not send the code right now. Please try again in a few
minutes." Everything else produces "Email is temporarily unavailable. Please
contact support at …", because waiting will not fix a wrong key or a refused
sender.

The one place the answer never changes is the "send me a new link" form: it
answers the same sentence whatever happened, so that nobody can use it to ask
"does this address shop here?". Its failure is logged, not shown.

## The templates

Every message is built with [React Email](https://react.email) and lives in
`emails/`. The two packages this repository adds for it are
`@react-email/components` and `@react-email/render`, both official.

```
emails/
  components/        EmailLayout, Heading, Paragraph, PrimaryButton, InfoBox,
                     OrderSummary, Code, SecondaryText
  templates/         one file per message, each with typed props, a sample
                     props export and a subject function
  dist/              the four Supabase Auth templates, rendered and committed
  catalog.ts         every template with the props the style guide shows it with
  render.ts          one template to { html, text }
```

**The rules every template follows.** They are asserted for every template in
`emails/templates.test.ts`, so a new template is covered by adding it to the
catalogue.

- 600px maximum width, `lang="en"`, one `<h1>`, and a preview line that is hidden
  from the body.
- The brand header uses the existing `/brand/email/affilova-logo-email.png` with
  alt text. That image and the links are the only remote requests.
- Inline styles only. No stylesheet, no `@import`, no `@font-face`, no external
  font: the stack is the reader's own system font.
- No tracking pixel, no open tracking, no click rewriting. The only images are
  the logo.
- The primary button is `brand-600` (#107F3E) with white text, at least 44px high,
  and the link is **printed underneath it** as text, so a client that drops the
  background colour still leaves a way through.
- Colours and spacing come from `lib/design/tokens.ts` (`EMAIL_COLOURS`,
  `EMAIL_SPACE_PX`, `EMAIL_FONT_STACK`). A test fails on a hex value in the HTML
  that is not one of those tokens.
- Contrast is checked at 4.5:1 for body text, the button label and each semantic
  pair, using `lib/design/contrast.ts`.
- Every message is under 100 KB, and every link in it is absolute `https`.
- User-supplied text (a product title, a name, a rejection reason) is escaped by
  React. A test renders a `<script>` tag, quotes, ampersands and a 500-character
  title through a real template and asserts the markup is escaped and the message
  stays small.
- A product title in a **subject** is flattened to one line and cut to 80
  characters, ellipsis included (`emails/subject.ts`).

**The callers did not change.** The public functions in `lib/email/templates.ts`
(`purchaseReceiptEmail`, `withdrawalNoticeEmail`, …) keep their names, their props
and their `{ subject, html, text }` shape. They are now thin adapters over the
templates in `emails/`, and they are still synchronous, because their callers are.
The plain-text version is produced by `@react-email/render`'s own converter
(`toPlainText`). In 2.3.1 that is exactly what its `plainText: true` option
returns, so the text is the package's conversion and not a second format; a test
asserts every template's text is that converter's output for that template's
HTML. The package's async `render()` cannot be used here even from a test: under
React 19.3.1 its streaming renderer fails on these templates with "Element type
is invalid" while `renderToStaticMarkup` renders the same element, so the
synchronous call is the one path.

**Where to look at them.** The admin style guide has an **Emails** section at
`/design/emails`, behind the same staff guard and two-factor wrapper as the rest
of `/design`. Every template is rendered with its sample props inside an iframe
with an empty `sandbox` attribute (no scripts, no forms, no top navigation), at
600px and at 360px, with its plain-text version underneath. The frames are the
real templates, not screenshots. `docs/design-review/emails/` holds the review
screenshots taken from that page.

**The four Supabase Auth templates** are not sent by this application: Supabase
sends them. They are in `emails/templates/auth.tsx` so they share the layout and
the tokens, and they are rendered to static files by `pnpm emails:export` into
`emails/dist/`, committed so the owner can paste them in without running
anything. See `docs/auth-setup.md`.

## The suppression list

Writing to an address that has hard bounced, is blocked, or has complained is what
damages a sending domain: the complaint rate is what providers judge a sender on.
So Brevo's transactional webhook writes those addresses to a list, and every send
asks the list first.

### What is stored, and what is not

`public.email_suppressions` (migration `20261127000100_email_suppressions.sql`)
holds **no address**. A row is:

| column | meaning |
| --- | --- |
| `recipient_hash` | SHA-256, 64 lower-case hex characters. Primary key. |
| `reason` | `hard_bounce`, `complaint`, `blocked`, `invalid` or `unsubscribed`. |
| `source` | Where it came from: `brevo_webhook`, `manual`, or a template name. |
| `first_seen` | When the address was first suppressed. Never changes. |
| `last_seen` | When it was last confirmed. Moves forward on every repeat. |
| `events` | How many times it has been confirmed. |

The hash is computed in one place, `lib/email/suppression.ts`:

```
sha256( EMAIL_HASH_PEPPER + ":" + lower(trim(address)) )  as 64 lower-case hex
```

`EMAIL_HASH_PEPPER` is required when an address is hashed, is at least 32
characters, and lives only in the deployment. Without it the table cannot be
turned back into a list of addresses by hashing a list of guesses, and a copy of
the table is not a list of addresses. **Rotating the pepper makes every stored
hash unreadable**, so it is rotated only with a decision to rebuild the list.

### What the application does with it

- `sendEmail()` asks `is_email_suppressed()` before the first attempt, for every
  template. A suppressed address returns `{ ok: false, reason: "suppressed" }`,
  no request goes to Brevo, and **no failure row is written**: the failures table
  is "Brevo refused us", and this is "we chose not to ask".
- **It fails open.** A database error, a timeout (one second) or a missing pepper
  is logged and the message is sent anyway. Blocking every message because the
  database blipped is worse than one message to an address that bounced last
  month: the buyer waiting for a download link cannot tell the difference between
  "we chose not to send" and "we are broken".
- The functions are `SECURITY DEFINER` with `search_path = ''`, revoked from
  `public`, `anon` and `authenticated`, granted to `service_role` only, and the
  table has row level security on with no policy. `remove_email_suppression` is
  admin only, requires a note, and writes an audit row.
  `email_suppression_overview` is admin or finance and returns counts by reason
  and the last ten entries, with no address in the payload (there is no address
  column to return).
- The admin **Security** page, Email card, shows the counts by reason and says
  that an address is added when Brevo reports a bounce, a block, an invalid
  address, an unsubscribe or a complaint.

### The webhook

```
POST https://<admin host>/api/brevo/webhook/<BREVO_WEBHOOK_TOKEN>
```

- **POST only.** Anything else is 405 with `Allow: POST`.
- **The path token is the credential.** Brevo documents no signature on a
  transactional webhook, so the token must equal `BREVO_WEBHOOK_TOKEN` (at least
  32 URL-safe characters), compared in constant time. A wrong token, or a
  deployment with no token configured, answers **404 with an empty body**: a
  prober learns nothing, not even that the route exists.
- **64 KB body limit**, checked against `content-length` before the body is read
  and against the decoded bytes after.
- **Parsed with Zod** against the fields Brevo documents for a transactional
  event: `event`, `email`, `id`. Everything else in the body (subject, tags,
  `sending_ip`, `mirror_link`) is dropped unread.
- **The address is hashed and written, and never stored, logged or returned.**
  The log line carries the event name, the reason, Brevo's webhook id and whether
  the write worked.
- **A valid body always answers 200**, including when the write failed: a 5xx
  makes Brevo retry, and a retry of "this address complained" does not become
  truer. An unknown event is 200 as well, so a new Brevo event type does not
  produce an endless retry.
- **Rate limited** at 600 requests a minute per source address, keyed on a hash of
  it, and set to allow when the limiter itself is unavailable.

### Which events are acted on

The `event` value in the body is snake_case. The dashboard and Brevo's
`POST /v3/webhooks` API use different spellings for the same events, so both are
listed:

| Brevo event (payload `event`) | Dashboard / API name | What happens |
| --- | --- | --- |
| `hard_bounce` | Hard Bounce / `hardBounce` | suppressed as `hard_bounce` |
| `spam` | Spam / `spam` | suppressed as `complaint` |
| `blocked` | Blocked / `blocked` | suppressed as `blocked` |
| `invalid_email` | Invalid Email / `invalid` | suppressed as `invalid` |
| `unsubscribed` | Unsubscribed / `unsubscribed` | suppressed as `unsubscribed` |
| `soft_bounce` | Soft Bounce / `softBounce` | **ignored**: a full mailbox is not a dead address |
| `deferred`, `delivered`, `request`, `sent`, `opened`, `unique_opened`, `click`, `error`, `proxy_open`, `unique_proxy_open` | the same names | ignored |
| anything else | — | ignored, and logged as `brevo_webhook_unknown_event` |

### Setting it up in Brevo

1. Generate the token and put it in the deployment, together with the pepper:

   ```bash
   openssl rand -hex 24     # BREVO_WEBHOOK_TOKEN
   openssl rand -base64 48  # EMAIL_HASH_PEPPER
   ```

2. In Brevo, open **Transactional**, then **Settings**, then **Webhooks**, and
   click **Add a new webhook**. (Brevo's current help centre describes outbound
   webhooks under the account menu, **Integrations → Webhooks**; the
   transactional page is the one that carries these events. *UNVERIFIED*: the
   exact menu path in the dashboard at the time you read this. The event list and
   the payload are verified; the labels move.)
3. Set the **URL** to `https://<admin host>/api/brevo/webhook/<BREVO_WEBHOOK_TOKEN>`.
   The path segment is the secret: do not put the token in a query string, where
   it lands in logs.
4. Tick **Hard Bounce**, **Blocked**, **Spam**, **Invalid Email** and
   **Unsubscribed**. Leave **Soft Bounce** off; the route ignores it if it
   arrives anyway.
5. Save, then send one message to an address you know is dead (a domain that does
   not resolve) and check that the row appears:

   ```sql
   SELECT reason, source, events, first_seen, last_seen
     FROM public.email_suppressions
    ORDER BY last_seen DESC
    LIMIT 10;
   ```

   There is no address in that table, so match it by hashing the address you used:

   ```sql
   SELECT public.is_email_suppressed(
     encode(sha256(convert_to('<EMAIL_HASH_PEPPER>:dead@example.invalid', 'utf8')), 'hex')
   );
   ```

6. Brevo publishes its sending IP ranges; the webhook does not enforce them,
   because a proxy in front of the deployment would then silently drop every
   suppression. The path token is the control.

**Brevo documentation used for this section** (read on 27 November 2026):

- <https://developers.brevo.com/docs/transactional-webhooks> — the transactional
  event list, the payload shape, the field names, and the note that `ts_epoch`
  and `ts_event` are UTC while `date` is CET/CEST.
- <https://developers.brevo.com/docs/how-to-use-webhooks> — the notify URL, the
  event categories and the 40-webhook limit.
- <https://developers.brevo.com/reference/create-webhook> — the API's event
  spellings (`hardBounce`, `softBounce`, `invalid`, …) and the `type:
  transactional` field, which is where the dashboard-name column above comes
  from.
- <https://help.brevo.com/hc/en-us/articles/27824932835474-Create-outbound-webhooks-to-send-real-time-data-from-Brevo-to-an-external-app>
  — the account-menu path for outbound webhooks.

Marked **UNVERIFIED**: the dashboard's exact menu path for *transactional*
webhooks (the help-centre article above is the general outbound webhook flow), and
whether Brevo sends an `unsubscribed` event for a transactional message in every
case. The route treats it as a suppression if it arrives, which is the safe
answer either way.

## The Brevo checklist

Four things stop a deployment from sending, in the order they usually go wrong.

1. **The key must be an API key.** Brevo, **SMTP & API**, **API keys**. The key
   starts with `xkeysib-`. The key on the **SMTP** tab starts with `xsmtpsib-` and
   is for sending over SMTP, not for this API: it is refused with a 401. The
   Security page says which kind the deployment holds.
2. **Authorized IPs must not block the deployment.** Brevo, **Security**,
   **Authorized IPs**. Vercel does not publish a fixed egress range, so an
   allowlist built from one deployment's address will block the next one. Either
   leave the restriction off or keep the range current. A blocked address arrives
   as a 401 or 403 whose message names the IP, and is reported as
   `ip_not_authorized`.
3. **The sender must be on an authenticated domain.** Brevo, **Senders, Domains &
   IPs**, **Domains**. Add the domain, then add the DNS records Brevo shows:
   - the DKIM record (two CNAMEs, or a TXT depending on the domain), and
   - the Brevo code, a TXT record on the domain or on a `@`/subdomain name.

   A free mailbox (`gmail.com`, `yahoo.com`, `outlook.com`, `hotmail.com`,
   `icloud.com`, `proton.me` and the rest of the list in `lib/email/reasons.ts`)
   cannot be a sender. A display name in `EMAIL_FROM` (`Affilova <no-reply@…>`)
   is also refused: the value must be a plain address.
4. **`EMAIL_REPLY_TO` should be a mailbox someone reads.** It does not affect
   delivery, but without it a buyer who replies to a receipt reaches nobody.

`ORDER_ACCESS_SECRET` and `STEP_UP_SECRET` are not Brevo settings, but the Email
card reports them because a missing one breaks the link in the receipt or the
code before a payout change. Both must be at least 32 characters.

## The self-test

The admin Security page has an **Email** card with a **Send test email** button.

- It sends one short plain message **to the signed-in admin's own address**,
  taken from the session. There is no field for another recipient.
- It uses the real `sendEmail()`, the real key and the real sender, so a green
  result proves the whole path: the deployment can reach Brevo, the key is
  accepted and the sender is allowed.
- It is limited to **three sends an hour per person**, and it is admin only.
- On a failure the card shows the reason code and the sentence from the table
  above. It never shows an address, and neither the address nor Brevo's answer is
  logged or returned.

The card above the button is read-only and needs no send: it reports the
configuration health as categories (`apiKeyKind`, `fromDomainKind`, whether the
secrets are set), the failures of the last 24 hours grouped by reason, and the
last ten failures. A moderator sees the health but not the failures, because
`public.email_failure_overview()` allows only admin and finance.

## Checking by hand

```sql
-- What failed in the last day, and why.
SELECT reason, status, count(*)
  FROM public.email_failures
 WHERE created_at >= now() - interval '24 hours'
 GROUP BY reason, status
 ORDER BY count(*) DESC;
```

If the table is empty and messages are still not arriving, the problem is before
the send: `not_configured` writes no row, and the log line is
`email_not_configured`.
