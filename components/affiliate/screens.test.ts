import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// What the affiliate and merchant screens put on the page.
//
// These are render tests, not browser tests: each component is rendered to
// static markup with real props, in each state it can be in. What is checked is
// what a person would read: the words for an empty screen, the one error
// sentence, the definition behind each number, and that a blocked affiliate is
// never offered a button that cannot work.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

import { AnalyticsPanel } from "./analytics-panel"
import { CommissionsPanel } from "./commissions-panel"
import { DateRangePicker } from "./date-range-picker"
import { InvitesPanel } from "./invites-panel"
import { JoinOutcome } from "./join-outcome"
import { LinksView } from "./links-view"
import { MarketplaceBrowser, MarketplaceResults } from "./marketplace-browser"
import { MarketplaceCard } from "./marketplace-card"
import { OverviewPanel } from "./overview-panel"
import { PerformanceTable } from "./performance-table"
import { RequestsTable } from "./requests-table"
import { SkeletonCards, SkeletonKpis, SkeletonRows } from "./skeletons"
import { VendorTabs } from "./vendor-tabs"
import { HOW_CALCULATED, METRICS } from "@/lib/affiliate/definitions"
import type {
  AffiliateRequestRow,
  Balance,
  CommissionRow,
  DailyPoint,
  InviteRow,
  LinkStat,
  MarketplaceAccess,
  MarketplaceItem,
  Overview,
  VendorAffiliateRow,
} from "@/lib/affiliate/read-types"
import { resolveRange, type LagosRange } from "@/lib/dates/lagos"

// The short link builders read the public host map, so the test environment has
// to look like a deployed one.
beforeEach(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
    NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
    NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
    NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_COOKIE_DOMAIN: "",
  })) {
    process.env[key] = value
  }
})

const NOW = new Date("2026-11-20T15:23:00.000Z")

function range(): LagosRange {
  const result = resolveRange({ preset: "last7" }, NOW)

  if (!result.ok) {
    throw new Error("the test range must resolve")
  }

  return result.range
}

const OVERVIEW: Overview = {
  clicks: 120,
  uniqueClicks: 90,
  orders: 9,
  revenueKobo: 4_500_000,
  commissionKobo: 450_000,
  conversionBps: 1000,
  epcKoboPer100Clicks: 375_000,
  balance: { pendingKobo: 150_000, availableKobo: 300_000, totalKobo: 450_000, negative: false },
}

const EMPTY_OVERVIEW: Overview = {
  clicks: 0,
  uniqueClicks: 0,
  orders: 0,
  revenueKobo: 0,
  commissionKobo: 0,
  conversionBps: 0,
  epcKoboPer100Clicks: 0,
  balance: { pendingKobo: 0, availableKobo: 0, totalKobo: 0, negative: false },
}

const SERIES: DailyPoint[] = [
  { day: "2026-11-18", clicks: 40, uniqueClicks: 30, orders: 3, commissionKobo: 150_000 },
  { day: "2026-11-19", clicks: 80, uniqueClicks: 60, orders: 6, commissionKobo: 300_000 },
]

const LINK: LinkStat = {
  linkId: "55555555-5555-4555-8555-555555555555",
  code: "abc123",
  alias: null,
  label: "Story",
  productTitle: "Calm notebook",
  status: "active",
  clicks: 12,
  uniqueClicks: 9,
  orders: 2,
  commissionKobo: 30_000,
}

const COMMISSION: CommissionRow = {
  orderNumber: "AF-1001",
  productTitle: "Calm notebook",
  commissionKobo: 15_000,
  status: "paid",
  paidAt: "2026-11-18T10:00:00.000Z",
  availableAt: "2026-11-25T10:00:00.000Z",
}

const BALANCE: Balance = {
  pendingKobo: 15_000,
  availableKobo: 30_000,
  totalKobo: 45_000,
  negative: false,
}

const PRODUCT: MarketplaceItem = {
  productId: "44444444-4444-4444-8444-444444444444",
  slug: "calm-notebook",
  title: "Calm notebook",
  shortDescription: "A notebook that lies flat.",
  coverPublicId: "products/calm",
  vendorName: "Ada Press",
  categorySlug: "books",
  priceKobo: 250_000,
  commissionBps: 2500,
  affiliateApproval: "open",
  myAccess: "approved",
  myLinkCount: 1,
}

const REQUEST: AffiliateRequestRow = {
  affiliateId: "66666666-6666-4666-8666-666666666666",
  username: "ada",
  productId: "44444444-4444-4444-8444-444444444444",
  productTitle: "Calm notebook",
  status: "pending",
  note: "I write about notebooks.",
  requestedAt: "2026-11-19T09:00:00.000Z",
}

const VENDOR_ROW: VendorAffiliateRow = {
  affiliateId: "66666666-6666-4666-8666-666666666666",
  username: "ada",
  clicks: 10,
  uniqueClicks: 8,
  orders: 2,
  revenueKobo: 500_000,
  commissionKobo: 50_000,
}

const INVITE: InviteRow = {
  id: "88888888-8888-4888-8888-888888888888",
  productTitle: "Calm notebook",
  maxUses: 5,
  uses: 1,
  expiresAt: "2026-12-01T00:00:00.000Z",
  revokedAt: null,
  createdAt: "2026-11-19T09:00:00.000Z",
}

function html(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
}

describe("the overview", () => {
  it("shows the eight numbers, the definitions and the daily table when loaded", () => {
    const markup = html(
      createElement(OverviewPanel, {
        range: range(),
        today: "2026-11-20",
        overview: OVERVIEW,
        series: SERIES,
      }),
    )

    for (const metric of HOW_CALCULATED) {
      expect(text(markup)).toContain(metric.label)
      expect(text(markup)).toContain(metric.definition)
    }

    expect(text(markup)).toContain("How these are calculated")
    expect(text(markup)).toContain("Clicks per day, 2026-11-14 to 2026-11-20")
    expect(text(markup)).toContain("Every day in the range")
    expect(text(markup)).toContain("18 Nov 2026")
    expect(markup).toContain("<table")
  })

  it("offers the marketplace when there is nothing to show", () => {
    const markup = html(
      createElement(OverviewPanel, {
        range: range(),
        today: "2026-11-20",
        overview: EMPTY_OVERVIEW,
        series: [],
      }),
    )

    expect(text(markup)).toContain("Nothing happened in these days yet")
    expect(markup).toContain('href="/marketplace"')
  })

  it("shows skeletons while loading and no numbers", () => {
    const markup = html(
      createElement(OverviewPanel, {
        range: range(),
        today: "2026-11-20",
        overview: null,
        series: [],
        loading: true,
      }),
    )

    expect(markup).toContain('aria-busy="true"')
    expect(text(markup)).toContain("Loading the numbers")
    expect(text(markup)).not.toContain("Conversion rate")
  })

  it("shows one sentence when the read failed", () => {
    const markup = html(
      createElement(OverviewPanel, {
        range: range(),
        today: "2026-11-20",
        overview: null,
        series: [],
        error: "The numbers could not be loaded just now.",
      }),
    )

    expect(markup).toContain('role="alert"')
    expect(text(markup)).toContain("The numbers could not be loaded just now.")
  })

  it("warns in words when the balance is below zero", () => {
    const markup = html(
      createElement(OverviewPanel, {
        range: range(),
        today: "2026-11-20",
        overview: {
          ...OVERVIEW,
          balance: { pendingKobo: 0, availableKobo: -1000, totalKobo: -1000, negative: true },
        },
        series: SERIES,
      }),
    )

    expect(text(markup)).toContain("Your balance is below zero by")
  })
})

describe("the marketplace", () => {
  const base = {
    cloudName: "affilova",
    onGetLink: vi.fn(),
    onRequestAccess: vi.fn(),
  }

  it("shows product cards with price and commission when loaded", () => {
    const markup = html(
      createElement(MarketplaceResults, { ...base, items: [PRODUCT], hasMore: true }),
    )

    expect(text(markup)).toContain("Calm notebook")
    expect(text(markup)).toContain("Ada Press")
    expect(text(markup)).toContain("₦2,500")
    expect(text(markup)).toContain("25%")
    expect(text(markup)).toContain("1 product shown, more available")
    expect(text(markup)).toContain("Load more")
    expect(markup).toContain("c_fill,w_400,h_300,f_auto,q_auto/products/calm")
  })

  it("says what to try when nothing matches", () => {
    const markup = html(createElement(MarketplaceResults, { ...base, items: [] }))

    expect(text(markup)).toContain("No products match this search")
    expect(text(markup)).toContain("Try a shorter search")
  })

  it("shows skeleton cards while loading", () => {
    const markup = html(
      createElement(MarketplaceResults, { ...base, items: [], loading: true }),
    )

    expect(markup).toContain('aria-busy="true"')
    expect(text(markup)).toContain("Loading the marketplace")
  })

  it("shows the error sentence instead of results", () => {
    const markup = html(
      createElement(MarketplaceResults, {
        ...base,
        items: [],
        error: "The marketplace could not be loaded just now.",
      }),
    )

    expect(markup).toContain('role="alert"')
    expect(text(markup)).toContain("The marketplace could not be loaded just now.")
  })

  it("renders the filter bar, the count and the load more button", () => {
    const markup = html(
      createElement(MarketplaceBrowser, {
        initialPage: { items: [PRODUCT], nextCursor: "cursor-1" },
        initialError: null,
        initialFilters: { q: "", category: "", minCommissionBps: 0, sort: "newest" },
        categories: [{ slug: "books", name: "Books" }],
        cloudName: "affilova",
      }),
    )

    expect(text(markup)).toContain("Search")
    expect(text(markup)).toContain("All categories")
    expect(text(markup)).toContain("Any commission")
    expect(text(markup)).toContain("Highest commission")
    expect(text(markup)).toContain("Load more")
  })

  const ACCESS: readonly MarketplaceAccess[] = [
    "none",
    "pending",
    "approved",
    "rejected",
    "blocked",
  ]

  for (const access of ACCESS) {
    it(`shows the right action for access "${access}"`, () => {
      const markup = html(
        createElement(MarketplaceCard, {
          item: { ...PRODUCT, myAccess: access, affiliateApproval: "approval" },
          coverUrl: null,
        }),
      )
      const words = text(markup)

      if (access === "approved") {
        expect(words).toContain("Get link")
        expect(words).not.toContain("Request access")
      }

      if (access === "none") {
        expect(words).toContain("Request access")
        expect(words).not.toContain("Get link")
      }

      if (access === "pending") {
        expect(words).toContain("Request pending")
        expect(words).toContain("The vendor has your request")
        expect(words).not.toContain("Request access")
        expect(words).not.toContain("Get link")
      }

      if (access === "rejected") {
        expect(words).toContain("declined your request")
        expect(words).not.toContain("Get link")
        expect(words).not.toContain("Request access")
      }

      if (access === "blocked") {
        expect(words).toContain("has blocked you from promoting it")
        expect(words).not.toContain("Get link")
        expect(words).not.toContain("Request access")
      }
    })
  }

  it("gives an open product a link button without asking", () => {
    const markup = html(
      createElement(MarketplaceCard, {
        item: { ...PRODUCT, myAccess: "none", affiliateApproval: "open" },
        coverUrl: null,
      }),
    )

    expect(text(markup)).toContain("Get link")
    expect(text(markup)).not.toContain("Request access")
  })

  it("explains an invite-only product without a button", () => {
    const markup = html(
      createElement(MarketplaceCard, {
        item: { ...PRODUCT, myAccess: "none", affiliateApproval: "invite" },
        coverUrl: null,
      }),
    )

    expect(text(markup)).toContain("invite only")
    expect(text(markup)).not.toContain("Request access")
  })
})

describe("my links", () => {
  const base = { from: "2026-11-14", to: "2026-11-20", initialError: null }

  it("shows a row with its short link, numbers and status when loaded", () => {
    const markup = html(
      createElement(LinksView, {
        ...base,
        initialPage: { items: [LINK], nextCursor: null },
      }),
    )

    expect(text(markup)).toContain("Story")
    expect(text(markup)).toContain("Calm notebook")
    expect(text(markup)).toContain("Active")
    expect(text(markup)).toContain("₦300")
    expect(text(markup)).toContain("Copy")
    expect(text(markup)).toContain("QR")
    expect(text(markup)).toContain("Share")
    expect(text(markup)).toContain("Parameters")
  })

  it("explains how to get a first link when there are none", () => {
    const markup = html(
      createElement(LinksView, { ...base, initialPage: { items: [], nextCursor: null } }),
    )

    expect(text(markup)).toContain("You have no links yet")
    expect(text(markup)).toContain("Find a product in the marketplace")
    expect(markup).toContain('href="/marketplace"')
  })

  it("shows skeleton rows while loading", () => {
    const markup = html(
      createElement(LinksView, {
        ...base,
        initialPage: { items: [], nextCursor: null },
        loading: true,
      }),
    )

    expect(markup).toContain('aria-busy="true"')
    expect(text(markup)).toContain("Loading your links")
  })

  it("shows the error sentence when the read failed", () => {
    const markup = html(
      createElement(LinksView, {
        ...base,
        initialError: "Your links could not be loaded just now.",
        initialPage: { items: [], nextCursor: null },
      }),
    )

    expect(markup).toContain('role="alert"')
    expect(text(markup)).toContain("Your links could not be loaded just now.")
  })
})

describe("earnings", () => {
  const base = { initialError: null, balance: BALANCE, holdDays: 14 }

  it("shows the balance, the hold and the commissions when loaded", () => {
    const markup = html(
      createElement(CommissionsPanel, {
        ...base,
        initialPage: { items: [COMMISSION], nextCursor: null },
      }),
    )
    const words = text(markup)

    expect(words).toContain("Pending")
    expect(words).toContain("Available")
    expect(words).toContain("₦150")
    expect(words).toContain("Commission is held for 14 days")
    expect(words).toContain("Withdraw your available balance")
    expect(words).toContain("AF-1001")
    expect(words).toContain("25 Nov 2026")
  })

  it("explains an empty commission list", () => {
    const markup = html(
      createElement(CommissionsPanel, { ...base, initialPage: { items: [], nextCursor: null } }),
    )

    expect(text(markup)).toContain("No commission yet")
  })

  it("shows skeletons while loading", () => {
    const markup = html(
      createElement(CommissionsPanel, {
        ...base,
        initialPage: { items: [], nextCursor: null },
        loading: true,
      }),
    )

    expect(markup).toContain('aria-busy="true"')
    expect(text(markup)).toContain("Loading your commissions")
  })

  it("shows the error sentence when the read failed", () => {
    const markup = html(
      createElement(CommissionsPanel, {
        ...base,
        initialError: "Your commissions could not be loaded just now.",
        initialPage: { items: [], nextCursor: null },
      }),
    )

    expect(text(markup)).toContain("Your commissions could not be loaded just now.")
  })

  it("warns in words when the balance is negative", () => {
    const markup = html(
      createElement(CommissionsPanel, {
        ...base,
        balance: { pendingKobo: 0, availableKobo: -1000, totalKobo: -1000, negative: true },
        initialPage: { items: [], nextCursor: null },
      }),
    )

    expect(text(markup)).toContain("Your balance is below zero by")
  })
})

describe("analytics", () => {
  const base = {
    range: range(),
    today: "2026-11-20",
    overview: OVERVIEW,
    linkStats: [LINK],
    breakdown: [],
  }

  it("shows the four tabs, the KPI row and the link table", () => {
    const markup = html(createElement(AnalyticsPanel, { ...base, tab: "link" }))
    const words = text(markup)

    expect(words).toContain("By link")
    expect(words).toContain("By product")
    expect(words).toContain("By campaign (s1)")
    expect(words).toContain("By utm_source")
    expect(words).toContain("Conversion rate")
    expect(words).toContain("Story")
    expect(markup).toContain('aria-current="page"')
  })

  it("shows the breakdown for the chosen dimension", () => {
    const markup = html(
      createElement(AnalyticsPanel, {
        ...base,
        tab: "sub1",
        linkStats: [],
        breakdown: [
          { label: "instagram", clicks: 5, uniqueClicks: 4, orders: 1, commissionKobo: 1500 },
        ],
      }),
    )

    expect(text(markup)).toContain("instagram")
    expect(text(markup)).toContain("s1 is the campaign label")
  })

  it("explains an empty breakdown", () => {
    const markup = html(createElement(AnalyticsPanel, { ...base, tab: "product", linkStats: [] }))

    expect(text(markup)).toContain("Nothing recorded for this breakdown in these days.")
  })

  it("shows skeletons while loading", () => {
    const markup = html(
      createElement(AnalyticsPanel, { ...base, tab: "link", overview: null, loading: true }),
    )

    expect(markup).toContain('aria-busy="true"')
  })

  it("shows the error sentence when the read failed", () => {
    const markup = html(
      createElement(AnalyticsPanel, {
        ...base,
        tab: "link",
        error: "The breakdown could not be loaded just now.",
      }),
    )

    expect(markup).toContain('role="alert"')
    expect(text(markup)).toContain("The breakdown could not be loaded just now.")
  })
})

describe("the merchant's affiliate tabs", () => {
  it("lists the five tabs and marks the current one", () => {
    const markup = html(createElement(VendorTabs, { tab: "performance" }))

    for (const label of ["Requests", "Approved", "Blocked", "Performance", "Invites"]) {
      expect(text(markup)).toContain(label)
    }

    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('href="/affiliates?tab=performance"')
  })

  it("shows a request with its note and the three decisions", () => {
    const markup = html(createElement(RequestsTable, { requests: [REQUEST], showActions: true }))
    const words = text(markup)

    expect(words).toContain("ada")
    expect(words).toContain("I write about notebooks.")
    expect(words).toContain("Approve")
    expect(words).toContain("Decline")
    expect(words).toContain("Block")
    expect(words).toContain("19 Nov 2026")
  })

  it("explains an empty request list", () => {
    const markup = html(createElement(RequestsTable, { requests: [] }))

    expect(text(markup)).toContain("No requests here yet")
  })

  it("shows affiliate performance when loaded", () => {
    const markup = html(createElement(PerformanceTable, { rows: [VENDOR_ROW] }))
    const words = text(markup)

    expect(words).toContain("ada")
    expect(words).toContain("₦5,000")
    expect(words).toContain("₦500")
  })

  it("explains an empty performance table", () => {
    const markup = html(createElement(PerformanceTable, { rows: [] }))

    expect(text(markup)).toContain("No affiliate has sold anything in these days yet.")
  })

  it("shows invites with uses, expiry and a revoke button", () => {
    const markup = html(
      createElement(InvitesPanel, { invites: [INVITE], products: [], initialError: null }),
    )
    const words = text(markup)

    expect(words).toContain("Calm notebook")
    expect(words).toContain("1 of 5")
    expect(words).toContain("1 Dec 2026")
    expect(words).toContain("Revoke")
    expect(words).toContain("Create invite")
  })

  it("explains an empty invite list", () => {
    const markup = html(
      createElement(InvitesPanel, { invites: [], products: [], initialError: null }),
    )

    expect(text(markup)).toContain("No invitations yet")
  })

  it("shows the invite error sentence", () => {
    const markup = html(
      createElement(InvitesPanel, {
        invites: [],
        products: [],
        initialError: "Your invitations could not be loaded just now.",
      }),
    )

    expect(text(markup)).toContain("Your invitations could not be loaded just now.")
  })
})

describe("the join page outcomes", () => {
  it("names the product when the invitation was accepted", () => {
    const markup = html(
      createElement(JoinOutcome, {
        outcome: { ok: true, productTitle: "Calm notebook" },
        affiliateUrl: "https://affiliates.affilova.vercel.app/",
      }),
    )

    expect(text(markup)).toContain("You can now promote Calm notebook")
    expect(markup).toContain("https://affiliates.affilova.vercel.app/")
  })

  it("gives one neutral sentence for every failure", () => {
    const markup = html(
      createElement(JoinOutcome, {
        outcome: { ok: false },
        affiliateUrl: "https://affiliates.affilova.vercel.app/",
      }),
    )
    const words = text(markup)

    expect(words).toContain("This invite is not valid")
    expect(words).not.toContain("expired token")
    expect(words).not.toContain("revoked")
    expect(words).toContain("Ask the vendor for a new one.")
  })
})

describe("the date range picker", () => {
  it("marks the current preset and keeps the other parameters", () => {
    const markup = html(
      createElement(DateRangePicker, {
        value: range(),
        basePath: "/analytics",
        params: { tab: "sub1" },
        today: "2026-11-20",
      }),
    )

    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain("tab=sub1")
    expect(markup).toContain('href="/analytics?tab=sub1&amp;preset=today"')
    expect(text(markup)).toContain("Apply range")
  })
})

describe("the shared loading shapes", () => {
  it("announce loading once and hide the blocks from screen readers", () => {
    for (const element of [
      createElement(SkeletonRows, { rows: 2 }),
      createElement(SkeletonCards, { cards: 2 }),
      createElement(SkeletonKpis, { cards: 2 }),
    ]) {
      const markup = html(element)

      expect(markup).toContain('aria-busy="true"')
      expect(markup).toContain('role="status"')
      expect(markup).toContain('aria-hidden="true"')
    }
  })
})

describe("the metric definitions", () => {
  it("define every number the overview shows", () => {
    const labels = HOW_CALCULATED.map((metric) => metric.label)

    expect(labels).toEqual([
      "Clicks",
      "Unique clicks",
      "Orders",
      "Conversion rate",
      "Earnings per 100 clicks",
      "Commission earned",
      "Pending balance",
      "Available balance",
    ])

    for (const metric of Object.values(METRICS)) {
      expect(metric.definition.length).toBeGreaterThan(20)
      expect(metric.how.length).toBeGreaterThan(20)
    }
  })
})
