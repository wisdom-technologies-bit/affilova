import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, vi } from "vitest"

// The account and merchant review pages.
//
// Each screen is rendered through the real components with fixed mock props and
// written as a plain HTML file; a browser then screenshots it at the two review
// sizes. No database, no session, no server action: what is being looked at is the
// layout, the words, and the states a person sees.
//
// It is skipped in the ordinary suite (SCREENS=1 turns it on) because it writes
// files; the screenshots themselves are committed under docs/design-review.

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

vi.mock("@/lib/merchant/actions", () => ({
  getVendorOverviewAction: vi.fn(),
  getVendorDailySeriesAction: vi.fn(),
  getVendorTopProductsAction: vi.fn(),
  getVendorSalesAction: vi.fn(),
  getVendorRefundRequestsAction: vi.fn(),
}))

vi.mock("@/lib/commerce/actions", () => ({ decideRefundAction: vi.fn(async () => ({ ok: true })) }))

import { AppShell } from "@/components/app-shell/app-shell"
import { PageHeader } from "@/components/app-shell/page-header"
import { ProfilePanel } from "@/components/account/profile-panel"
import { PurchaseDetail } from "@/components/account/purchase-detail"
import { PurchasesScreen } from "@/components/account/purchases-screen"
import { Receipt } from "@/components/account/receipt"
import { MerchantOverviewPanel } from "@/components/merchant/overview-panel"
import { RefundRequestsPanel } from "@/components/merchant/refund-requests"
import { SalesTabs } from "@/components/merchant/sales-tabs"
import { SalesView } from "@/components/merchant/sales-view"
import type { OrderDetail, OrderSummary } from "@/lib/account/types"
import { resolveRange } from "@/lib/dates/lagos"
import type {
  VendorDailyPoint,
  VendorOverview,
  VendorRefundRow,
  VendorSaleRow,
  VendorTopProduct,
} from "@/lib/merchant/types"

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

const OUTPUT = join(process.cwd(), "docs/design-review/accounts/html")
const CSS_DIR = join(process.cwd(), ".next/static/chunks")

const NOW = new Date("2026-11-22T10:00:00.000Z")
const range = resolveRange({ preset: "last7" }, NOW).range

const BUYER = {
  userId: "user-1",
  displayName: "Ada Okonkwo",
  email: "ada@example.com",
  roles: [{ role: "customer" as const, status: "active" as const }],
}

const VENDOR = {
  userId: "user-2",
  displayName: "Ada Okonkwo",
  email: "ada@example.com",
  roles: [
    { role: "vendor" as const, status: "active" as const },
    { role: "customer" as const, status: "active" as const },
  ],
}

const ORDERS: OrderSummary[] = [
  {
    orderId: "11111111-1111-4111-8111-111111111101",
    number: "AFV-2026-000031",
    status: "paid",
    totalKobo: 500000,
    paidAt: "2026-11-21T09:12:00.000Z",
    createdAt: "2026-11-21T09:02:00.000Z",
    productTitle: "The Calm Notebook",
    productSlug: "the-calm-notebook",
    vendorName: "Kite Studio",
    coverPublicId: null,
  },
  {
    orderId: "11111111-1111-4111-8111-111111111102",
    number: "AFV-2026-000028",
    status: "paid",
    totalKobo: 1250000,
    paidAt: "2026-11-18T16:40:00.000Z",
    createdAt: "2026-11-18T16:31:00.000Z",
    productTitle: "The Focus Planner",
    productSlug: "the-focus-planner",
    vendorName: "Kite Studio",
    coverPublicId: null,
  },
  {
    orderId: "11111111-1111-4111-8111-111111111103",
    number: "AFV-2026-000024",
    status: "refunded",
    totalKobo: 300000,
    paidAt: "2026-11-15T11:05:00.000Z",
    createdAt: "2026-11-15T10:58:00.000Z",
    productTitle: "The Weekend Reader",
    productSlug: "the-weekend-reader",
    vendorName: "Kite Studio",
    coverPublicId: null,
  },
  {
    orderId: "11111111-1111-4111-8111-111111111104",
    number: "AFV-2026-000019",
    status: "pending",
    totalKobo: 750000,
    paidAt: null,
    createdAt: "2026-11-12T08:20:00.000Z",
    productTitle: "The Focus Planner",
    productSlug: "the-focus-planner",
    vendorName: "Kite Studio",
    coverPublicId: null,
  },
]

const DETAIL: OrderDetail = {
  orderId: ORDERS[0].orderId,
  number: ORDERS[0].number,
  status: "paid",
  currency: "NGN",
  subtotalKobo: 500000,
  taxKobo: 3750,
  taxIncluded: true,
  totalKobo: 500000,
  channel: "card",
  paidAt: ORDERS[0].paidAt,
  createdAt: ORDERS[0].createdAt,
  refundWindowEndsAt: "2026-11-22T09:12:00.000Z",
  items: [
    {
      orderItemId: "22222222-2222-4222-8222-222222222201",
      productId: "33333333-3333-4333-8333-333333333301",
      title: "The Calm Notebook",
      unitPriceKobo: 500000,
      vendorName: "Kite Studio",
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
      entitlementId: "44444444-4444-4444-8444-444444444401",
      fileDisplayName: "the-calm-notebook.pdf",
      sizeBytes: 2_411_724,
      downloadsUsed: 1,
      maxDownloads: 3,
      revoked: false,
      scanClean: true,
    },
    {
      entitlementId: "44444444-4444-4444-8444-444444444402",
      fileDisplayName: "printable-templates.zip",
      sizeBytes: 8_388_608,
      downloadsUsed: 0,
      maxDownloads: 3,
      revoked: false,
      scanClean: false,
    },
  ],
}

const OVERVIEW: VendorOverview = {
  orders: 34,
  grossKobo: 18_450_000,
  vendorNetKobo: 15_982_500,
  platformFeeKobo: 1_845_000,
  affiliateCommissionKobo: 622_500,
  affiliateOrders: 9,
  refundsCount: 2,
  refundsKobo: 1_100_000,
  refundRateBps: 596,
  pendingKobo: 3_240_000,
  availableKobo: 12_742_500,
}

const SERIES: VendorDailyPoint[] = [
  { day: "2026-11-16", orders: 3, grossKobo: 1_450_000, vendorNetKobo: 1_256_250 },
  { day: "2026-11-17", orders: 5, grossKobo: 2_900_000, vendorNetKobo: 2_512_500 },
  { day: "2026-11-18", orders: 4, grossKobo: 1_850_000, vendorNetKobo: 1_602_500 },
  { day: "2026-11-19", orders: 6, grossKobo: 3_400_000, vendorNetKobo: 2_945_000 },
  { day: "2026-11-20", orders: 2, grossKobo: 900_000, vendorNetKobo: 779_500 },
  { day: "2026-11-21", orders: 7, grossKobo: 4_250_000, vendorNetKobo: 3_681_250 },
  { day: "2026-11-22", orders: 1, grossKobo: 500_000, vendorNetKobo: 433_000 },
]

const PRODUCTS: VendorTopProduct[] = [
  { productId: "33333333-3333-4333-8333-333333333301", title: "The Calm Notebook", orders: 14, grossKobo: 7_000_000, refunds: 1 },
  { productId: "33333333-3333-4333-8333-333333333302", title: "The Focus Planner", orders: 11, grossKobo: 6_050_000, refunds: 1 },
  { productId: "33333333-3333-4333-8333-333333333303", title: "The Weekend Reader", orders: 9, grossKobo: 5_400_000, refunds: 0 },
]

const SALES: VendorSaleRow[] = [
  {
    orderNumber: "AFV-2026-000031",
    productTitle: "The Calm Notebook",
    status: "paid",
    paidAt: "2026-11-21T09:12:00.000Z",
    grossKobo: 500000,
    vendorNetKobo: 433000,
    viaAffiliate: false,
  },
  {
    orderNumber: "AFV-2026-000030",
    productTitle: "The Focus Planner",
    status: "paid",
    paidAt: "2026-11-21T07:44:00.000Z",
    grossKobo: 1250000,
    vendorNetKobo: 1_085_000,
    viaAffiliate: true,
  },
  {
    orderNumber: "AFV-2026-000029",
    productTitle: "The Weekend Reader",
    status: "paid",
    paidAt: "2026-11-20T19:02:00.000Z",
    grossKobo: 300000,
    vendorNetKobo: 259_500,
    viaAffiliate: true,
  },
  {
    orderNumber: "AFV-2026-000027",
    productTitle: "The Calm Notebook",
    status: "refunded",
    paidAt: "2026-11-18T12:31:00.000Z",
    grossKobo: 500000,
    vendorNetKobo: 433000,
    viaAffiliate: false,
  },
  {
    orderNumber: "AFV-2026-000026",
    productTitle: "The Focus Planner",
    status: "pending",
    paidAt: null,
    grossKobo: 1250000,
    vendorNetKobo: 1_085_000,
    viaAffiliate: false,
  },
]

const REQUESTS: VendorRefundRow[] = [
  {
    requestId: "55555555-5555-4555-8555-555555555501",
    orderNumber: "AFV-2026-000031",
    productTitle: "The Calm Notebook",
    reason: "The printable templates will not open on my laptop at all.",
    status: "requested",
    autoApproved: false,
    requestedAt: "2026-11-22T08:15:00.000Z",
    decidedAt: null,
    amountKobo: 500000,
  },
  {
    requestId: "55555555-5555-4555-8555-555555555502",
    orderNumber: "AFV-2026-000027",
    productTitle: "The Calm Notebook",
    reason: "I bought this by mistake, please refund it.",
    status: "processed",
    autoApproved: true,
    requestedAt: "2026-11-18T13:02:00.000Z",
    decidedAt: "2026-11-18T13:02:00.000Z",
    amountKobo: 500000,
  },
]

function shell(app: "account" | "merchant", children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      app,
      roles: app === "account" ? ["customer"] : ["vendor"],
      user: app === "account" ? BUYER : VENDOR,
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
  writeFileSync(join(OUTPUT, `${name}.html`), document(title, body).replaceAll('src="/brand/', 'src="./brand/'))
}

function css(): string {
  // Every stylesheet the build produced, so the review pages look like the app.
  return readdirSync(CSS_DIR)
    .filter((file) => file.endsWith(".css"))
    .map((file) => {
      try {
        return readFileSync(join(CSS_DIR, file), "utf8")
      } catch {
        return ""
      }
    })
    .join("\n")
}

describe.skipIf(process.env.SCREENS !== "1")("the account and merchant screens", () => {
  it("writes one html file per screen", () => {
    mkdirSync(OUTPUT, { recursive: true })
    writeFileSync(join(OUTPUT, "app.css"), css())

    writeScreen(
      "purchases",
      "Purchases",
      shell(
        "account",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Purchases" }),
          createElement(
            "p",
            { className: "mb-4 max-w-2xl text-sm text-muted-foreground" },
            "Every product you have bought, with its files and its receipt. A refund can be requested from the purchase while its refund window is open.",
          ),
          createElement(PurchasesScreen, {
            initialPage: { items: ORDERS, nextCursor: "next-page" },
          }),
        ),
      ),
    )

    writeScreen(
      "purchase-detail",
      "Purchase",
      shell(
        "account",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Purchase" }),
          createElement(PurchaseDetail, { detail: DETAIL, now: "2026-11-22T08:00:00.000Z" }),
        ),
      ),
    )

    writeScreen(
      "receipt",
      "Receipt",
      shell(
        "account",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Receipt" }),
          createElement(Receipt, { detail: DETAIL }),
        ),
      ),
    )

    writeScreen(
      "profile",
      "Profile",
      shell(
        "account",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Profile" }),
          createElement(ProfilePanel, { displayName: BUYER.displayName, email: BUYER.email }),
        ),
      ),
    )

    writeScreen(
      "merchant-overview",
      "Overview",
      shell(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Overview" }),
          createElement(MerchantOverviewPanel, {
            range,
            today: "2026-11-22",
            overview: OVERVIEW,
            series: SERIES,
            topProducts: PRODUCTS,
          }),
        ),
      ),
    )

    writeScreen(
      "merchant-sales",
      "Sales",
      shell(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Sales" }),
          createElement(SalesTabs, { tab: "paid" }),
          createElement(
            "p",
            { className: "mb-4 mt-4 max-w-2xl text-sm text-muted-foreground" },
            "Every order that included one of your products, newest first. Gross is what the buyer paid; your earnings are what is left after the platform fee, the affiliate commission and VAT.",
          ),
          createElement(SalesView, {
            initialPage: { items: SALES, nextCursor: "next-page" },
            status: "paid",
          }),
        ),
      ),
    )

    writeScreen(
      "merchant-refund-requests",
      "Sales · Refund requests",
      shell(
        "merchant",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Sales" }),
          createElement(SalesTabs, { tab: "refunds" }),
          createElement(
            "p",
            { className: "mb-4 mt-4 max-w-2xl text-sm text-muted-foreground" },
            "Buyers who asked for their money back on one of your orders. Approving a request refunds the buyer and withdraws the files; rejecting it needs a reason they will read.",
          ),
          createElement(RefundRequestsPanel, {
            initialPage: { items: REQUESTS, nextCursor: null },
          }),
        ),
      ),
    )
  })
})
