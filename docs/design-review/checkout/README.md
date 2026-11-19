# Checkout and delivery screen review

Screenshots of the pages added by `feat/checkout-delivery`, captured in headless
Chrome at 1440x900 and 390x844. **This folder is for review only and is deleted
before the merge.**

## What was captured, and how

The pages were rendered to static HTML from the real components with mock data
(one live product, three images, a long description; one paid order with two
files; the four return states). The build's compiled stylesheet was linked, so
the layout and type are the ones the app ships. The browser viewport was set
through the DevTools protocol, which is what gives a true 390px width: headless
Chrome clamps `--window-size` to 500px.

| file | screen |
|------|--------|
| `product-*.png` | `/p/[slug]`, test mode on, three images, long description |
| `card-error-*.png` | the purchase card showing an inline error and a field error |
| `return-paid-*.png` | `/checkout/return` after a confirmed payment |
| `return-confirming-*.png` | still confirming, after the 30 second window |
| `return-failed-*.png` | payment failed, with the "Try again" link |
| `return-checking-*.png` | the polling state shown first |
| `access-*.png` | `/access/[token]`, two files, refund window open |
| `access-expired-*.png` | an expired link, with "Send me a new link" |

## What the layout measures

Measured in the browser, not estimated:

- **Product page at 1440**: two columns of 704px and 352px. The header and the
  gallery sit in the left column, the purchase card starts in the right column at
  the same top edge as the header and sticks while the page scrolls. The
  description starts at y=1020, below the gallery.
- **Product page at 390**: one column of 358px. The title block is at y=102,
  the purchase card immediately after it at y=330, then the gallery at y=814 and
  the description at y=1211.
- **Overflow**: `documentElement.scrollWidth` equals the viewport width on every
  captured page at both sizes, and no element has a bounding box outside the
  viewport. No horizontal scrolling anywhere.

## Known cosmetic notes

- The return and access pages are deliberately sparse: a heading, one paragraph
  and at most two actions, so they read at a glance on a phone.
- The mock images are grey placeholders with a caption; the real page shows the
  vendor's Cloudinary cover and gallery.
