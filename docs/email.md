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

The reason drives what a person is told. `quota`, `provider_error` and `network`
produce "We could not send the code right now. Please try again in a few
minutes." Everything else produces "Email is temporarily unavailable. Please
contact support at …", because waiting will not fix a wrong key or a refused
sender.

The one place the answer never changes is the "send me a new link" form: it
answers the same sentence whatever happened, so that nobody can use it to ask
"does this address shop here?". Its failure is logged, not shown.

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
