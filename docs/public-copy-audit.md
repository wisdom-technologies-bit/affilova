# Public copy audit

Date: 2026-11-16
Branch: `fix/honest-public-copy` (from `main`)

Purpose: remove claims on public pages that are not true of the product today, and
record what was changed so the owner can review the wording. Line numbers refer to
the file as it was on `main` before this branch.

## Rules applied

- Every statistic, testimonial and named person was removed, not reworded.
- Claims about features that are not built were removed or rewritten to describe
  what the code actually does.
- `Squad` in public copy became "our payment partner". The component identifier
  `SquadPayment` and the provider name in internal docs were left alone: they are
  code and engineering notes, not user-facing copy.
- `support@affilova.com` (no mailbox exists) became a link to `/contact`.
- Footer and navigation links whose target route does not exist were removed.
- The platform fee lives in one place: `lib/site-config.ts`.

## The fee constant

`lib/site-config.ts` exports `PLATFORM_FEE_PERCENT = 10`, marked
"Placeholder pending owner confirmation. Change here only." The how-it-works page
reads it in both the Fees section and the fee FAQ answer, so a single edit updates
every public mention. The number itself is unconfirmed: the owner must confirm or
correct it before launch.

## Audit table

### `app/HomePageClient.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 152 | "Launch Special: Free for first 6 months" | Removed (promo badge deleted). |
| 158 | Hero: "top-performing affiliates", "automate your sales funnel", "scale from day one" | Rewritten: vendors list products, affiliates promote them, sales recorded in one place. |
| 161 | "Build Your Affiliate Empire" | Rewritten: "Sell with affiliates." |
| 210 | "10K+ Active Affiliates" | Removed (whole statistics block deleted). |
| 211 | "₦500M+ Revenue Processed" | Removed. |
| 212 | "98% On-time Payouts" | Removed. |
| 213 | "50+ Product Categories" | Removed. |
| 245 | Sales pages "with our drag and drop builder", "instant delivery" | Rewritten: product page and thank-you page are created with the product. |
| 251 | "500+ products from vetted vendors", "real-time tracking" | Rewritten: browse the marketplace, apply to products, commission tracked on the dashboard. |
| 256-259 | Advanced Analytics "in real-time" | Rewritten to clicks, referred sales and commission in the dashboard. |
| 262 | "Squad-powered payment processing. Automatic weekly payouts" | Rewritten: "Our payment partner", withdrawals requested from the dashboard. |
| 306 | "get paid every Thursday" | Rewritten: request a withdrawal from the dashboard. |
| 337 | "Multi-channel product distribution" | Removed from the pricing list. |
| 338 | "Custom sales pages with drag and drop editor" | Removed. |
| 339 | "Automatic digital product delivery" | Removed. |
| 342 | "Fraud protection & chargeback handling" | Removed (not built). |
| 392 | "Browse 500+ products across categories" | Removed. |
| 393 | "Competitive commissions up to 50%" | Removed; vendors set the commission per product. |
| 394 | "Get paid every Thursday without delays" | Removed. |
| 395 | "Track every click, lead, and sale" | Removed. |
| 396 | "exclusive marketing materials" | Removed. |
| 397 | "Join a thriving community" | Removed. |
| 419 | "Join thousands of successful vendors and affiliates" | Rewritten as a plain sign-up line. |

### `app/how-it-works/HowItWorksClient.tsx`

A 3,991-line guide with 20-plus sections was replaced (214 lines) with: what
Affilova is, three short sections (vendors, affiliates, customers), a Fees section,
and a six-question FAQ.

| Line | Claim | Action |
| --- | --- | --- |
| 412 | "Powered by Squad ... cards, bank transfers, and USSD" | Removed with the payment section; Fees now names no provider. |
| 418 | "Get paid every Thursday without fail. No minimum threshold hassles" | Removed. |
| 449 | "10,000+" | Removed. |
| 453 | "₦500M+" | Removed. |
| 461 | "98%" | Removed. |
| 758 | "compliant payment partner, Squad" | Replaced with "our payment partner". |
| 893-897 | "Two-Factor Authentication (2FA)" instructions | Removed (not built). |
| 1032 | "tiered verification system" | Removed (not built). |
| 1453 | "tiered commission structures and bonuses" | Removed (not built). |
| 2250, 2443 | "drag and drop page builder" | Removed; only product page and thank-you page exist. |
| 2483 | "Affilova partners with Squad" | Replaced with "our payment partner". |
| 2579 | "₦10,000 sale with 1.5% fee (₦150)" | Removed; fee now read from `PLATFORM_FEE_PERCENT`. |
| 3032 | "₦10,000" minimum example | Removed. |
| 3147-3149 | "Payout Day: Every Thursday" | Removed. |
| 3318 | "Enable Two-Factor Authentication (2FA)" | Removed. |
| 3517-3532 | ActiveCampaign, MailerLite, GetResponse integrations | Removed (not built). |
| 3695-3698 | "Live Chat ... real-time" support | Removed. |
| 3752-3772 | "Community Forum", "Visit the Forum" | Removed (not built). |
| 2874 | Lead magnets, checklists, templates advice | Removed with the section. |

### `app/how-it-works/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| metadata | "Complete Guide" plus marketing description | Rewritten to a one-line description of the page. |

### `app/about/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 33 | "top-performing affiliates through cutting-edge technology" | Rewritten to describe the marketplace plainly. |
| 83 | "Founded by a team of experienced entrepreneurs and technologists" | Removed. |
| 88 | "serves thousands of vendors and affiliates worldwide, processing millions" | Removed. |
| 138-272 | Leadership team: named people with biographies and "10+ years" | Removed (invented people). |
| 188 | "Integrated with Squad by Monnify ... reliable weekly payouts" | Rewritten: payouts with our payment partner, withdrawal requests. |
| 200 | "Built-in landing page builder, resource sharing, email automation" | Rewritten: product page, thank-you page, static resources page. |
| 213 | "AI-powered affiliate-product matching" | Removed (not built). |
| 226 | "affiliate verification" | Rewritten: products are reviewed before listing. |
| 268 | Footer "premier affiliate marketplace ... top-performing" | Rewritten. |
| footer | Four links with `href="#"` (Find Affiliates, Analytics, Browse Products, Earn Commissions) | Pointed at `/auth/register`, `/how-it-works` and `/contact`. |
| CTA | "Ready to Join Our Community?" | Rewritten: "Ready to get started?" |
| footer | Copyright year hardcoded to 2024 | Now the current year. |

### `app/contact/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 65 | "We'll respond within 24 hours" | Removed; the form now records a support ticket. |
| 123-124 | `support@affilova.com`, "Response within 24 hours" | Removed (mailbox does not exist); the form on this page is the contact route. |
| 132 | "+234 800 AFFILOVA" phone number | Removed (no line exists). |
| 140-146 | Lagos office address | Removed. |
| 152-158 | Business hours | Removed. |
| 173-179 | Help Documentation, FAQ, Video Tutorials buttons (no such pages) | Replaced with a link to `/how-it-works`. |
| 205 | Success message promising a 24-hour reply | Rewritten: message recorded as a support ticket. |
| 303 | Response-time promise in the FAQ | Rewritten without a deadline. |
| 340 | "All payments are processed every Thursday" | Rewritten: withdrawal requested from the dashboard. |
| 354 | "Commission rates ... typically ranging from 20% to 50%" | Rewritten: the vendor sets the commission per product. |

### `components/global-footer.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 14 | `/features` (no route) | Removed. |
| 15 | `/pricing` (no route) | Removed. |
| 16 | `/affiliates` (no route) | Removed. |
| 17 | `/sell-courses` (no route) | Removed. |
| 18 | `/show-love` (no route) | Removed. |
| 19 | `/tickets` (no route) | Removed. |
| 20 | `/integrations` (no route) | Removed. |
| 21 | `/affiliate-network` (no route) | Removed. |
| 25 | `/help` (no route) | Removed. |
| 26 | `/creator-academy` (no route, not built) | Removed. |
| 27 | `/templates` (no route, not built) | Removed. |
| 28 | `/press` (no route) | Removed. |
| 29 | `/faqs` (no route) | Removed. |
| copy | "premier", "worldwide" platform description | Rewritten. |

Kept because the routes exist: `/how-it-works`, `/blog`, `/contact`,
`/privacy-policy`, `/terms-of-service`.

### `app/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 10 (openGraph) | "Connect with thousands of affiliates ... premier marketplace" | Rewritten. |
| metadata | "Build your affiliate empire" descriptions | Rewritten to describe the marketplace. |

### `app/blog/[slug]/blog-post-client.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 545 | "Join thousands of affiliates making money with Affilova" | Rewritten: apply to products, earn the commission each vendor sets. |
| 551 | "Get Started Free" button | "Get Started" (no pricing claim). |

### `app/privacy-policy/privacy-policy-client.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| contact details | `privacy@affilova.com` and `support@affilova.com` | Replaced with a `/contact` link. |
| response time | "within 48 hours" promise | Removed. |
| named entity | `support.affilova.com` subdomain | Removed (does not exist). |

### `app/terms-of-service/terms-of-service-client.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| contact details | `legal.affilova.com`, `support@affilova.com` | Replaced with a `/contact` link. |
| response time | "within 48 hours" promise | Removed. |

### `app/products/[id]/purchase/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 278 | "Pay securely with Squad" | "Pay securely with our payment partner". The `SquadPayment` component name is unchanged code. |

### `app/purchase/success/page.tsx`

| Line | Claim | Action |
| --- | --- | --- |
| 140 | `support@affilova.com` | Replaced with a `/contact` link. |

## Verified with

- `grep -rn "support@affilova\.com"` over the public files: no matches.
- `grep -rn "10,000"`, `"500M"`, `"98%"`: no matches.
- `grep -rn "Squad"` over public copy: no matches outside the `SquadPayment`
  component identifier.
- `grep -rniE "two-factor|2fa|page builder|activecampaign|mailerlite|getresponse|forum|live chat|creator academy|verification tier|template"`: no matches.
- `grep -rniE "testimonial|trusted by"`: no matches.
- Rendered HTML of `/`, `/how-it-works`, `/about`, `/contact`,
  `/privacy-policy`, `/terms-of-service`, `/blog`: 0 hits for `Squad`,
  `support@affilova`, `10,000`, `500M`, `98%`, `Thursday`, `thousands`,
  `millions`, `testimonial`.
- `pnpm typecheck:ratchet`: 52, matching the baseline.
- `pnpm test`: 446 passing.
- `pnpm build`: succeeds.
- Every internal link rendered on the changed pages returns 200 from the built
  server.

## Not changed, and why

- `app/dashboard/select-role/page.tsx:160` ("Access to thousands of affiliates")
  and other dashboard copy: dashboard pages are outside the agreed scope.
- `app/auth/*`, `middleware.ts`, API routes, `supabase/*`: out of scope.
- `components/squad-payment` and the provider name in `docs/legacy-route-audit.md`:
  internal identifiers and engineering notes, not public copy.
- `app/api/admin/support/*` renders no public copy.

## Open items for the owner

1. Confirm the platform fee percentage (currently a 10% placeholder).
2. Decide whether to create a support mailbox; until then `/contact` is the only
   support route.
3. `app/dashboard/select-role/page.tsx:160` still says "thousands of affiliates"
   and needs the same treatment when dashboard copy is in scope.

> **Note (chore/remove-legacy):** `components/squad-payment.tsx`, the legacy
> dashboard pages and the blog pages mentioned above no longer exist.
