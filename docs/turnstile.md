# Turnstile on the new auth pages

This note covers the Cloudflare Turnstile setup for `/sign-in`, `/sign-up` and
`/forgot-password`. Those pages render the widget client-side
(`components/auth/turnstile.tsx`), send the token to a server action as
`captchaToken`, and Supabase verifies it. Nothing in this app verifies a token,
and nothing in this app holds a secret for these flows.

## The public site key

- Variable: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- Read by: `getPublicEnv()` in `lib/env.ts`, where it is already declared as an
  optional public variable. It is public by design: it ships in the page.
- Configured in: Vercel, as a project environment variable (Production,
  Preview and Development as needed), then redeployed.
- If it is missing or blank, the widget cannot run. The page then shows
  "Verification is unavailable on this address. Please use the official site."
  and the submit button stays disabled.

## Hostnames registered on the widget

The widget is configured in the Cloudflare dashboard with these hostnames:

- affilova.vercel.app
- affilova-dashboard.vercel.app
- affilova-merchant.vercel.app
- affilova-account.vercel.app
- affilova-admin.vercel.app
- localhost
- 127.0.0.1
- affilova.com (later, when that domain is live)

**Branch preview URLs are not registered hostnames.** A deploy such as
`affilova-git-feat-auth-ui-parallel-....vercel.app` will fail verification: the
widget reports an error (for example 110200, hostname not allowed) and the page
shows the same "Verification is unavailable on this address" message. Test on
one of the registered hosts instead.

## The secret key

- Lives only in Cloudflare and in the Supabase dashboard (Authentication, then
  Attack Protection, where the Turnstile secret is entered).
- Never in code, never in `.env` for these flows, never in chat.

## Tokens are single use

A Turnstile token can be redeemed once. Consequences that the code follows:

- After **every** submission attempt, successful or not, the form clears its
  stored token and bumps `resetSignal`, which makes the widget call
  `turnstile.reset(widgetId)` so a fresh token can be solved.
- The server action forwards the token to Supabase and Supabase redeems it.
  This app never calls `siteverify`, and never verifies the token in its own
  server code: a second verification would consume the token and make Supabase
  reject it.
- An expired token clears the stored token and keeps submit disabled until a
  new one arrives.

## Actions

The widget is rendered with one of these action names, matching the page:

| Page                | Action            |
| ------------------- | ----------------- |
| `/sign-in`          | `sign_in`         |
| `/sign-up`          | `sign_up`         |
| `/forgot-password`  | `forgot_password` |

Allowed form: 1 to 32 characters of letters, numbers, underscore or hyphen.

## Where the logic lives

- `lib/identity/turnstile.ts`: pure helpers, no `window` access.
  `isValidTurnstileAction(action)` and
  `buildTurnstileOptions(action, siteKey)`, which returns
  `{ sitekey, action, theme: "light", size: "flexible", language: "auto",
  retry: "auto", "refresh-expired": "auto" }`.
- `components/auth/turnstile.tsx`: loads
  `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once
  per page (one tag, guarded by id), renders explicitly, keeps the widget id,
  resets on `resetSignal`, and removes the widget on unmount.

## Out of scope

The legacy routes still verify Turnstile server-side with their existing
secret environment variable (`lib/security.ts`, used by the `app/api/auth/*`
handlers). They are unchanged by this work and are not part of the new flow.
