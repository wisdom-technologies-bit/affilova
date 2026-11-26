# Privacy notes: third parties that receive data

For whoever writes the privacy policy. This lists every external service the
product sends data to, what each one receives, and why. It is written from the
code, not from a vendor's marketing page, so it can be checked line by line.
Where the code does something deliberate to keep data away from a provider, that
is written down too.

Nothing here is a legal conclusion. It is the factual input a policy needs: who
receives what, for which purpose.

## At a glance

| Third party | What it receives | Why |
| --- | --- | --- |
| **Paystack** | the buyer's email address, the order total in kobo, the currency, and our order reference | to take the card payment and tell us whether it succeeded |
| **Brevo** | the recipient's email address and name, and the subject and body of a transactional email | to send order, account and payout email |
| **Cloudflare R2** | the product files a vendor uploads, as private objects | to store the files a buyer downloads |
| **Cloudflare Turnstile** | a browser challenge answer, and the visitor's IP address when we redeem it | to tell a person from a bot at checkout |
| **Cloudinary** | product cover images, uploaded from the browser | to store and serve product images |
| **Supabase** | the database rows: accounts, products, files, orders, payouts, scan results, audit log; plus auth credentials | the application database and sign-in |
| **Vercel** | every request to the app: IP address, user agent, cookies, URLs, and the response | to host and serve the app |
| **Railway** | the scanner service's traffic, including the private download URL for each uploaded file and the file bytes as they pass through | to run the scanner service |
| **Sentry** | error and performance events, with personal data switched off and email addresses masked | to find and fix crashes |
| **Bouncer** | uploaded product files, for malware scanning | to decide whether an uploaded file is safe before it can be sold |

## Each one in detail

### Paystack: payments

We create a transaction with the buyer's **email address**, the **amount in
kobo**, the **currency** and our own **order reference**, and send the buyer to
Paystack's checkout page. Paystack collects the card details; they never reach
our servers, our database or our logs. Paystack calls a signed webhook back with
the outcome, which is how an order becomes paid.

We do not send a name, an address, a phone number or any product content.

### Squad (removed)

The legacy Squad payment route (`lib/squad.ts`, `app/api/payments/squad/*`) was
deleted in `chore/remove-legacy`. Paystack is the only payment provider in the
code, so the policy should name no second provider.

### Brevo: transactional email

Brevo sends our email: order confirmations, account messages and payout notices.
A send contains the **recipient's email address**, optionally their **name**, and
the **subject and body** of that one message. The body can contain an order
reference, an amount, a product title or a link back into the app; it never
contains a password, a card detail or a file.

We store the message id Brevo returns so a failed send can be traced. We do not
use Brevo for marketing lists.

### Cloudflare R2: uploaded product files

Vendor files are stored as private objects in R2. R2 holds the **file bytes** and
the **object key**, which contains the product id, the file id and the sanitized
file name.

Nothing is public. A download is a **five minute signed URL**; a scan gets a
thirty minute one. The scanner and the buyer see those URLs, and the URL is
treated as a credential: it is never logged and never returned in an error.

### Cloudflare Turnstile: bot check

Turnstile runs a challenge in the buyer's browser at checkout and at sign-up. The
browser talks to Cloudflare directly, so Cloudflare sees the **IP address and
browser signals** of that visitor. We redeem the token server-side with the
visitor's **IP address**, and Cloudflare answers whether the challenge passed,
and for which host.

The token is single use. The challenge fails closed: if Cloudflare is unreachable,
the checkout is refused rather than let through.

### Cloudinary: product images

A vendor's cover image goes **from the browser straight to Cloudinary**, with a
signature we make. We do not store the image, and the image bytes never pass
through our server. We read back the size, format and dimensions through the
Admin API, because a client can claim anything in an upload form.

Cloudinary holds the **image**, and serves it to buyers. An image can contain a
person's face if a vendor chooses one; that is the vendor's content, not data we
collect about a buyer.

### Supabase: database and sign-in

Supabase is the application database and the auth provider. It holds the
**account records** (email address, hashed password or OAuth identity, role),
**products**, **product files** metadata (name, size, type, storage key),
**orders** (buyer email, amount, status, reference), **payouts**, **affiliate
clicks and conversions**, **scan results**, and the **audit log**.

Supabase Auth sends its own verification and password-reset email through the
SMTP provider configured in the Supabase project, so those messages are handled
by Supabase and that provider rather than by Brevo.

### Vercel: hosting

The app is served from Vercel, so Vercel sees **every request**: IP address, user
agent, cookies, the URL, and the response. That is inherent in hosting. Server
logs we write ourselves contain identifiers and outcome codes, never a signed URL,
a token, a password or a file.

### Railway: the scanner service

The scanner service runs on Railway. It receives, for each scan, the **private R2
download URL** for one uploaded file, and it downloads the **file bytes** through
it. It also sends the verdict back to the app.

The service is stateless: it deletes the temporary copy on every path, and it
keeps no record of a file after the callback. Railway, as the host, sees the
service's network traffic and its logs. The service's own log lines carry the scan
id, the file id, the verdict and timings; never the URL, the file name or the
bytes.

### Sentry: error reporting

Sentry receives **error and performance events** from the app and the edge, so a
crash can be found and fixed. Our configuration switches off every category of
personal data the SDK can collect: no user info, no cookies, no request or
response bodies, no query parameter values, no database payloads, no local
variables, no session replay. Header values that carry credentials are removed,
and any email address in a message is masked before the event leaves the process.

### Bouncer: malware scanning

**Bouncer receives uploaded product files, for malware scanning.** That is the
whole purpose of the transfer. For each file we send the **file bytes**, the
**file name** and the **MIME type**, and we receive a verdict: clean, malicious or
suspicious, with a threat name when there is one.

* Only files a vendor uploads are sent. No buyer data, no account data, no order
  data and no cover images go to Bouncer.
* The file is uploaded from the scanner service, not from a browser, and the
  request carries our API key rather than a user's identity.
* Files over **25 MB** are never sent: the app refuses them at upload and the
  scanner refuses them before uploading.
* The scanner deletes its local copy as soon as the scan ends, whatever the
  verdict.

A file that Bouncer calls malicious is copied to a quarantine prefix in R2 and
removed from its live key. It is never served to a buyer.

## What we deliberately do not send

* Card details: they go from the buyer's browser to Paystack only.
* Passwords: only a hash reaches Supabase.
* Signed storage URLs: never logged, never in an error message, never in an
  analytics event.
* Scanner secrets, the Bouncer key and the callback secret: never logged, never
  returned to a browser.
* Product files to anyone other than R2 (storage), Railway (the scanner's host,
  in transit) and Bouncer (scanning).

## Keeping this current

Add a row here when a new external service is introduced, and name the fields it
receives rather than describing it in general terms. The scanning side of this
document is described in more detail in `docs/scanning.md` and
`docs/scanning-contract.md`; the payment side in `docs/paystack.md`.
