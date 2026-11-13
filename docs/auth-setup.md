# Supabase auth setup

Everything a person with dashboard access has to change for the Supabase auth
flow to work. Nothing here is done by the code in this repository: the settings
live in the Supabase project, and the four email templates are pasted into the
dashboard.

Work through the sections in order. Each one names the values exactly as they
appear in the dashboard; Supabase moves sections around between releases, so
match the label text rather than the menu position.

- [1. Values this app expects](#1-values-this-app-expects)
- [2. Site URL and redirect URLs](#2-site-url-and-redirect-urls)
- [3. Email sign-in settings](#3-email-sign-in-settings)
- [4. Google provider](#4-google-provider)
- [5. Custom SMTP through Brevo](#5-custom-smtp-through-brevo)
- [6. CAPTCHA with Cloudflare Turnstile](#6-captcha-with-cloudflare-turnstile)
- [7. Email templates](#7-email-templates)
- [8. Check it works](#8-check-it-works)
- [9. Where the code lives](#9-where-the-code-lives)

## 1. Values this app expects

The auth code reads the project URL and anon key through `lib/env.ts`, so these
must be set in the deployment environment (they are already listed in
`.env.example`):

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The project URL, `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon (publishable) key |
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key. Server only; used to read `public.user_roles` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The Turnstile **site key**, for the browser widget |
| `TURNSTILE_SECRET_KEY` | The Turnstile **secret key**, if anything server-side ever verifies a token itself |

The five hosts are also read from the environment, because the links in the
emails have to point at a real host:

| Variable | Example |
| --- | --- |
| `NEXT_PUBLIC_HOST_PUBLIC` | `affilova.vercel.app` |
| `NEXT_PUBLIC_HOST_AFFILIATE` | `affiliates.affilova.vercel.app` |
| `NEXT_PUBLIC_HOST_MERCHANT` | `merchants.affilova.vercel.app` |
| `NEXT_PUBLIC_HOST_ACCOUNT` | `account.affilova.vercel.app` |
| `NEXT_PUBLIC_HOST_ADMIN` | `admin.affilova.vercel.app` |

Hosts only, with no `https://` and no trailing slash. `NEXT_PUBLIC_APP_ENV` must
be `development`, `preview` or `production`; it decides whether cookies are
marked `Secure`.

Never put the service role key in a `NEXT_PUBLIC_*` variable.

## 2. Site URL and redirect URLs

**Authentication → URL Configuration.**

**Site URL** — this is the base of every link in the auth emails, because the
templates below start with `{{ .SiteURL }}`:

```
https://affilova.vercel.app
```

**Redirect URLs** — add all six, one per line, exactly as written:

```
https://affilova.vercel.app/**
https://affiliates.affilova.vercel.app/**
https://merchants.affilova.vercel.app/**
https://account.affilova.vercel.app/**
https://admin.affilova.vercel.app/**
http://localhost:3000/**
```

The five `vercel.app` hosts are the deployment hosts. `localhost` is for local
work. The `/**` matters: without it Supabase rejects any path on that host and
silently falls back to the Site URL, which loses the `token_hash` and lands the
user on the home page instead of the confirm route.

When a custom domain is added later, add its host here as well and set the
matching `NEXT_PUBLIC_HOST_*` variable. The two lists have to agree.

## 3. Email sign-in settings

**Authentication → Providers → Email.**

| Setting | Value | Why |
| --- | --- | --- |
| Enable email provider | on | Sign-up and sign-in use email and password |
| Confirm email | **on** | An address is proved before the account can sign in. The sign-up action and the sign-in action both depend on this: sign-in returns "Confirm your email address first." until the link is used |
| Secure email change | on | Both the old and the new address have to confirm a change |

**Password requirements** (same email provider section, or Authentication →
Password settings, depending on the dashboard version):

| Setting | Value | Why |
| --- | --- | --- |
| Minimum password length | **10** | Matches `lib/identity/schemas.ts`. A mismatch shows the user a Supabase error after the form has already accepted the password |
| Required characters | none | Length only. Strength comes from the breached-password check and the length rule |
| Prevent use of leaked passwords | optional | Available on the Pro plan and above. The app already checks the Have I Been Pwned range API itself (`lib/identity/password.ts`), so this is a second layer, not a requirement |

The app's own breached-password check fails open: if HIBP is unreachable, sign-up
continues. Turning this Supabase setting on as well means a leaked password is
still refused during an outage.

## 4. Google provider

1. In Google Cloud Console, create an OAuth 2.0 Client ID of type **Web
   application**.
2. Add this **Authorized redirect URI**, with your project ref in place:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase, **Authentication → Providers → Google**: enable it and paste the
   client ID and client secret.

The app does not use Google's callback directly. `signInWithGoogleAction()` asks
Supabase for an authorization URL, the browser goes to Google, Google returns to
Supabase, and Supabase sends the browser to `/auth/callback` on this app with a
one-time `code`, which `app/auth/callback/route.ts` exchanges for a session.

Nothing needs to be added to Google for `/auth/callback`: it is reached from
Supabase, not from Google.

## 5. Custom SMTP through Brevo

Supabase's built-in email sender is rate limited and meant for testing, so
confirmation and reset emails have to go out through Brevo.

1. In Brevo, open **SMTP & API → SMTP** and create an SMTP key.
2. Verify the sender domain or address first, otherwise Brevo refuses to send.
3. In Supabase, **Authentication → Emails → SMTP Settings**: enable custom SMTP
   and fill in:

| Field | Value |
| --- | --- |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the Brevo account login (the address shown with the SMTP key) |
| Password | the Brevo **SMTP key**, not the account password |
| Sender email | the verified sender address, e.g. `no-reply@affilova.com` |
| Sender name | `Affilova` |

Port 587 with STARTTLS is what Brevo recommends; 465 works too if your network
blocks 587. Keep the same sender address in `EMAIL_FROM` so the app's own
transactional email matches what auth sends.

Then send a test email from the same dashboard page and confirm it arrives
before asking anyone to sign up.

## 6. CAPTCHA with Cloudflare Turnstile

1. In Cloudflare, **Turnstile → Add widget**. Add the hosts
   `affilova.vercel.app`, `affiliates.affilova.vercel.app`,
   `merchants.affilova.vercel.app`, `account.affilova.vercel.app`,
   `admin.affilova.vercel.app` and `localhost`.
2. Copy the **site key** into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the **secret
   key** into `TURNSTILE_SECRET_KEY`.
3. In Supabase, **Authentication → Attack Protection** (labelled *Bot and Abuse
   Protection* in some versions): enable **Enable CAPTCHA protection**, choose
   **Turnstile** as the provider, and paste the secret key.

The actions pass the widget's token to Supabase as `captchaToken`. A failed
captcha comes back as the error code `captcha_failed`, which the app shows as
"Verification failed. Please try again."

If CAPTCHA protection is enabled in Supabase, every action that can create or
use a session must send a token, so the forms need the widget before this is
switched on.

## 7. Email templates

**Authentication → Emails → Templates.** Replace the content of four templates.
The subjects below are suggestions; the links are not.

Every link has this shape, and **none of them use `{{ .ConfirmationURL }}`**:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>
```

`/auth/confirm` reads `token_hash` and `type`, calls
`supabase.auth.verifyOtp()`, and only accepts these type values:
`signup`, `invite`, `magiclink`, `recovery`, `email_change`, `email`.

The templates are plain HTML with inline styles and no tables, so they render on
a phone as well as in a desktop client. There is no tracking pixel and no remote
asset other than the logo.

### Confirm signup

- Template: **Confirm signup**
- Subject: `Confirm your Affilova email address`
- Link type: `signup`

```html
<div style="margin:0;padding:24px 12px;background-color:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px 24px;color:#14181c;">
    <div style="margin-bottom:24px;">
      <img src="{{ .SiteURL }}/brand/email/affilova-logo-email.png" alt="Affilova" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;">
    </div>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14181c;">Confirm your email address</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3c454d;">
      Thanks for signing up to Affilova. Confirm this email address to finish creating your account.
    </p>
    <p style="margin:0 0 24px;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup"
         style="display:inline-block;padding:14px 24px;background-color:#10813F;color:#ffffff;border:2px solid #14A953;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">
        Confirm my email
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3c454d;">
      If the button does not work, copy this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#10813F;word-break:break-all;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7680;border-top:1px solid #e6e8e6;padding-top:16px;">
      If you did not request this, you can ignore this email.
    </p>
  </div>
</div>
```

### Magic link

- Template: **Magic Link**
- Subject: `Your Affilova sign-in link`
- Link type: `magiclink`

```html
<div style="margin:0;padding:24px 12px;background-color:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px 24px;color:#14181c;">
    <div style="margin-bottom:24px;">
      <img src="{{ .SiteURL }}/brand/email/affilova-logo-email.png" alt="Affilova" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;">
    </div>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14181c;">Your sign-in link</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3c454d;">
      Use this link to sign in to Affilova. The link can only be used once.
    </p>
    <p style="margin:0 0 24px;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=magiclink"
         style="display:inline-block;padding:14px 24px;background-color:#10813F;color:#ffffff;border:2px solid #14A953;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">
        Sign in to Affilova
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3c454d;">
      If the button does not work, copy this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#10813F;word-break:break-all;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7680;border-top:1px solid #e6e8e6;padding-top:16px;">
      If you did not request this, you can ignore this email.
    </p>
  </div>
</div>
```

### Reset password

- Template: **Reset Password**
- Subject: `Reset your Affilova password`
- Link type: `recovery`, with `&next=/auth/reset-password` so the confirmed
  session lands on the page that asks for a new password

```html
<div style="margin:0;padding:24px 12px;background-color:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px 24px;color:#14181c;">
    <div style="margin-bottom:24px;">
      <img src="{{ .SiteURL }}/brand/email/affilova-logo-email.png" alt="Affilova" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;">
    </div>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14181c;">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3c454d;">
      We received a request to reset the password for your Affilova account. Choose a new password with the button below.
    </p>
    <p style="margin:0 0 24px;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/auth/reset-password"
         style="display:inline-block;padding:14px 24px;background-color:#10813F;color:#ffffff;border:2px solid #14A953;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">
        Choose a new password
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3c454d;">
      If the button does not work, copy this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#10813F;word-break:break-all;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7680;border-top:1px solid #e6e8e6;padding-top:16px;">
      If you did not request this, you can ignore this email.
    </p>
  </div>
</div>
```

### Change email

- Template: **Change Email Address**
- Subject: `Confirm your new Affilova email address`
- Link type: `email_change`
- `{{ .NewEmail }}` is the address being added, and it is the only template that
  supports that variable

```html
<div style="margin:0;padding:24px 12px;background-color:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px 24px;color:#14181c;">
    <div style="margin-bottom:24px;">
      <img src="{{ .SiteURL }}/brand/email/affilova-logo-email.png" alt="Affilova" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;">
    </div>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14181c;">Confirm your new email address</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3c454d;">
      We received a request to change the email address on your Affilova account to {{ .NewEmail }}.
    </p>
    <p style="margin:0 0 24px;">
      <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email_change"
         style="display:inline-block;padding:14px 24px;background-color:#10813F;color:#ffffff;border:2px solid #14A953;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">
        Confirm new email address
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3c454d;">
      If the button does not work, copy this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#10813F;word-break:break-all;">
      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7680;border-top:1px solid #e6e8e6;padding-top:16px;">
      If you did not request this, you can ignore this email.
    </p>
  </div>
</div>
```

## 8. Check it works

1. Sign up with a new address. The response is always "Check your email to
   confirm your account", whether or not the address was already registered.
2. Open the email and follow the button. It goes to
   `/auth/confirm?token_hash=...&type=signup`, which verifies the token and
   redirects to `/`.
3. Check the database: a row in `public.profiles` with `first_name`,
   `last_name` and `display_name` filled from the sign-up form (the migration
   `20261112000300_profile_names_from_metadata.sql` does that), and a `customer`
   row in `public.user_roles`.
4. Try to sign in before confirming: it must say "Confirm your email address
   first."
5. Use "Forgot password" and follow the email: the link ends on
   `/auth/reset-password`.
6. Try Google sign-in: it comes back through `/auth/callback` with a session.
7. Try an expired or already used link: it goes to
   `/auth/login?error=link_invalid`.

## 9. Where the code lives

| File | Job |
| --- | --- |
| `lib/identity/app-urls.ts` | Absolute URLs for the email links and OAuth callbacks |
| `lib/identity/safe-next.ts` | Validates a `next` value before it becomes a redirect |
| `lib/identity/password.ts` | Have I Been Pwned range check, fails open |
| `lib/identity/schemas.ts` | Zod schemas for every auth form |
| `lib/identity/session.ts` | `getAuthUser()` and `getUserRoles()` for server code |
| `lib/supabase/middleware.ts` | `updateSession()`, the session refresh step. Not wired into `middleware.ts` yet |
| `app/auth/actions.ts` | Server actions: sign up, sign in, Google, sign out, reset, update password |
| `app/auth/callback/route.ts` | OAuth code exchange |
| `app/auth/confirm/route.ts` | `token_hash` verification for the email links |

The legacy login under `app/api/auth/*` and `lib/auth.ts` is untouched and keeps
working. Only the new pages call the actions above.
