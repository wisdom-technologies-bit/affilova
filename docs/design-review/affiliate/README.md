# Affiliate screens: design review

These are review screenshots, not a product feature. They exist so the layout can
be looked at without a database, and they are deleted before the branch is
merged.

## How they were made

`scripts/design-review/render-screens.test.ts` renders each screen through the
real components with fixed mock props and writes plain HTML into `html/`. The
mock props are the shapes in `lib/affiliate/read-types.ts`; nothing here invents
a metric that the screens do not compute from real reads.

```sh
SCREENS=1 npx -y pnpm@12.3.4 vitest run scripts/design-review/render-screens.test.ts
npx --yes playwright@1.49.1 screenshot --viewport-size="1440,900" \
  "file://$PWD/docs/design-review/affiliate/html/overview.html" \
  docs/design-review/affiliate/shots/overview-1440x900.png
```

Then each screen was opened in Chromium at 1440x900 and at 390x844 and measured:
horizontal overflow, target sizes, labels, heading count, and which regions fall
below the fold.

Two caveats about the HTML, both of which only affect the review copy:

- The stylesheet is the compiled Tailwind chunk copied out of `.next`. The app's
  `next/font` face is not applied, so text falls back to the system sans stack.
  Spacing and colour are the real ones; the typeface is not.
- The shell points at `/brand/...`, so the logo files are copied beside the HTML
  and the paths rewritten to `./brand/...`. A React 19 preload hint still asks
  for the absolute path and 404s in the console; the images themselves load.

## The screens

| File | Screen | What is in the mock |
| --- | --- | --- |
| `overview` | Affiliate overview | 7 days, 1,284 clicks, 41 orders, ₦21,450 commission, a positive balance |
| `marketplace` | Marketplace | 4 products, one in each interesting access state: approved, not requested, pending, invite-only |
| `my-links` | My links | 3 links: one with a label, one with a custom alias, one archived |
| `earnings` | Earnings | 3 commissions (two paid with a hold end, one refunded), 7 day hold |
| `analytics` | Analytics | the "by campaign (s1)" breakdown, three campaign labels |
| `vendor-requests` | Merchant affiliates, Requests | 2 pending requests, one with a note and one without |
| `vendor-performance` | Merchant affiliates, Performance | 2 affiliates with revenue and commission |
| `vendor-invites` | Merchant affiliates, Invites | 2 live invitations with uses and expiry |
| `join` | Join an invitation | the accepted outcome |

Each has a 1440x900 and a 390x844 screenshot in `shots/`.

## What the measurements showed

- **No horizontal overflow at either width**, on any screen. The widest element
  at 390px was 342px inside a 390px viewport.
- **One h1 per screen**, from the page header. The shell itself draws none.
- **Tables become cards below `md`.** At 1440 the `table` is displayed and the
  card list is `display: none`; at 390 it is the other way round. Both are in the
  markup, so the numbers are never only in a table.
- **The sidebar is hidden below `lg`** and the topbar carries the drawer button
  instead. At 1440 the sidebar is 256px and the content column starts at x=296.
- **The KPI grid is 4 across at 1440 and 1 across at 390** on the overview, 5 and
  1 on analytics, 3 and 1 on earnings.
- **Touch targets are 44px or taller**, with two exceptions that belong to the
  existing shell and are not part of this work: the visually hidden "Skip to
  content" link (1px until focused, which is the point) and the logo link in the
  topbar (24px).
- **Below the fold at 1440x900**: on the overview the balance definitions and the
  daily table (the page is 1233px tall); on the marketplace the third and fourth
  product cards (1095px). Everything else fits in the first screen.
- **The decision buttons in the Requests table wrap onto two lines** inside a
  266px column at 1440 (Approve and Decline, then Block). The row grows rather
  than the buttons shrinking, which is the behaviour I wanted on a phone; at
  1440 it looks slightly loose.

Nothing here is a claim about the live app: no session, no database and no server
action was involved. The empty, loading and error words are covered by
`components/affiliate/screens.test.ts`.
