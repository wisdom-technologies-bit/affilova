# Email template review

Every message Affilova sends, at the two widths it is reviewed at. **This folder
is temporary: delete it before merging.**

| File | What it is |
| --- | --- |
| `<template>-600.png` | The template rendered at a 600px viewport, which is the widest a mail client gives a message. |
| `<template>-360.png` | The same template at a 360px viewport, which is a phone. |

The template names are the ones in `emails/catalog.ts`, which is also what the
admin style guide lists.

## How these were made

Not mock-ups and not a second implementation: the HTML is the template's own
output, taken from the `srcdoc` of the frames on the style guide's **Emails**
page (`/design/emails`), and rendered in Chrome.

```bash
# 1. Write one page per template per width, from the guide's own frames.
SCREENS=1 pnpm vitest run scripts/design-review/render-emails.test.ts

# 2. Render each page in Chrome at 2x, cropped to the card.
#    (The pages are in html/, which is gitignored.)
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=600,4000 \
  --screenshot=out.png "file://$PWD/html/purchase_receipt-600.html"
```

Two adjustments are made to the review page only, never to a template: the
logo's absolute URL points at a local copy of the same file, because a review
machine cannot resolve `affilova.example` and a broken image would hide a layout
problem behind a broken image; and the page adds two `<meta>` tags recording the
width and height it was rendered at. Everything else, including every style, is
the template's own inline styles, and the page loads no stylesheet.

The four `supabase_*` files show Supabase's template variables
(`{{ .SiteURL }}`, `{{ .TokenHash }}`) where an address or a link would be: those
messages are sent by Supabase, not by this application, and the files the owner
pastes into the dashboard are in `emails/dist/`.

## What to look for

- Nothing is cut off at 360px, and no line is longer than the card.
- The button is one line, 44px high or more, with the link printed underneath it.
- The logo, the heading, the order summary and the footer sit at the same left
  edge.
- The footer carries the legal identity line and the contact line.
- A long product title wraps rather than overflowing (see
  `purchase_receipt`, which has the longest one).
