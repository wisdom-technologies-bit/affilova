# Architecture after the legacy removal

One page. The legacy Neon + JWT-cookie system (dashboards, onboarding, blog,
support tickets, Squad) is gone; see `docs/legacy-removal-inventory.md`.

## The five hosts

`middleware.ts` does three things only: resolve the host to an app, forward
`x-affilova-app` and `x-affilova-path`, and apply the route decision from
`lib/host-routing.ts`. It reads no session and never redirects.

| App | Serves | Internal tree |
|---|---|---|
| public | marketplace, stores, how-it-works, about, contact, legal, sign-in/up, checkout | `app/*` |
| affiliate | the affiliate area | `app/hosts/affiliate` |
| merchant | the vendor area | `app/hosts/merchant` |
| account | the buyer area | `app/hosts/account` |
| admin | staff tools, behind a second factor | `app/hosts/admin` |

App hosts rewrite the visible URL into `/hosts/<app>/...`; `/hosts/*` is never
reachable directly. Shared paths (`/api`, `/auth`, `/start`, `/two-factor`, the
sign-in pages and the policy pages) are served the same on every host.

## Auth

Supabase Auth (`lib/supabase`, `lib/identity`): email and password through the
server actions in `app/auth/actions.ts`, `/auth/callback` and `/auth/confirm` for
email links, Turnstile on the public forms, roles in the database, and an AAL2
second factor for staff (`/two-factor`). Each host layout and server action
decides who may see what. Old `/auth/login|register|forgot-password|reset-password`
addresses redirect to the new pages.

## Data

Supabase Postgres, reached through `lib/supabase` with Row Level Security.
Privileged work goes through `SECURITY DEFINER` functions granted to the service
role only. Migrations live in `supabase/migrations` and each has a verify file and
a harness in `supabase/tests`. Files go to Cloudflare R2 (`lib/storage`), images to
Cloudinary (`lib/images`).

## Payments

Paystack only (`lib/paystack`, `lib/commerce`, `lib/payouts`, `app/api/paystack`).
Orders, webhooks, refunds and payouts are written to the ledger tables. Squad is
removed.

## Jobs

`lib/jobs` with the Supabase job queue; `app/api/cron/[job]` is called by the
external scheduler with `CRON_SECRET`. Email goes through `lib/email` (Brevo).
Uploaded files are scanned by `services/scanner`, which calls back to
`app/api/internal/scan-result`.
