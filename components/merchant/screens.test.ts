import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// What the merchant screens put on the page.
//
// Render tests, not browser tests. What is checked is what a vendor reads: the
// definition behind every number, the withdrawals note, the empty and loading and
// error states, the affiliate tag on a sale, and that a refund request waiting for
// a decision is the only one that offers buttons.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/sales",
  redirect: vi.fn(),
}))

vi.mock("@/lib/merchant/actions", () => ({
  getVendorOverviewAction: vi.fn(),
  getVendorDailySeriesAction: vi.fn(),
  getVendorTopProductsAction: vi.fn(),
  getVendorSalesAction: vi.fn(),
  getVendorRefundRequestsAction: vi.fn(),
}))

vi.mock("@/lib/commerce/actions", () => ({
  decideRefundAction: vi.fn(async () => ({ ok: true })),
}))

import { MerchantAnalyticsPanel } from "./analytics-panel"
import { MerchantOverviewPanel } from "./overview-panel"
import { RefundRequestsPanel } from "./refund-requests"
import { SalesTabs } from "./sales-tabs"
import { SalesView } from "./sales-view"
import { resolveRange } from "@/lib/dates/lagos"
import {
  formatBpsPercent,
  refundStatusLabel,
  saleStatusLabel,
  salesTabFromParam,
  type VendorDailyPoint,
  type VendorOverview,
  type VendorRefundRow,
  type VendorSaleRow,
  type VendorTopProduct,
} from "@/lib/merchant/types"

beforeEach(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
    NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
    NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_COOKIE_DOMAIN: "",
  })) {
    process.env[key] = value
  }
})

const NOW = new Date("2026-11-22T10:00:00.000Z")
const range = resolveRange({ preset: "last7" }, NOW).range

const OVERVIEW: VendorOverview = {
  orders: 3,
  grossKobo: 1300000,
  vendorNetKobo: 1130250,
  platformFeeKobo: 130000,
  affiliateCommissionKobo: 30000,
  affiliateOrders: 1,
  refundsCount: 1,
  refundsKobo: 500000,
  refundRateBps: 3846,
  pendingKobo: 1576500,
  availableKobo: 0,
}

const SERIES: VendorDailyPoint[] = [
  { day: "2026-11-17", orders: 1, grossKobo: 500000, vendorNetKobo: 446250 },
  { day: "2026-11-18", orders: 0, grossKobo: 0, vendorNetKobo: 0 },
]

const PRODUCTS: VendorTopProduct[] = [
  { productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Account Product A", orders: 5, grossKobo: 2500000, refunds: 1 },
]

const SALE: VendorSaleRow = {
  orderNumber: "AFV-2026-000002",
  productTitle: "Account Product B",
  status: "paid",
  paidAt: "2026-11-18T23:30:00Z",
  grossKobo: 300000,
  vendorNetKobo: 237750,
  viaAffiliate: true,
}

const REQUEST: VendorRefundRow = {
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  orderNumber: "AFV-2026-000001",
  productTitle: "Account Product A",
  reason: "I bought this by mistake, please refund it.",
  status: "requested",
  autoApproved: false,
  requestedAt: "2026-11-21T12:00:00Z",
  decidedAt: null,
  amountKobo: 500000,
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element)
}

describe("MerchantOverviewPanel", () => {
  it("shows the six numbers with their definitions", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: OVERVIEW,
        series: SERIES,
        topProducts: PRODUCTS,
      }),
    )

    expect(html).toContain("Orders")
    expect(html).toContain("Gross sales")
    expect(html).toContain("Your earnings")
    expect(html).toContain("Pending balance")
    expect(html).toContain("Available balance")
    expect(html).toContain("13,000")
    expect(html).toContain("38.46%")
    expect(html).toContain("How these are calculated")
  })

  it("points to the payout details page for withdrawals", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: OVERVIEW,
        series: SERIES,
        topProducts: PRODUCTS,
      }),
    )

    expect(html).toContain("Withdrawals are on your payout details page.")
    expect(html).toContain('href="/payout-details"')
  })

  it("draws the chart with a text alternative and a daily table", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: OVERVIEW,
        series: SERIES,
        topProducts: PRODUCTS,
      }),
    )

    expect(html).toContain("Gross sales per day")
    expect(html).toContain("role=\"img\"")
    expect(html).toContain("Every day")
    expect(html).toContain("17 Nov 2026")
  })

  it("says there were no sales rather than drawing a flat lie", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: { ...OVERVIEW, orders: 0, grossKobo: 0, vendorNetKobo: 0 },
        series: [],
        topProducts: [],
      }),
    )

    expect(html).toContain("No sales in this range yet.")
    expect(html).toContain("No product sold in this range yet.")
  })

  it("shows a skeleton before the numbers arrive", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: null,
        series: [],
        topProducts: [],
        loading: true,
      }),
    )

    expect(html).toContain("Loading your numbers")
  })

  it("shows the one error sentence", () => {
    const html = render(
      createElement(MerchantOverviewPanel, {
        range,
        today: "2026-11-22",
        overview: OVERVIEW,
        series: SERIES,
        topProducts: PRODUCTS,
        error: "Choose a date range of 366 days or fewer, starting before it ends.",
      }),
    )

    expect(html).toContain("Choose a date range of 366 days or fewer")
  })
})

describe("MerchantAnalyticsPanel", () => {
  it("shows the affiliate share of the orders", () => {
    const html = render(
      createElement(MerchantAnalyticsPanel, {
        range,
        today: "2026-11-22",
        overview: OVERVIEW,
        series: SERIES,
        topProducts: PRODUCTS,
      }),
    )

    expect(html).toContain("Affiliate share")
    expect(html).toContain("33.33%")
    expect(html).toContain("1 of 3 orders")
    expect(html).toContain("Affiliates earned")
  })

  it("shows zero rather than a division by zero", () => {
    const html = render(
      createElement(MerchantAnalyticsPanel, {
        range,
        today: "2026-11-22",
        overview: { ...OVERVIEW, orders: 0, affiliateOrders: 0 },
        series: [],
        topProducts: [],
      }),
    )

    expect(html).toContain("Affiliate share")
    expect(html).toContain("0%")
  })
})

describe("SalesView", () => {
  it("lists a sale and tags the ones that came through an affiliate", () => {
    const html = render(
      createElement(SalesView, {
        initialPage: { items: [SALE], nextCursor: null },
        status: null,
      }),
    )

    expect(html).toContain("AFV-2026-000002")
    expect(html).toContain("Account Product B")
    expect(html).toContain("via affiliate")
    expect(html).toContain("3,000")
    expect(html).toContain("Paid")
  })

  it("says the view is empty without inventing rows", () => {
    const html = render(
      createElement(SalesView, {
        initialPage: { items: [], nextCursor: null },
        status: "refunded",
      }),
    )

    expect(html).toContain("No sales in this view yet.")
  })

  it("shows the error sentence when the page could not be read", () => {
    const html = render(
      createElement(SalesView, {
        initialPage: { items: [], nextCursor: null },
        status: null,
        initialError: "Something went wrong. Please try again.",
      }),
    )

    expect(html).toContain("Something went wrong. Please try again.")
  })
})

describe("RefundRequestsPanel", () => {
  it("offers a decision only on a request that is waiting", () => {
    const waiting = render(
      createElement(RefundRequestsPanel, {
        initialPage: { items: [REQUEST], nextCursor: null },
      }),
    )
    const decided = render(
      createElement(RefundRequestsPanel, {
        initialPage: {
          items: [
            {
              ...REQUEST,
              status: "processed",
              decidedAt: "2026-11-21T13:00:00Z",
            },
          ],
          nextCursor: null,
        },
      }),
    )

    expect(waiting).toContain("Approve")
    expect(waiting).toContain("Reject")
    expect(waiting).toContain("I bought this by mistake")
    expect(waiting).toContain("Waiting for a decision")

    expect(decided).toContain("Refunded")
    expect(decided).not.toContain(">Approve<")
    expect(decided).not.toContain(">Reject<")
  })

  it("says there are no requests yet", () => {
    const html = render(
      createElement(RefundRequestsPanel, {
        initialPage: { items: [], nextCursor: null },
      }),
    )

    expect(html).toContain("No refund requests yet.")
  })
})

describe("SalesTabs", () => {
  it("marks the current tab for a screen reader and a keyboard", () => {
    const html = render(createElement(SalesTabs, { tab: "refunded" }))

    expect(html).toContain('aria-current="page"')
    expect(html).toContain("Refunded")
    expect(html).toContain("Refund requests")
    expect(html).toContain("/sales?tab=paid")
  })
})

describe("the merchant words", () => {
  it("reads a rate in basis points as a percentage", () => {
    expect(formatBpsPercent(3846)).toBe("38.46%")
    expect(formatBpsPercent(5000)).toBe("50%")
    expect(formatBpsPercent(0)).toBe("0%")
    expect(formatBpsPercent(3333)).toBe("33.33%")
  })

  it("reads a tab, defaulting to all", () => {
    expect(salesTabFromParam("paid")).toBe("paid")
    // "refunds" is a screen of its own, not a sales status: the sales list
    // helper answers "all" for it, and the page reads the tab with its own list.
    expect(salesTabFromParam("refunds")).toBe("all")
    expect(salesTabFromParam("nonsense")).toBe("all")
    expect(salesTabFromParam(undefined)).toBe("all")
  })

  it("names a sale status and a refund status in words", () => {
    expect(saleStatusLabel("paid")).toBe("Paid")
    expect(saleStatusLabel("something-new")).toBe("Unknown")
    expect(refundStatusLabel("requested")).toBe("Waiting for a decision")
    expect(refundStatusLabel("processed")).toBe("Refunded")
  })
})
