# Legacy removal inventory

Written for `chore/remove-legacy`, based on `main` at `f23ae42` (merge of PR #41).

Nothing is deleted in this commit. The table lists everything that belongs to the
legacy system (the Neon `lib/db.ts` + `lib/auth.ts` JWT cookie stack, the old
dashboards, onboarding, blog, support tickets, Squad payments and their tests), the
evidence that the kept system does not need it, and the decision.

## How the evidence was produced

1. A script (kept out of the repository) walks `app`, `components`, `lib`, `hooks`, `services`, `tests`
   and the root config/middleware files, and records every static `import`/`export from`,
   dynamic `import()`, `require()` and `vi.mock()` specifier, resolving the `@/` alias and relative paths.
2. The legacy set is seeded from the directories and files named in the task. For every
   member the script lists the importers that are **outside** the set. An empty list means
   nothing kept needs it. A non-empty list is shown in the table and handled in the notes.
3. Everything outside the set was then walked from the kept roots (all non-legacy routes,
   `middleware.ts`, `next.config.mjs`, instrumentation/Sentry files, scripts and tests) to find files that
   become unreachable. See "Kept, reason".
4. A grep of the kept code for string literals that point at legacy URLs (see "Kept code that links to legacy URLs").

Re-run it on any commit with: `node graph.mjs edges.json && node legacy.mjs edges.json L.json`
(the two small scripts are described in this section; they use only `node:fs` and `node:path`).

## Result in one line

Only three kept files import a legacy module, and only because of one legacy remnant:

| Kept file | Imports | Why it is fine |
|---|---|---|
| `middleware.ts` | `lib/auth` (`verifyToken`) | The legacy token branch. Removed in step 3 of the task; host resolution is untouched. |
| `tests/helpers/legacy-jwt.ts` | `lib/auth` | Test helper that mints legacy JWTs. Used only by the two middleware tests for the legacy branch. Deleted with it. |
| `app/api/products/route.ts` | `lib/auth`, `lib/db`, `lib/brevo` | Not on the keep list. Legacy vendor "create product" POST (Neon SQL, `getSession`). Only the legacy product pages call `/api/products`. Classified legacy, deleted. |

## Table

| `app/api/admin/analytics/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/blog/[id]/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/blog/categories/[id]/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/blog/categories/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/blog/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/dashboard-stats/route.test.ts` | test | import graph: no importer outside the legacy set | delete |
| `app/api/admin/dashboard-stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/products/[id]/approve/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/products/[id]/reject/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/products/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/profile/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/settings/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/support/[id]/status/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/transactions/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/withdrawals/[id]/approve/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/withdrawals/[id]/reject/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/admin/withdrawals/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/analytics/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/apply/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/balance/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/dashboard-stats/route.test.ts` | test | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/dashboard-stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/onboarding/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/payment-info/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/profile/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/resources/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/affiliate/withdrawals/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/forgot-password/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/google/callback/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/google/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/login/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/logout/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/me/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/register/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/reset-password/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/select-role/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/send-otp/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/auth/verify-otp/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/blog/[slug]/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/blog/category/[slug]/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/blog/comments/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/blog/rate/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/blog/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/payments/squad/callback/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/payments/squad/config/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/payments/squad/verify/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/payments/squad/webhook/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/products/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/support/tickets/route.test.ts` | test | import graph: no importer outside the legacy set | delete |
| `app/api/support/tickets/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/upload/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/affiliates/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/analytics/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/dashboard-stats/route.test.ts` | test | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/dashboard-stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/onboarding/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/payment-info/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/profile/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/resources/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/sales/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/sales/stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/api/vendor/stats/route.ts` | API route | import graph: no importer outside the legacy set | delete |
| `app/auth/forgot-password/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/auth/login/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/auth/login/login-client.tsx` | page component | import graph: importers all inside the legacy set | delete |
| `app/auth/login/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/auth/register/_components/RegisterClient.tsx` | page component | import graph: importers all inside the legacy set | delete |
| `app/auth/register/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/auth/register/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/auth/reset-password/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/auth/reset-password/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/blog/BlogPageClient.tsx` | page component | import graph: importers all inside the legacy set | delete |
| `app/blog/[slug]/blog-post-client.tsx` | page component | import graph: importers all inside the legacy set | delete |
| `app/blog/[slug]/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/blog/category/[slug]/category-client.tsx` | page component | import graph: importers all inside the legacy set | delete |
| `app/blog/category/[slug]/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/blog/category/[slug]/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/blog/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/analytics/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/analytics/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/blog/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/products/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/products/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/profile/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/settings/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/support/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/support/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/transactions/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/transactions/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/users/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/users/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/admin/withdrawals/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/admin/withdrawals/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/analytics/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/affiliate/analytics/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/affiliate/marketplace/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/affiliate/marketplace/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/payment-information/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/profile/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/resources/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/affiliate/resources/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/affiliate/withdrawals/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/select-role/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/advertising/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/affiliates/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/vendor/affiliates/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/analytics/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/vendor/analytics/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/payment-information/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/products/[id]/sales-page/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/products/[id]/thank-you-page/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/products/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/vendor/products/new/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/products/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/profile/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/resources/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/vendor/resources/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/sales/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/dashboard/vendor/sales/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/dashboard/vendor/store/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/onboarding/affiliate/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/onboarding/vendor/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/products/[id]/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/products/[id]/purchase/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `app/purchase/success/loading.tsx` | page/layout | import graph: importers all inside the legacy set | delete |
| `app/purchase/success/page.tsx` | page/layout | import graph: no importer outside the legacy set | delete |
| `components/dashboard-layout.tsx` | component | import graph: no importer outside the legacy set | delete |
| `components/dashboard-sidebar.tsx` | component | import graph: no importer outside the legacy set | delete |
| `components/squad-payment.tsx` | component | import graph: no importer outside the legacy set | delete |
| `components/wysiwyg-editor.tsx` | component | import graph: no importer outside the legacy set | delete |
| `lib/auth.test.ts` | test | import graph: no importer outside the legacy set | delete |
| `lib/auth.ts` | lib | imported by kept: middleware.ts (see notes) | delete (after middleware.ts stops importing it) |
| `lib/brevo.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/db.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/google-auth.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/otp.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/password-reset.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/security.ts` | lib | import graph: no importer outside the legacy set | delete |
| `lib/squad.ts` | lib | import graph: no importer outside the legacy set | delete |
| `tests/helpers/legacy-jwt.ts` | test helper | imported by kept: middleware.test.ts, middleware-router.test.ts (see notes) | delete (after the two middleware tests stop using it) |

## Dependencies

| Package | Evidence | Decision |
|---|---|---|
| `@neondatabase/serverless` | imported only by `lib/db.ts` | remove (step 7) |
| `bcryptjs` | imported only by legacy auth code | remove (step 7) |
| `jose` | imported only by `lib/auth.ts` and the legacy JWT test helper | remove (step 7) |
| `crypto` (npm shim) | imported only by legacy code; Node's built-in is used by the kept code | recheck by grep and build after deletion |
| `stream` (npm shim) | imported only by legacy code | recheck by grep and build after deletion |
| `cloudinary` | `lib/images/cloudinary.ts` (kept) | recheck after `lib/cloudinary.ts` goes; keep if the kept helper imports it |
| `isomorphic-dompurify` | rechecked after deletion (the blog and wysiwyg code were its likely users) | decided in step 7 by grep and build |

## Kept, reason

| Path | Reason |
|---|---|
| `lib/host-routing.ts` (`matchesLegacyMatcher`) and its test | The task says every host-routing test stays unchanged. The function stays exported but unused by `middleware.ts` afterwards; remove it in a follow-up together with its test. |
| `components/ui/*` primitives that nothing imports | Generic shadcn primitives, not legacy-specific. Deleting is outside the task. |
| `lib/security/turnstile-verify.ts` | Different file from `lib/security.ts`; imported by the kept identity code. |
| `lib/images/cloudinary.ts` | Used by `lib/catalog/actions/vendor.ts`; Cloudinary variables stay in `lib/env.ts`. |
| `app/hosts/admin/blog`, `app/hosts/admin/support` | Under `app/hosts`, which the task says not to change. |
| `app/api/csp-report`, `app/api/health`, `app/api/cron`, `app/api/paystack`, `app/api/internal` | On the keep list. `app/api/health` is checked in step 5 of the checks for a DB dependency on the removed code (graph shows none). |

## Kept code that links to legacy URLs

These are fixed in the public-pages commit (step 5) or are host-relative links that are correct on their host:

- Public pages: `app/HomePageClient.tsx`, `app/about/page.tsx`, `app/how-it-works/HowItWorksClient.tsx`, `app/not-found.tsx`, `components/global-footer.tsx`, `components/legal/legal-header.tsx` link to `/auth/login`, `/auth/register` and `/blog`. `app/contact/page.tsx` posts to `/api/support/tickets`. `app/sitemap.ts` lists `/blog` and `/products`.
- `components/app-shell/navigation.ts` has `/blog` for the admin host (admin blog lives in `app/hosts/admin/blog`, kept) and `/products` for the merchant and admin hosts. These are host-relative and stay.
- Consequence for step 4: `/products/:path*` is a real path on the merchant and admin hosts, so the redirect to `/marketplace` must only apply on the public host (a `missing` host/preview-override condition in `next.config.mjs`).
