import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// What the account screens put on the page.
//
// Render tests, not browser tests: each component is rendered to static markup
// with real props, in every state it can be in. What is checked is what a person
// reads: the words for an empty list, the one error sentence, the scan state of a
// file, the refund window, and that a file which is not clean is never offered as
// a download.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

vi.mock("@/app/auth/actions", () => ({ signOutAction: vi.fn(async () => ({ ok: true })) }))

vi.mock("@/lib/account/actions", () => ({
  getMyOrdersAction: vi.fn(),
  getMyOrderAction: vi.fn(),
  downloadMyFileAction: vi.fn(),
  requestMyRefundAction: vi.fn(),
}))

import { ProfilePanel } from "./profile-panel"
import { PurchaseDetail } from "./purchase-detail"
import { PurchasesScreen } from "./purchases-screen"
import { Receipt } from "./receipt"
import { ReceiptsList } from "./receipts-list"
import type { OrderDetail, OrderSummary } from "@/lib/account/types"

const ORDER: OrderSummary = {
  orderId: "33333333-3333-4333-8333-333333333333",
  number: "AFV-2026-000001",
  status: "paid",
  totalKobo: 500000,
  paidAt: "2026-11-17T12:00:00Z",
  createdAt: "2026-11-17T11:50:00Z",
  productTitle: "Account Product A",
  productSlug: "account-product-a",
  vendorName: "Vendor One",
  coverPublicId: "affilova/products/cover-a",
}

const DETAIL: OrderDetail = {
  orderId: ORDER.orderId,
  number: ORDER.number,
  status: "paid",
  currency: "NGN",
  subtotalKobo: 500000,
  taxKobo: 3750,
  taxIncluded: true,
  totalKobo: 500000,
  channel: "card",
  paidAt: "2026-11-17T12:00:00Z",
  createdAt: "2026-11-17T11:50:00Z",
  refundWindowEndsAt: "2026-11-18T12:00:00Z",
  items: [
    {
      orderItemId: "66666666-6666-4666-8666-666666666666",
      productId: "77777777-7777-4777-8777-777777777777",
      title: "Account Product A",
      unitPriceKobo: 500000,
      vendorName: "Vendor One",
    },
  ],
  taxLines: [
    {
      basis: "platform_fee",
      rateBps: 750,
      baseKobo: 50000,
      taxKobo: 3750,
      included: true,
      supplier: "affilova",
    },
  ],
  refundRequest: null,
  entitlements: [
    {
      entitlementId: "44444444-4444-4444-8444-444444444444",
      fileDisplayName: "workbook.pdf",
      sizeBytes: 2048,
      downloadsUsed: 1,
      maxDownloads: 3,
      revoked: false,
      scanClean: true,
    },
  ],
}

const INSIDE_WINDOW = "2026-11-17T13:00:00.000Z"
const AFTER_WINDOW = "2026-11-22T13:00:00.000Z"

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PurchasesScreen", () => {
  it("says plainly that nothing has been bought", () => {
    const html = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [], nextCursor: null },
      }),
    )

    expect(html).toContain("You have not bought anything yet.")
    expect(html).toContain("Browse products")
  })

  it("lists a purchase with its status, date, total and button", () => {
    const html = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [ORDER], nextCursor: null },
      }),
    )

    expect(html).toContain("Account Product A")
    expect(html).toContain("AFV-2026-000001")
    expect(html).toContain("Paid")
    expect(html).toContain("17 Nov 2026")
    expect(html).toContain("5,000")
    expect(html).toContain("Download")
    expect(html).toContain(`/purchases/${ORDER.orderId}`)
  })

  it("offers View rather than Download when there is nothing to download", () => {
    const html = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [{ ...ORDER, status: "pending", paidAt: null }], nextCursor: null },
      }),
    )

    expect(html).toContain("Awaiting payment")
    expect(html).toContain("View")
  })

  it("offers Load more only when there is another page", () => {
    const withMore = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [ORDER], nextCursor: "abc" },
      }),
    )
    const without = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [ORDER], nextCursor: null },
      }),
    )

    expect(withMore).toContain("Load more")
    expect(without).not.toContain("Load more")
  })

  it("shows a skeleton while the first page is on its way", () => {
    const html = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [], nextCursor: null },
        loading: true,
      }),
    )

    expect(html).toContain("Loading your purchases")
    expect(html).not.toContain("You have not bought anything yet.")
  })

  it("shows the error sentence instead of an empty list", () => {
    const html = render(
      createElement(PurchasesScreen, {
        initialPage: { items: [], nextCursor: null },
        initialError: "Something went wrong. Please try again.",
      }),
    )

    expect(html).toContain("Something went wrong. Please try again.")
    expect(html).not.toContain("You have not bought anything yet.")
  })
})

describe("PurchaseDetail", () => {
  it("shows the order, the file and the refund form inside the window", () => {
    const html = render(createElement(PurchaseDetail, { detail: DETAIL, now: INSIDE_WINDOW }))

    expect(html).toContain("AFV-2026-000001")
    expect(html).toContain("Paid")
    expect(html).toContain("workbook.pdf")
    expect(html).toContain("2 KB")
    expect(html).toContain("1 of 3 downloads used")
    expect(html).toContain("Download")
    expect(html).toContain("Request a refund")
    expect(html).toContain("VAT on the platform fee")
  })

  it("says the window closed instead of offering the form", () => {
    const html = render(createElement(PurchaseDetail, { detail: DETAIL, now: AFTER_WINDOW }))

    expect(html).toContain("The refund window closed on")
    expect(html).not.toContain("Request a refund")
  })

  it("never offers a file that has not passed its scan", () => {
    const html = render(
      createElement(PurchaseDetail, {
        detail: {
          ...DETAIL,
          entitlements: [
            { ...DETAIL.entitlements[0], scanClean: false, fileDisplayName: "notes.zip" },
          ],
        },
        now: INSIDE_WINDOW,
      }),
    )

    expect(html).toContain("notes.zip")
    expect(html).toContain("Unavailable while we check it")
    expect(html).not.toContain(">Download<")
  })

  it("says when a file was withdrawn with a refund", () => {
    const html = render(
      createElement(PurchaseDetail, {
        detail: {
          ...DETAIL,
          status: "refunded",
          entitlements: [{ ...DETAIL.entitlements[0], revoked: true }],
          refundRequest: { status: "processed", autoApproved: false },
        },
        now: INSIDE_WINDOW,
      }),
    )

    expect(html).toContain("Withdrawn from this order")
    expect(html).toContain("This order was refunded.")
  })

  it("says when the downloads are used up", () => {
    const html = render(
      createElement(PurchaseDetail, {
        detail: {
          ...DETAIL,
          entitlements: [{ ...DETAIL.entitlements[0], downloadsUsed: 3 }],
        },
        now: INSIDE_WINDOW,
      }),
    )

    expect(html).toContain("No downloads left")
    expect(html).not.toContain(">Download<")
  })

  it("shows the waiting refund request in words", () => {
    const html = render(
      createElement(PurchaseDetail, {
        detail: { ...DETAIL, refundRequest: { status: "requested", autoApproved: false } },
        now: INSIDE_WINDOW,
      }),
    )

    expect(html).toContain("Your refund request is with the vendor")
    expect(html).not.toContain("Request a refund")
  })
})

describe("ReceiptsList", () => {
  it("says there are no receipts yet", () => {
    const html = render(createElement(ReceiptsList, { orders: [] }))

    expect(html).toContain("You have no receipts yet.")
  })

  it("links each receipt", () => {
    const html = render(createElement(ReceiptsList, { orders: [ORDER] }))

    expect(html).toContain(`/receipts/${ORDER.orderId}`)
    expect(html).toContain("Open receipt")
  })
})

describe("Receipt", () => {
  it("carries everything a receipt needs", () => {
    const html = render(createElement(Receipt, { detail: DETAIL }))

    expect(html).toContain("Receipt")
    expect(html).toContain("AFV-2026-000001")
    expect(html).toContain("Vendor One")
    expect(html).toContain("Account Product A")
    expect(html).toContain("5,000")
    expect(html).toContain("VAT on the platform fee")
    expect(html).toContain("Platform: Affilova")
    expect(html).toContain("Lagos time")
    expect(html).toContain("Print")
  })

  it("hides the controls when printed", () => {
    const html = render(createElement(Receipt, { detail: DETAIL }))

    expect(html).toContain("noPrint")
  })

  it("prints no legal identity line when none is configured", () => {
    const html = render(createElement(Receipt, { detail: DETAIL }))

    expect(html).not.toContain("Registration")
  })
})

describe("ProfilePanel", () => {
  it("shows the name, the read-only email and the way to ask for data", () => {
    const html = render(createElement(ProfilePanel, { displayName: "Ada", email: "ada@example.com" }))

    expect(html).toContain("Ada")
    expect(html).toContain("ada@example.com")
    expect(html).toContain("Read-only")
    expect(html).toContain("Account deletion and a copy of your data are available on request")
    expect(html).toContain('href="/contact"')
    expect(html).toContain("Sign out")
  })
})
