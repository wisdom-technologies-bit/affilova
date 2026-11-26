# The Affilova design system

Affilova is calm financial software for people who sell and promote digital
products in Nigeria. The interface should read as trustworthy, precise and quiet:
a product built by people who count money for a living.

The bar is not the crowded look of affiliate and marketing sites. Saturated
gradient washes, stock photographs of cash, emoji, giant unverifiable claims and
grids of generic icons all say "we are selling you something". This product says
"here is your money, here is what happened to it".

What we use instead: restraint, a strong typographic hierarchy, generous but
disciplined spacing, the real product UI, and specific copy.

- Tokens: `app/globals.css`, `tailwind.config.ts`, and `lib/design/tokens.ts` for
  the same palette as data.
- Measured contrast: `lib/design/contrast.ts`, asserted in
  `lib/design/contrast.test.ts`.
- The style guide: `/design` on the admin host, behind the staff permission guard
  and the two-factor wrapper, noindex.

---

## 1. Principles

**Restraint over decoration.** A page is type, space and a 1px rule. If a border,
a shadow or a colour is not carrying information, it is removed. There is exactly
one shadow in the system and it belongs to an overlay that floats above the page.

**Hierarchy from type, not from colour.** Size, weight and space decide what a
person reads first. Green is an accent: the primary action, the active state, the
logo. It is never a background wash.

**Real product, real numbers.** Show the table, the amount, the status. A number
on a screen is a number the product measured, with its range and its unit.

**Say exactly what happens.** A confirmation names the action and its
consequence. A status is a word and an icon. An empty state says what is missing
and what to do next.

**Quiet by default, loud only for danger.** One primary action per view.
Destructive actions are the only thing allowed to raise their voice.

---

## 2. The anti-pattern list

Each of these is a reason to send a change back.

1. **No gradients.** Not linear, not radial, not a gradient text fill, not a
   gradient hover overlay. `components/ds/tokens-only.test.ts` fails the build on
   `linear-gradient`, `radial-gradient`, `conic-gradient` and `bg-gradient-*`.
2. **No stock photography of money.** No fanned cash, no handshakes, no people
   pointing at laptops. If a picture is needed, it is a screenshot of the actual
   product.
3. **No emoji.** Not in copy, not in a button, not in a toast. The scan fails on
   emoji ranges; typographic symbols (·, —, …, →, ✓) are text and are allowed.
4. **No invented statistics or testimonials.** No "10,000 sellers", no "₦2bn
   paid out", no quotes from customers who do not exist.
5. **No three-card grid of icons** as a section. If three facts matter, write
   them as a list with real numbers.
6. **No all-caps headings.** Column headers and labels are sentence case too.
7. **No giant superlatives.** No "the best", "the fastest", "the only platform
   you will ever need".
8. **No shadow on a card.** A card is a 1px border on white.
9. **No decorative illustration or glow.** No blurred colour blobs behind a hero,
   no drop shadows on icons.
10. **No colour-only meaning.** A status, an alert or a trend always carries a
    word and, where it helps, an icon.

---

## 3. Tokens

Colour is stored in `app/globals.css` as a space-separated HSL triplet, so
Tailwind can put an alpha on it (`hsl(var(--border) / 0.5)`). The hex each triplet
resolves to is recorded in `lib/design/tokens.ts`. A test parses the CSS, converts
each triplet back to a colour and compares it with the palette, so the two cannot
drift.

### Neutrals

| Token | Hex | Use |
| --- | --- | --- |
| `--background` | `#FFFFFF` | The page. Every panel sits on it. |
| `--surface-subtle` | `#F7F8F7` | A quiet band: a table header, a summary box. |
| `--surface-muted` | `#EFF1EF` | A pressed row, a secondary control, a skeleton. |
| `--border` | `#E3E6E3` | The 1px rule: card edges, table rows, dividers. |
| `--border-strong` | `#CDD2CD` | A rule that has to be seen: a header underline, a hover edge. |
| `--border-control` | `#848B84` | The edge of a control. 3.50:1 on white, 3.08:1 on a muted surface. |
| `--foreground` | `#0E0F0D` | Body and heading text. |
| `--text-muted` | `#4B524B` | The second line: a description, a column header. |
| `--text-subtle` | `#6B736B` | The third line, placeholders, timestamps. 4.90:1 on white. |

`--border` and `--border-strong` are for separation, not for the edge of a
control: at 1.26:1 and 1.53:1 they are not visible enough to be the only thing
that says "this is a field" (WCAG 1.4.11). A control uses `--border-control`.

### Brand

| Token | Hex | Use |
| --- | --- | --- |
| `--brand-50` | `#EAF9F0` | The selected row, the quiet success surface. |
| `--brand-100` | `#D6F2E2` | The avatar disc, the hover on a selected row. |
| `--brand-500` | `#14A953` | Graphics only: the focus ring, a chart series, a progress bar. 3.07:1 on white, so never text. |
| `--brand-600` | `#107F3E` | Text on white and the primary button. 5.09:1. |
| `--brand-700` | `#0D6B34` | The primary button on hover, a link on white. |
| `--brand-900` | `#083F26` | The one dark panel in the product: the auth brand panel. |

The action green is one step darker than the logo green because the logo green
does not reach 4.5:1 with white text. `--brand-500` is for shapes; `--brand-600`
is for words.

### Semantic pairs

Each pair is a text colour on its own pale surface, measured at 4.5:1 or better.
Each is always drawn with an icon and a word.

| Pair | Text | Surface | Ratio |
| --- | --- | --- | --- |
| Success | `#0F6B35` | `#E8F6EE` | 5.94:1 |
| Warning | `#7A4B00` | `#FFF4DB` | 6.78:1 |
| Danger | `#B42318` | `#FDECEA` | 5.75:1 |
| Info | `#1D4E89` | `#E8F0FA` | 7.30:1 |

Tailwind utilities: `text-success`, `bg-success-subtle`, `border-success`, and the
same for `warning`, `danger` and `info`.

### Charts

Five series, each readable as a label on white, each with its own marker shape and
dash pattern:

| Series | Hex | Marker | Dash |
| --- | --- | --- | --- |
| 1 | `#0F6B35` | circle | solid |
| 2 | `#1D4E89` | square | `6 3` |
| 3 | `#7A4B00` | triangle | `2 3` |
| 4 | `#6B3FA0` | diamond | `10 4 2 4` |
| 5 | `#B42318` | cross | `1 4` |

Two series are never told apart by hue alone: a line carries its dash pattern and
its marker, and every chart has a legend in words plus a text alternative with the
numbers.

### Type

Inter, self-hosted through `next/font`. Sizes in px, line heights in px.

| Class | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 48 / 52 | 600 | Public pages only: the line above the fold. |
| `text-display-sm` | 36 / 40 | 600 | Public pages only: a section opener. |
| `text-h1` | 30 / 36 | 600 | One per page. The page title. |
| `text-h2` | 22 / 28 | 600 | A section title. |
| `text-h3` | 18 / 24 | 500 | A panel title inside a section. |
| `text-body` | 15 / 24 | 400 | Everything a person reads. |
| `text-dense` | 14 / 20 | 400 | Dashboards: table cells, KPI hints. |
| `text-small` | 13 / 18 | 400 | A helper line, a badge, a secondary action. |
| `text-caption` | 12 / 16 | 400 | The smallest allowed: a timestamp, a unit. |

Numbers and money are set in tabular lining figures with `.tabular`
(`font-variant-numeric: tabular-nums lining-nums`). That covers every table cell,
every KPI value and every `Money`.

### Space, shape, motion

- Spacing is a 4px base: `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `2xl 32`,
  `3xl 48`, `4xl 64`. Control heights are `control-sm 36`, `control-md 44`,
  `control-lg 52`.
- Radii: `sm 6`, `md 8`, `lg 12`, `xl 16`. A pill is reserved for a status; an
  avatar is the only circle.
- One shadow: `shadow-overlay`, for dialogs, sheets, popovers and menus only.
- Motion: 150ms, `cubic-bezier(0, 0, 0.2, 1)`, colour and transform only. Under
  `prefers-reduced-motion: reduce` transitions and animations are removed, not
  shortened.
- Containers: dashboards 1152px, public pages 1200px, reading 70ch.

### The shadcn mapping

`--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--accent`,
`--destructive`, `--border`, `--input`, `--ring`, `--card`, `--popover` and
`--radius` are aliases of the tokens above (`--primary: var(--brand-600)` and so
on). Every `components/ui/*` primitive therefore inherits the system without being
edited, and a change to a token reaches all of them.

### Dark theme

A `.dark` block is defined in `app/globals.css` and is **not enabled**: nothing
sets the class, there is no theme provider, and no script reads the system
preference. The contrast pairs are asserted for the light theme only. A dark theme
has to earn its own pass before it is switched on.

---

## 4. Component rules

### Primitives (`components/ui`)

- `Button`: `default` (brand-600, white label), `secondary`, `outline`, `ghost`,
  `destructive`, `link`. Sizes 36 / 44 / 52. `loading` disables the button, sets
  `aria-busy` and draws a spinner beside the label that was already there.
- `Input`, `Textarea`, `Select`: 44px, `--border-control`, the system focus ring,
  a disabled surface, and `aria-invalid` drawing a danger border. The border is
  never the only error signal: a `Field` renders the message and ties it to the
  control.
- `Checkbox`, `RadioGroup`, `Switch`: an 18px control (a switch is a track and a
  thumb), a 3:1 edge, and a state that changes shape as well as colour.
- `Tabs`: a muted track, a white active tab, no shadow.
- `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `Tooltip`, `AlertDialog`: the only
  surfaces with a shadow. Overlay is the ink at 40%.
- `Badge`: a quiet label in a rounded rectangle. A status is a `StatusBadge`, not
  a `Badge`.
- `Table`: a 40px header on `surface-subtle`, 1px row rules, sentence-case
  headers.
- `Card`: a 1px border, no shadow.
- `Alert`: `default` and `destructive` in the semantic tokens.
- `Skeleton`: `surface-muted`, `animate-pulse`, hidden from screen readers.
- `Sonner`: the toast surface is the card surface with the overlay shadow.

### Composed components (`components/ds`)

- `PageHeader` — the page's only `h1`, an optional description, breadcrumbs and
  the page actions. Breadcrumbs are a `nav` with a list; the current page is text
  with `aria-current`, not a link.
- `Section` — an `h2`, a description, section actions and a 1px panel.
- `Stat` / `StatGrid` — a label, a tabular value, a hint, a trend in words and an
  optional flag. A description on the term carries the definition.
- `DataTable` — a real table with a caption and `scope` on every header, a row
  header in the first cell, right-aligned tabular numbers, a sticky header, and
  the same rows as cards below `md`. Loading, empty and error are states of the
  same table. Sorting and "Load more" are links, so the state lives in the URL and
  the table works before JavaScript loads.
- `EmptyState` — an icon slot, a title, a description and at most two actions.
- `StatusBadge` — a typed `StatusMap` from status to tone, label and icon. A
  status not in the map renders "Unknown" rather than nothing.
- `Field` — a label, help, an error and the required marker, wired to the control
  by id (`aria-describedby`, `aria-invalid`, `aria-required`). The control is
  passed as a function of the prepared attributes.
- `Money` — kobo in, naira out, tabular, an optional sign, a minus that is always
  written.
- `DateText` — Africa/Lagos, one format for the whole product, "Not set" instead
  of a zero date.
- `CopyField` — a read-only field plus a button that reports what happened in a
  live region.
- `ConfirmDialog` — the action in the title, the consequence in words, and a typed
  confirmation for anything irreversible.
- `InlineAlert` — info and success are polite (`role="status"`); warning and
  danger interrupt (`role="alert"`).
- `Toolbar` — search, filters and the list action, wrapping on a phone.
- `ChartFrame` — a title, a legend with a shape per series, and a required text
  alternative with the numbers.

Where a screen already had its own version (`components/affiliate/*`,
`components/payouts/ui.tsx`, `components/app-shell/page-header.tsx`), it is now a
thin wrapper over the `components/ds` component with the same export name and the
same props.

---

## 5. Accessibility rules

1. **4.5:1 for text, 3:1 for a boundary or a focus ring.** Both are asserted in
   `lib/design/contrast.test.ts` from the token values, so a token that changes
   into a failing pair fails the test.
2. **The focus ring is always the same:** 2px `--brand-500`, 2px out, in the page
   colour (`.focus-ring`). The offset is what lets it clear 3:1 on every surface.
3. **44px minimum for a control** on a touch layout. 36 is allowed only in a dense
   desktop toolbar.
4. **A status is never colour alone.** A word, and an icon.
5. **One `h1` per page**, and no skipped heading levels: `h1` → `h2` → `h3`.
6. **Every field has a label.** A placeholder is not a label. Help and error text
   are joined into one `aria-describedby`.
7. **Every table has a caption and scoped headers.** A numeric column is right
   aligned and tabular.
8. **Every image has alt text**; a decorative icon is `aria-hidden`.
9. **A chart has a text alternative** with the actual numbers.
10. **Motion is optional.** `prefers-reduced-motion` removes transitions.
11. **A destructive action asks for the word**, and says what cannot be undone.

---

## 6. Copy rules

- **Sentence case everywhere.** Not "Send Payout", not "SEND PAYOUT".
- **A verb on every button:** "Send payout", "Add a product", "Cancel
  withdrawal". Never "OK", "Submit" or "Yes".
- **Say the number.** "₦45,000", "12% of the order total", "within 7 days". If the
  product does not know the number, do not invent one.
- **Say what happened and what happens next.** "The bank rejected the transfer.
  Check the account name and try again."
- **Name the consequence in a confirmation.** "The ₦45,000 returns to your
  available balance."
- **Use the word the person uses.** "Payout", not "disbursement". "Bank account",
  not "beneficiary instrument".
- **Never:** "revolutionary", "seamless", "unlock", "supercharge", "game-changer",
  "empower", "leverage", "cutting-edge".
- **No exclamation marks**, and no emoji.
- **Dates are Lagos dates** in one format: `18 Nov 2026`, `18 Nov 2026, 14:05`.

---

## 7. Guards in the test suite

| Test | What it protects |
| --- | --- |
| `lib/design/contrast.test.ts` | The palette in the CSS equals the palette in the tokens; every pair reaches its minimum; the dark block stays off. |
| `components/ds/design-system.test.ts` | One `h1`; a status carries a word and an icon; the table has a phone shape; the confirmation is locked until the word is typed. |
| `components/ds/tokens-only.test.ts` | No hard-coded hex in a component; no gradient; no emoji in rendered copy. |

The style guide at `/design` shows every token with its measured ratio, every
primitive in every state, and every composed component with realistic props. It is
the place to check a change before it reaches a screen.
