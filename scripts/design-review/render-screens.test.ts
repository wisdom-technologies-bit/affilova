import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// The design review pages.
//
// This renders each screen through the real components with fixed mock props and
// writes plain HTML files. A browser then screenshots those files at the two
// review sizes. No database, no session, no server action: what is being looked
// at is the layout, the empty and error words, and the states a person sees.
//
// It is skipped in the ordinary suite (SCREENS=1 turns it on) because it writes
// files; the screenshots themselves are committed under docs/design-review.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

import { AppShell } from "@/components/app-shell/app-shell"
import { PageHeader } from "@/components/app-shell/page-header"
import { AnalyticsPanel } from "@/components/affiliate/analytics-panel"
import { CommissionsPanel } from "@/components/affiliate/commissions-panel"
import { JoinOutcome } from "@/components/affiliate/join-outcome"
import { LinksView } from "@/components/affiliate/links-view"
import { MarketplaceBrowser } from "@/components/affiliate/marketplace-browser"
import { OverviewPanel } from "@/components/affiliate/overview-panel"
import { PerformanceTable } from "@/components/affiliate/performance-table"
import { RequestsTable } from "@/components/affiliate/requests-table"
import { InvitesPanel } from "@/components/affiliate/invites-panel"
import { VendorTabs } from "@/components/affiliate/vendor-tabs"
import type {
  AffiliateRequestRow,
  CommissionRow,
  DailyPoint,
  InviteRow,
  LinkStat,
  MarketplaceItem,
  Overview,
  VendorAffiliateRow,
} from "@/lib/affiliate/read-types"
import { resolveRange } from "@/lib/dates/lagos"

// The shell links to every app the account may open, so the public host map has
// to be present while these pages are rendered.
for (const [key, value] of Object.entries({
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.example.com",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.example.com",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.example.com",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.example.com",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_COOKIE_DOMAIN: "",
})) {
  process.env[key] = value
}

const OUTPUT = join(process.cwd(), "docs/design-review/affiliate/html")
const CSS_DIR = join(process.cwd(), ".next/static/chunks")

const NOW = new Date("2026-11-20T15:23:00.000Z")

function range() {
  const result = resolveRange({ preset: "last7" }, NOW)

  if (!result.ok) {
    throw new Error("the review range must resolve")
  }

  return result.range
}

const OVERVIEW: Overview = {
  clicks: 1284,
  uniqueClicks: 906,
  orders: 41,
  revenueKobo: 18_450_000,
  commissionKobo: 2_145_000,
  conversionBps: 452,
  epcKoboPer100Clicks: 167_056,
  balance: {
    pendingKobo: 320_000,
    availableKobo: 1_825_000,
    totalKobo: 2_145_000,
    negative: false,
  },
}

const SERIES: DailyPoint[] = [
  { day: "2026-11-14", clicks: 132, uniqueClicks: 98, orders: 4, commissionKobo: 210_000 },
  { day: "2026-11-15", clicks: 176, uniqueClicks: 121, orders: 6, commissionKobo: 330_000 },
  { day: "2026-11-16", clicks: 148, uniqueClicks: 102, orders: 3, commissionKobo: 165_000 },
  { day: "2026-11-17", clicks: 210, uniqueClicks: 149, orders: 7, commissionKobo: 390_000 },
  { day: "2026-11-18", clicks: 190, uniqueClicks: 133, orders: 5, commissionKobo: 285_000 },
  { day: "2026-11-19", clicks: 236, uniqueClicks: 161, orders: 9, commissionKobo: 465_000 },
  { day: "2026-11-20", clicks: 192, uniqueClicks: 142, orders: 7, commissionKobo: 300_000 },
]

const PRODUCTS: MarketplaceItem[] = [
  {
    productId: "44444444-4444-4444-8444-444444444401",
    slug: "calm-notebook",
    title: "The Calm Notebook",
    shortDescription: "A lay-flat notebook for people who think on paper.",
    coverPublicId: null,
    vendorName: "Ada Press",
    categorySlug: "books",
    priceKobo: 850_000,
    commissionBps: 2500,
    affiliateApproval: "open",
    myAccess: "approved",
    myLinkCount: 2,
  },
  {
    productId: "44444444-4444-4444-8444-444444444402",
    slug: "focus-planner",
    title: "The Focus Planner",
    shortDescription: "A twelve week planner with a weekly review built in.",
    coverPublicId: null,
    vendorName: "Ada Press",
    categorySlug: "books",
    priceKobo: 1_200_000,
    commissionBps: 3000,
    affiliateApproval: "approval",
    myAccess: "none",
    myLinkCount: 0,
  },
  {
    productId: "44444444-4444-4444-8444-444444444403",
    slug: "invoice-templates",
    title: "Freelance invoice templates",
    shortDescription: "Eleven invoice layouts for small studios.",
    coverPublicId: null,
    vendorName: "Studio Kite",
    categorySlug: "templates",
    priceKobo: 450_000,
    commissionBps: 4000,
    affiliateApproval: "approval",
    myAccess: "pending",
    myLinkCount: 0,
  },
  {
    productId: "44444444-4444-4444-8444-444444444404",
    slug: "quiet-mornings",
    title: "Quiet Mornings",
    shortDescription: "A short audio course on starting the day slowly.",
    coverPublicId: null,
    vendorName: "North Audio",
    categorySlug: "audio",
    priceKobo: 650_000,
    commissionBps: 3500,
    affiliateApproval: "invite",
    myAccess: "none",
    myLinkCount: 0,
  },
]

const LINKS: LinkStat[] = [
  {
    linkId: "55555555-5555-4555-8555-555555555501",
    code: "clm7x2",
    alias: null,
    label: "Instagram story",
    productTitle: "The Calm Notebook",
    status: "active",
    clicks: 812,
    uniqueClicks: 590,
    orders: 24,
    commissionKobo: 1_260_000,
  },
  {
    linkId: "55555555-5555-4555-8555-555555555502",
    code: "fcs9k1",
    alias: "focus-newsletter",
    label: "Newsletter",
    productTitle: "The Focus Planner",
    status: "active",
    clicks: 322,
    uniqueClicks: 241,
    orders: 13,
    commissionKobo: 705_000,
  },
  {
    linkId: "55555555-5555-4555-8555-555555555503",
    code: "inv3r8",
    alias: null,
    label: "Old thread",
    productTitle: "Freelance invoice templates",
    status: "archived",
    clicks: 150,
    uniqueClicks: 75,
    orders: 4,
    commissionKobo: 180_000,
  },
]

const COMMISSIONS: CommissionRow[] = [
  {
    orderNumber: "AF-2041",
    productTitle: "The Calm Notebook",
    commissionKobo: 212_500,
    status: "paid",
    paidAt: "2026-11-19T09:12:00.000Z",
    availableAt: "2026-11-26T09:12:00.000Z",
  },
  {
    orderNumber: "AF-2038",
    productTitle: "The Focus Planner",
    commissionKobo: 360_000,
    status: "paid",
    paidAt: "2026-11-18T16:40:00.000Z",
    availableAt: "2026-11-25T16:40:00.000Z",
  },
  {
    orderNumber: "AF-2033",
    productTitle: "Freelance invoice templates",
    commissionKobo: 180_000,
    status: "refunded",
    paidAt: "2026-11-16T11:05:00.000Z",
    availableAt: null,
  },
]

const REQUESTS: AffiliateRequestRow[] = [
  {
    affiliateId: "66666666-6666-4666-8666-666666666601",
    username: "ada.writes",
    productId: "44444444-4444-4444-8444-444444444401",
    productTitle: "The Calm Notebook",
    status: "pending",
    note: "I write a weekly newsletter about notebooks to 4,000 readers.",
    requestedAt: "2026-11-19T08:20:00.000Z",
  },
  {
    affiliateId: "66666666-6666-4666-8666-666666666602",
    username: "kite.studio",
    productId: "44444444-4444-4444-8444-444444444402",
    productTitle: "The Focus Planner",
    status: "pending",
    note: null,
    requestedAt: "2026-11-18T15:02:00.000Z",
  },
]

const PERFORMANCE: VendorAffiliateRow[] = [
  {
    affiliateId: "66666666-6666-4666-8666-666666666601",
    username: "ada.writes",
    clicks: 812,
    uniqueClicks: 590,
    orders: 24,
    revenueKobo: 20_400_000,
    commissionKobo: 5_100_000,
  },
  {
    affiliateId: "66666666-6666-4666-8666-666666666602",
    username: "kite.studio",
    clicks: 322,
    uniqueClicks: 241,
    orders: 13,
    revenueKobo: 15_600_000,
    commissionKobo: 4_680_000,
  },
]

const INVITES: InviteRow[] = [
  {
    id: "88888888-8888-4888-8888-888888888801",
    productTitle: "The Calm Notebook",
    maxUses: 5,
    uses: 2,
    expiresAt: "2026-12-04T09:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-11-19T09:00:00.000Z",
  },
  {
    id: "88888888-8888-4888-8888-888888888802",
    productTitle: "The Focus Planner",
    maxUses: 1,
    uses: 1,
    expiresAt: "2026-11-30T09:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-11-14T09:00:00.000Z",
  },
]

const SUMMARY = {
  userId: "user-1",
  displayName: "Ada Okonkwo",
  email: "ada@example.com",
  roles: [{ role: "affiliate" as const, status: "active" as const }],
}

function page(app: "affiliate" | "merchant", children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      app,
      roles: app === "affiliate" ? ["affiliate"] : ["vendor"],
      user: SUMMARY,
      children,
    }),
  )
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="./app.css">
</head>
<body class="bg-background text-brand-ink antialiased">${body}</body>
</html>`
}

function writeScreen(name: string, title: string, body: string): void {
  // The shell points at /brand/..., which is a server path. These files are
  // opened straight from disk, so the logo is rewritten to the copy beside them.
  const html = document(title, body).replaceAll('src="/brand/', 'src="./brand/')

  writeFileSync(join(OUTPUT, `${name}.html`), html)
}

/** Every stylesheet the build emitted, in one file the review pages can link. */
function css(): string {
  let names: string[] = []

  try {
    names = readdirSync(CSS_DIR).filter((name) => name.endsWith(".css"))
  } catch {
    return ""
  }

  return names
    .map((name) => readFileSync(join(CSS_DIR, name), "utf8"))
    .join("\n")
}

describe.skipIf(process.env.SCREENS !== "1")("the affiliate screens", () => {
  it("writes one html file per screen", () => {
    mkdirSync(OUTPUT, { recursive: true })
    writeFileSync(join(OUTPUT, "app.css"), css())

    writeScreen(
      "overview",
      "Overview",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Overview" }),
          createElement(OverviewPanel, {
            range: range(),
            today: "2026-11-20",
            overview: OVERVIEW,
            series: SERIES,
          }),
        ),
      ),
    )

    writeScreen(
      "marketplace",
      "Marketplace",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Marketplace" }),
          createElement(MarketplaceBrowser, {
            initialPage: { items: PRODUCTS, nextCursor: "next-page" },
            initialError: null,
            initialFilters: { q: "", category: "", minCommissionBps: 0, sort: "newest" },
            categories: [
              { slug: "books", name: "Books" },
              { slug: "templates", name: "Templates" },
              { slug: "audio", name: "Audio" },
            ],
            cloudName: null,
          }),
        ),
      ),
    )

    writeScreen(
      "my-links",
      "My links",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "My links" }),
          createElement(LinksView, {
            initialPage: { items: LINKS, nextCursor: null },
            initialError: null,
            from: range().from,
            to: range().to,
          }),
        ),
      ),
    )

    writeScreen(
      "earnings",
      "Earnings",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Earnings" }),
          createElement(CommissionsPanel, {
            initialPage: { items: COMMISSIONS, nextCursor: null },
            initialError: null,
            balance: OVERVIEW.balance,
            holdDays: 7,
          }),
        ),
      ),
    )

    writeScreen(
      "analytics",
      "Analytics",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Analytics" }),
          createElement(AnalyticsPanel, {
            range: range(),
            today: "2026-11-20",
            tab: "sub1",
            overview: OVERVIEW,
            linkStats: [],
            breakdown: [
              { label: "instagram", clicks: 812, uniqueClicks: 590, orders: 24, commissionKobo: 1_260_000 },
              { label: "newsletter", clicks: 322, uniqueClicks: 241, orders: 13, commissionKobo: 705_000 },
              { label: "Not set", clicks: 150, uniqueClicks: 75, orders: 4, commissionKobo: 180_000 },
            ],
          }),
        ),
      ),
    )

    writeScreen(
      "vendor-requests",
      "Affiliates: requests",
      page(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Affiliates" }),
          createElement(VendorTabs, { tab: "requests" }),
          createElement(
            "div",
            { className: "mt-4" },
            createElement(RequestsTable, { requests: REQUESTS, showActions: true }),
          ),
        ),
      ),
    )

    writeScreen(
      "vendor-performance",
      "Affiliates: performance",
      page(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Affiliates" }),
          createElement(VendorTabs, { tab: "performance" }),
          createElement(
            "div",
            { className: "mt-4" },
            createElement(PerformanceTable, { rows: PERFORMANCE }),
          ),
        ),
      ),
    )

    writeScreen(
      "vendor-invites",
      "Affiliates: invites",
      page(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Affiliates" }),
          createElement(VendorTabs, { tab: "invites" }),
          createElement(
            "div",
            { className: "mt-4" },
            createElement(InvitesPanel, {
              invites: INVITES,
              products: [{ id: "44444444-4444-4444-8444-444444444401", title: "The Calm Notebook" }],
              initialError: null,
            }),
          ),
        ),
      ),
    )

    writeScreen(
      "join",
      "Join",
      renderToStaticMarkup(
        createElement(JoinOutcome, {
          outcome: { ok: true, productTitle: "The Calm Notebook" },
          affiliateUrl: "https://affiliates.affilova.example.com/",
        }),
      ),
    )

    expect(css().length).toBeGreaterThan(1000)
  })
})
