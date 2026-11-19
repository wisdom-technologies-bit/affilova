import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { PublicProduct } from "@/lib/catalog/public"
import type { AccessGrant, AccessOrder } from "@/lib/commerce/access"
import { TEST_MODE_BANNER } from "@/lib/commerce/test-mode"

import { AccessView } from "./access-view"
import { CheckoutReturnView } from "./checkout-return-view"
import { ProductView } from "./product-view"

const PRODUCT: PublicProduct = {
  id: "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30",
  slug: "instagram-growth-playbook",
  title: "Instagram Growth Playbook",
  shortDescription: "A practical guide to growing an account without buying followers.",
  description: "Week one: the setup.\n\nWeek two: the first posts.",
  priceKobo: 2_500_000,
  categoryName: "Business",
  vendorBusinessName: "Okafor Digital",
  images: [
    {
      publicId: "affilova/products/cover",
      url: "https://res.cloudinary.com/affilova-images/image/upload/c_fill,f_auto,q_auto,w_1200/affilova/products/cover",
      alt: "The playbook cover",
      width: 1200,
      height: 900,
      isCover: true,
    },
    {
      publicId: "affilova/products/second",
      url: "https://res.cloudinary.com/affilova-images/image/upload/c_fill,f_auto,q_auto,w_1200/affilova/products/second",
      alt: "",
      width: 800,
      height: 600,
      isCover: false,
    },
  ],
  fileCount: 3,
  fileTypes: ["PDF", "ZIP"],
  refundWindowHours: 72,
  publishedAt: "2026-11-01T09:00:00.000Z",
}

function render(element: React.ReactElement): string {
  return renderToString(element)
}

describe("the product page", () => {
  it("shows the product, the vendor, the price and the refund window", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).toContain("Instagram Growth Playbook")
    expect(html).toContain("Okafor Digital")
    expect(html).toContain("₦25,000")
    expect(html).toContain("Refund requests accepted within 3 days of purchase")
    expect(html).toContain("3 files (PDF, ZIP)")
    expect(html).toContain("Buy for ₦25,000")
  })

  it("keeps the description's line breaks and shows it as text", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).toContain("Week one: the setup.")
    expect(html).toContain("Week two: the first posts.")
    expect(html).toContain("whitespace-pre-line")
  })

  it("describes every image, using the title when the vendor gave no alt text", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).toContain('alt="The playbook cover"')
    expect(html).toContain("Instagram Growth Playbook, image 2")
  })

  it("shows the test-mode banner only when the deployment is in test mode", () => {
    const on = render(createElement(ProductView, { product: PRODUCT, testMode: true }))
    const off = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(on).toContain(TEST_MODE_BANNER)
    expect(off).not.toContain(TEST_MODE_BANNER)
  })

  it("has no invented ratings, counts or urgency", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).not.toMatch(/rating|stars|reviews?|only \d+ left|selling fast|bought by/i)
    expect(html).not.toContain("★★★★★")
  })

  it("prefills and locks the email for a signed-in buyer", () => {
    const html = render(
      createElement(ProductView, {
        product: PRODUCT,
        testMode: false,
        signedInEmail: "buyer@example.com",
      }),
    )

    expect(html).toContain('value="buyer@example.com"')
    expect(html).toMatch(/readonly=""/i)
  })

  it("links the footer to the terms and the privacy policy", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).toContain('href="/terms-of-service"')
    expect(html).toContain('href="/privacy-policy"')
  })

  it("states the payment partner and disables the button until verified", () => {
    const html = render(createElement(ProductView, { product: PRODUCT, testMode: false }))

    expect(html).toContain("Payments are processed by Paystack")
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).toContain("Complete the verification challenge to continue.")
  })
})

describe("the checkout return page", () => {
  it("says the payment arrived, with the order number", () => {
    const html = render(
      createElement(CheckoutReturnView, {
        state: { kind: "paid", number: "AFV-2026-000142" },
        retryHref: "/p/instagram-growth-playbook",
      }),
    )

    expect(html).toContain("Payment received")
    expect(html).toContain("AFV-2026-000142")
    expect(html).toContain("We emailed your download link to the address you used.")
  })

  it("still asks, politely, after the polling window", () => {
    const html = render(
      createElement(CheckoutReturnView, { state: { kind: "still_confirming" }, retryHref: "/" }),
    )

    expect(html).toContain("Still confirming your payment")
    expect(html).toContain("You can close this page.")
  })

  it("offers the product page again after a failed or expired payment", () => {
    const failed = render(
      createElement(CheckoutReturnView, {
        state: { kind: "failed" },
        retryHref: "/p/instagram-growth-playbook",
      }),
    )
    const expired = render(
      createElement(CheckoutReturnView, {
        state: { kind: "expired" },
        retryHref: "/p/instagram-growth-playbook",
      }),
    )

    expect(failed).toContain("The payment did not go through")
    expect(failed).toContain('href="/p/instagram-growth-playbook"')
    expect(failed).toContain("Try again")
    expect(expired).toContain("This payment session expired")
    expect(expired).toContain("Try again")
  })

  it("is neutral about a reference it does not recognise", () => {
    const html = render(
      createElement(CheckoutReturnView, { state: { kind: "unknown" }, retryHref: "/" }),
    )

    expect(html).toContain("We cannot find that payment")
    expect(html).not.toContain("Try again")
  })

  it("says it is checking while it is checking", () => {
    const html = render(
      createElement(CheckoutReturnView, { state: { kind: "polling" }, retryHref: "/" }),
    )

    expect(html).toContain("Checking your payment")
    expect(html).toContain("Asking our payment partner")
    expect(html).toContain('aria-live="polite"')
  })

  it("explains a missing reference", () => {
    const html = render(
      createElement(CheckoutReturnView, { state: { kind: "missing_reference" }, retryHref: "/" }),
    )

    expect(html).toContain("We cannot check this payment")
  })
})

const ACCESS_ORDER: AccessOrder = {
  orderId: "3f1b9c62-8d1e-4f27-9a53-1c0f5b2e7d41",
  number: "AFV-2026-000142",
  paidAt: "2026-11-18T10:00:00.000Z",
  refundWindowHours: 72,
  refundWindowEndsAt: "2026-11-21T10:00:00.000Z",
  refundOpen: true,
  refundStatus: null,
  items: [
    {
      title: "Instagram Growth Playbook",
      files: [
        {
          entitlementId: "8b2f4d10-6c3a-4e59-9f01-2d7c8b4a6e35",
          displayName: "playbook.pdf",
          sizeBytes: 1_572_864,
          downloadsUsed: 1,
          maxDownloads: 5,
        },
      ],
    },
  ],
}

const NOW = new Date("2026-11-19T09:00:00.000Z")

function access(grant: AccessGrant): string {
  return render(createElement(AccessView, { grant, token: "payload.signature", now: NOW }))
}

describe("the access page", () => {
  it("lists each file with its size and a download button", () => {
    const html = access({ kind: "ok", order: ACCESS_ORDER })

    expect(html).toContain("AFV-2026-000142")
    expect(html).toContain("playbook.pdf")
    expect(html).toContain("1.5 MB")
    expect(html).toContain("4 of 5 downloads left")
    expect(html).toContain("Download playbook.pdf")
  })

  it("offers the refund form while the window is open", () => {
    const html = access({ kind: "ok", order: ACCESS_ORDER })

    expect(html).toContain("Request a refund")
    expect(html).toContain('id="refund-reason"')
    expect(html).toContain("10 to 1000 characters")
  })

  it("explains that the window has passed, and offers no form", () => {
    const html = access({
      kind: "ok",
      order: { ...ACCESS_ORDER, refundOpen: false },
    })

    expect(html).toContain("The refund window for this order has passed")
    expect(html).not.toContain('id="refund-reason"')
  })

  it("says there is nothing to download yet, without inventing one", () => {
    const html = access({
      kind: "ok",
      order: { ...ACCESS_ORDER, items: [{ title: "Instagram Growth Playbook", files: [] }] },
    })

    expect(html).toContain("There is nothing to download on this order yet.")
    expect(html).not.toContain("Download")
  })

  it("answers a broken or expired link with one neutral page and a new link", () => {
    for (const reason of ["malformed", "invalid_signature", "expired"] as const) {
      const html = access({ kind: "invalid", reason })

      expect(html).toContain("This link does not work")
      expect(html).toContain('href="/access/resend"')
      expect(html).toContain("Send me a new link")
      expect(html).not.toContain("playbook.pdf")
    }
  })

  it("says a purchase is not active without explaining why", () => {
    const html = access({ kind: "not_paid" })

    expect(html).toContain("This purchase is not active")
    expect(html).not.toContain("refunded")
  })
})
