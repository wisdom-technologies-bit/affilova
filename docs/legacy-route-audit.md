# Legacy route audit

Scope: every `route.ts` under `app/api`. This audit lists the routes that call
none of the session primitives (`getSession`, `verifyToken`, `requireRole`) and
classifies each one, so the remaining legacy surface is explicit.

Date: 2026-11-13
Branch: `fix/legacy-security-hotfix`
Base: `main` at `4cf0b7d`

## How the list was produced

```bash
for f in $(find app/api -name route.ts | sort); do
  if ! grep -qE "getSession|verifyToken|requireRole|verifyAuth" "$f"; then
    echo "$f"
  fi
done
```

18 route files match. `verifyAuth` is the exported alias of `getSession` in
`lib/auth.ts`, so routes using it are treated as session-checked and do not
appear below. `app/api/support/tickets` is split by handler because its `POST`
and its `GET` do not deserve the same verdict.

Nothing outside this document was changed for the audit: no route below was
modified, except where this document records that a route is one of the five
already covered by the hotfix.

## Routes with no session primitive

| # | Route | Methods | Classification | Reason |
|---|-------|---------|----------------|--------|
| 1 | `app/api/auth/forgot-password/route.ts` | POST | Public by design | Auth endpoint. Generic response, IP rate limit and security log, so it cannot be used to probe which emails exist. |
| 2 | `app/api/auth/google/route.ts` | GET, POST | Public by design | Starts the Google OAuth flow. The POST branch requires a Turnstile token. |
| 3 | `app/api/auth/google/callback/route.ts` | GET | Public by design | OAuth redirect target. It exchanges the code for a token and only then issues a session; there is no session to require beforehand. See observation 3. |
| 4 | `app/api/auth/login/route.ts` | POST | Public by design | Auth entry point. Turnstile plus IP rate limits guard it and it sets the `auth-token` cookie itself. |
| 5 | `app/api/auth/register/route.ts` | POST | Public by design | Auth entry point. Turnstile, input validation and OTP verification guard it. |
| 6 | `app/api/auth/reset-password/route.ts` | POST | Public by design | Auth endpoint. Authorised by the reset token from `lib/password-reset`, not by a session. |
| 7 | `app/api/auth/send-otp/route.ts` | POST | Public by design | Auth endpoint. Turnstile and OTP rate limits guard it. |
| 8 | `app/api/auth/verify-otp/route.ts` | POST | Public by design | Auth endpoint. Validates a one time code that was issued by `send-otp`. |
| 9 | `app/api/auth/logout/route.ts` | POST | Public by design | Only deletes the `auth-token` cookie. Requiring a session would make a stale cookie impossible to clear. |
| 10 | `app/api/blog/route.ts` | GET | Public by design | Blog list, published posts only. |
| 11 | `app/api/blog/[slug]/route.ts` | GET | Public by design | Blog post read, published posts only, increments the read counter. |
| 12 | `app/api/blog/category/[slug]/route.ts` | GET | Public by design | Blog category read, published posts only. |
| 13 | `app/api/health/route.ts` | GET | Public by design | Liveness plus a single row database probe. Returns reachability only, no data. |
| 14 | `app/api/cron/[job]/route.ts` | POST | Secret-protected (cron) | `isValidCronSecret` compares the `Authorization: Bearer <CRON_SECRET>` header in constant time before any job runs. Called by the external scheduler, never by a browser. |
| 15 | `app/api/payments/squad/callback/route.ts` | POST | To be replaced (`payments/squad/*`) | Legacy Squad flow. No session check by design for a gateway callback, and no webhook signature header is validated. Being replaced by the Paystack integration. |
| 16 | `app/api/payments/squad/config/route.ts` | GET | To be replaced (`payments/squad/*`) | Legacy Squad flow. Publishes the Squad public key; harmless alone, but part of the flow being removed. |
| 17 | `app/api/payments/squad/webhook/route.ts` | POST | To be replaced (`payments/squad/*`) | Legacy Squad flow. Duplicate of the callback route and likewise has no signature validation; it does re-verify the transaction with the Squad API using the secret key. |
| 18 | `app/api/support/tickets/route.ts` | POST | Public by design | Support ticket form used by signed out visitors. Zod validated, and the ticket is written with a generated alphanumeric id. |
| 19 | `app/api/support/tickets/route.ts` | GET | NEEDS REVIEW | Lists every support ticket, including each ticket holder's name and email address, with no session check at all. This is the only route in this audit that looks like a genuine unauthenticated data leak. Fixing it needs a decision about who reads tickets, so it is reported and not changed here. |

Rows 18 and 19 are the two handlers of one file, split because their verdicts
differ. Counting files, 18 routes are listed.

## Covered by this hotfix (no longer in the list)

| Route | Change |
|-------|--------|
| `app/api/admin/dashboard-stats/route.ts` | `requireRole(["admin"])`, 401 `Unauthorized` / 403 `Forbidden` |
| `app/api/vendor/dashboard-stats/route.ts` | `requireRole(["vendor"])`, plain `user_id` cookie read deleted, queries now use `session.userId` |
| `app/api/affiliate/dashboard-stats/route.ts` | `requireRole(["affiliate"])`, plain `user_id` cookie read deleted, queries now use `session.userId` |
| `app/api/blog/rate/route.ts` | Shared `verifyToken` replaces the inline encoder with the `"your-secret-key"` fallback |
| `app/api/blog/comments/route.ts` | Shared `verifyToken` replaces the inline encoder with the `"your-secret-key"` fallback |

`app/api/blog/rate` and `app/api/blog/comments` are still reachable by signed out
visitors (IP based rating limits, moderated anonymous comments). They now call
`verifyToken` only to attribute a rating or comment to a signed in user, so they
do not appear in the list above, but they are public by design.

## Observations

1. `GET /api/support/tickets` (row 19) exposes every ticket's name and email
   address without any authentication. Highest priority follow-up in this
   document.
2. `lib/squad.ts` falls back to `"test_pk_sample-public-key-1"` when
   `SQUAD_PUBLIC_KEY` is unset. Not a session issue, and the module is being
   removed with the Squad flow, but the fallback should go before that.
3. `app/api/auth/google/callback` does not validate an OAuth `state` parameter,
   because `app/api/auth/google` never sets one. That allows a login CSRF
   pattern. It is an auth flow change (`app/auth`, `lib/google-auth`) and out of
   scope here.
4. `app/api/payments/squad/callback` and `app/api/payments/squad/webhook` are
   near identical handlers. Both are being replaced.

## Not changed

No route outside the five in "Covered by this hotfix" was modified. In
particular nothing in `app/api/auth/*`, `app/api/support/*`, `app/api/blog/route.ts`,
`app/api/blog/[slug]`, `app/api/blog/category/*` or `app/api/payments/squad/*`
was edited, and neither were `middleware.ts`, `lib/supabase/*`, `lib/identity/*`,
`lib/jobs/*`, `supabase/*` or any login or register page.
