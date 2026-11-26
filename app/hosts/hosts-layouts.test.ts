import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { SHELL_NAVIGATION, type ShellApp } from "@/components/app-shell/navigation"

// The rendered shape of each shell, with the guards and the session mocked.
//
// A layout is an async server component, so it is awaited and its result is
// rendered to static markup. What is checked is what a page has to get right
// without a browser: one h1, the navigation list, and exactly one item marked
// as the current page.

const guard = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requirePermission: vi.fn(),
}))

const directory = vi.hoisted(() => ({
  getAccountSummary: vi.fn(),
}))

vi.mock("@/lib/identity/guards", () => ({
  requireUser: guard.requireUser,
  requirePermission: guard.requirePermission,
}))

vi.mock("@/lib/commerce/vat-settings", () => ({
  getVatSettings: async () => ({ enabled: true, rateBps: 750, basis: "platform_fee", pricesIncludeVat: false }),
}))

vi.mock("@/lib/identity/account-summary", () => ({
  getAccountSummary: directory.getAccountSummary,
}))

// The path the middleware forwarded. The layout hands it to the guard so that
// signing in returns the visitor to the page they asked for.
const currentApp = vi.hoisted(() => ({ getRequestPath: vi.fn() }))

vi.mock("@/lib/current-app", () => ({ getRequestPath: currentApp.getRequestPath }))

// The second factor has its own suite in lib/identity/mfa.test.ts. Here it is a
// no-op, so these tests keep asking about the shell and the permission guards.
vi.mock("@/lib/identity/mfa", () => ({
  requireStaffAal2: async () => {},
  staffAal2Failure: async () => null,
}))

// The two product screens read their first page on the server. A render test
// must not reach Supabase, so the actions answer with an empty page.
const catalog = vi.hoisted(() => ({
  listVendorProductsAction: vi.fn(),
  listReviewQueueAction: vi.fn(),
}))

vi.mock("@/lib/catalog/actions/vendor", () => ({
  listVendorProductsAction: catalog.listVendorProductsAction,
}))

vi.mock("@/lib/catalog/actions/admin", () => ({
  listReviewQueueAction: catalog.listReviewQueueAction,
}))

// The affiliate and merchant affiliate screens read their first page on the
// server too. These mocks answer with honest empty pages so the render tests
// never reach a database.
const affiliate = vi.hoisted(() => ({
  getMarketplaceAction: vi.fn(),
  getCategoriesAction: vi.fn(),
  getOverviewAction: vi.fn(),
  getDailySeriesAction: vi.fn(),
  getLinkStatsAction: vi.fn(),
  getBreakdownAction: vi.fn(),
  getCommissionsAction: vi.fn(),
  getCommissionHoldDays: vi.fn(),
  getAffiliateRequestsAction: vi.fn(),
  getVendorAffiliateStatsAction: vi.fn(),
  getInvitesAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  getLinkQrAction: vi.fn(),
}))

vi.mock("@/lib/affiliate/read-actions", () => affiliate)

// The payout screens read the signed-in person's own payout data on the server.
// The actions answer with an honest empty state so no render test reaches a database.
const payouts = vi.hoisted(() => ({
  screen: {
    account: null,
    autoPayout: false,
    availableKobo: BigInt(0),
    pendingKobo: BigInt(0),
    totalKobo: BigInt(0),
    today: "2026-11-24",
    nextPayoutDay: "2026-11-25",
    todayIsPayoutDay: true,
    blackoutReason: null,
    settings: {
      minWithdrawalKobo: BigInt(100000),
      feeBps: 100,
      feeMinKobo: BigInt(5000),
      feeCapKobo: BigInt(50000),
      holdDays: 14,
    },
    withdrawals: [],
  },
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => ({ id: "admin-1", email: "ada@example.com" }),
  // The admin pages ask for the roles before they ask for any money.
  getUserRoles: async () => ["admin"],
}))

// The Users screen reads through the admin client, which needs a real
// environment. Here it answers an empty page; lib/admin/users-actions.test.ts
// owns what it does with real input.
vi.mock("@/lib/admin/users-actions", () => ({
  STAFF_ROLES: ["admin", "finance", "support", "moderator"],
  ACCOUNT_STATUSES: ["active", "suspended", "deletion_pending"],
  VERIFICATION_LEVELS: ["basic", "verified", "pro"],
  listUsersAction: async () => ({ ok: true, data: { rows: [], total: 0 } }),
  getUserAction: async () => ({ ok: true, data: null }),
}))

vi.mock("@/lib/admin/finance-actions", () => ({
  getAdminOverviewAction: async () => ({ ok: false, error: "Not part of this test." }),
  getAdminDailySeriesAction: async () => ({ ok: false, error: "Not part of this test." }),
  resolveOverviewRangeAction: async () => ({
    ok: true,
    data: { preset: "last30", from: "2026-11-01", to: "2026-11-30", fromTs: "2026-11-01T00:00:00+01:00", toTs: "2026-11-30T23:59:59+01:00" },
  }),
  listOrdersAction: async () => ({ ok: true, data: { rows: [], nextCursor: null } }),
  listRefundsAction: async () => ({ ok: true, data: { rows: [], nextCursor: null } }),
  listDisputesAction: async () => ({ ok: true, data: { rows: [], nextCursor: null } }),
  listLedgerAction: async () => ({ ok: true, data: { rows: [], nextCursor: null, accounts: [] } }),
  getTrialBalanceAction: async () => ({ ok: false, error: "Not part of this test." }),
  listReconciliationAction: async () => ({ ok: true, data: { rows: [], nextCursor: null } }),
  listVatPeriodsAction: async () => ({ ok: true, data: [] }),
  getVatPeriodAction: async () => ({ ok: false, error: "Not part of this test." }),
  getOrderDetailAction: async () => ({ ok: false, error: "Not part of this test." }),
}))

vi.mock("@/lib/payouts/actions", () => ({
  getPayoutScreenAction: async () => ({ ok: true, data: payouts.screen }),
  listBanksAction: async () => ({ ok: true, data: [{ name: "Test Bank", code: "058" }] }),
  listWithdrawalsAction: async () => ({ ok: true, data: { rows: [], nextCursor: null } }),
  getPayoutSettingsAction: async () => ({ ok: true, data: { values: {}, changes: [] } }),
  listBlackoutDatesAction: async () => ({ ok: true, data: [] }),
  resolveAccountAction: vi.fn(),
  requestStepUpCodeAction: vi.fn(),
  savePayoutAccountAction: vi.fn(),
  setAutoPayoutAction: vi.fn(),
  previewWithdrawalAction: vi.fn(),
  requestWithdrawalAction: vi.fn(),
  cancelWithdrawalAction: vi.fn(),
  approveWithdrawalAction: vi.fn(),
  rejectWithdrawalAction: vi.fn(),
  addBlackoutDateAction: vi.fn(),
  removeBlackoutDateAction: vi.fn(),
  updatePayoutSettingAction: vi.fn(),
}))

// The account and merchant screens read their first page on the server too.
const account = vi.hoisted(() => ({
  getMyOrdersAction: vi.fn(),
  getMyOrderAction: vi.fn(),
  downloadMyFileAction: vi.fn(),
  requestMyRefundAction: vi.fn(),
}))

vi.mock("@/lib/account/actions", () => account)

const merchant = vi.hoisted(() => ({
  getVendorOverviewAction: vi.fn(),
  getVendorDailySeriesAction: vi.fn(),
  getVendorTopProductsAction: vi.fn(),
  getVendorSalesAction: vi.fn(),
  getVendorRefundRequestsAction: vi.fn(),
}))

vi.mock("@/lib/merchant/actions", () => merchant)

vi.mock("@/app/auth/actions", () => ({
  signOutAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  usePathname: vi.fn(() => "/"),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() })),
}))

import { usePathname } from "next/navigation"

import AccountLayout from "@/app/hosts/account/layout"
import AccountPage from "@/app/hosts/account/page"
import AccountProfilePage from "@/app/hosts/account/profile/page"
import AccountReceiptsPage from "@/app/hosts/account/receipts/page"
import AccountSupportPage from "@/app/hosts/account/support/page"
import AdminBlogPage from "@/app/hosts/admin/blog/page"
import AdminLayout from "@/app/hosts/admin/layout"
import AdminPage from "@/app/hosts/admin/page"
import AdminProductsPage from "@/app/hosts/admin/products/page"
import AdminSettingsPage from "@/app/hosts/admin/settings/page"
import AdminSupportPage from "@/app/hosts/admin/support/page"
import AdminTransactionsPage from "@/app/hosts/admin/transactions/page"
import AdminUsersPage from "@/app/hosts/admin/users/page"
import AdminVatPage from "@/app/hosts/admin/vat/page"
import AdminWithdrawalsPage from "@/app/hosts/admin/withdrawals/page"
import AffiliateAnalyticsPage from "@/app/hosts/affiliate/analytics/page"
import AffiliateEarningsPage from "@/app/hosts/affiliate/earnings/page"
import AffiliateLayout from "@/app/hosts/affiliate/layout"
import AffiliateMarketplacePage from "@/app/hosts/affiliate/marketplace/page"
import AffiliateMyLinksPage from "@/app/hosts/affiliate/my-links/page"
import AffiliatePage from "@/app/hosts/affiliate/page"
import AffiliatePayoutDetailsPage from "@/app/hosts/affiliate/payout-details/page"
import AffiliateResourcesPage from "@/app/hosts/affiliate/resources/page"
import AffiliateSettingsPage from "@/app/hosts/affiliate/settings/page"
import AffiliateWithdrawalsPage from "@/app/hosts/affiliate/withdrawals/page"
import MerchantAffiliatesPage from "@/app/hosts/merchant/affiliates/page"
import MerchantAnalyticsPage from "@/app/hosts/merchant/analytics/page"
import MerchantLayout from "@/app/hosts/merchant/layout"
import MerchantPage from "@/app/hosts/merchant/page"
import MerchantPayoutDetailsPage from "@/app/hosts/merchant/payout-details/page"
import MerchantProductsPage from "@/app/hosts/merchant/products/page"
import MerchantResourcesPage from "@/app/hosts/merchant/resources/page"
import MerchantSalesPage from "@/app/hosts/merchant/sales/page"
import MerchantSettingsPage from "@/app/hosts/merchant/settings/page"
import MerchantStorePage from "@/app/hosts/merchant/store/page"

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

type RenderedPage = (props: PageProps) => ReactElement | Promise<ReactElement>

const PAGES: Record<ShellApp, Record<string, RenderedPage>> = {
  merchant: {
    "/": MerchantPage,
    "/products": MerchantProductsPage,
    "/sales": MerchantSalesPage,
    "/affiliates": MerchantAffiliatesPage,
    "/analytics": MerchantAnalyticsPage,
    "/store": MerchantStorePage,
    "/resources": MerchantResourcesPage,
    "/payout-details": MerchantPayoutDetailsPage,
    "/settings": MerchantSettingsPage,
  },
  affiliate: {
    "/": AffiliatePage,
    "/marketplace": AffiliateMarketplacePage,
    "/my-links": AffiliateMyLinksPage,
    "/earnings": AffiliateEarningsPage,
    "/analytics": AffiliateAnalyticsPage,
    "/withdrawals": AffiliateWithdrawalsPage,
    "/resources": AffiliateResourcesPage,
    "/payout-details": AffiliatePayoutDetailsPage,
    "/settings": AffiliateSettingsPage,
  },
  account: {
    "/": AccountPage,
    "/receipts": AccountReceiptsPage,
    "/support": AccountSupportPage,
    "/profile": AccountProfilePage,
  },
  admin: {
    "/": AdminPage,
    "/users": AdminUsersPage,
    "/products": AdminProductsPage,
    "/withdrawals": AdminWithdrawalsPage,
    "/transactions": AdminTransactionsPage,
    "/vat": AdminVatPage,
    "/support": AdminSupportPage,
    "/blog": AdminBlogPage,
    "/settings": AdminSettingsPage,
  },
}

const LAYOUTS: Record<ShellApp, (props: { children: React.ReactNode }) => Promise<ReactElement>> = {
  merchant: MerchantLayout,
  affiliate: AffiliateLayout,
  account: AccountLayout,
  admin: AdminLayout,
}

const EXPECTED_LABELS: Record<ShellApp, readonly string[]> = {
  merchant: [
    "Overview",
    "Products",
    "Sales",
    "Affiliates",
    "Analytics",
    "Store",
    "Resources",
    "Payout details",
    "Settings",
  ],
  affiliate: [
    "Overview",
    "Marketplace",
    "My links",
    "Earnings",
    "Analytics",
    "Withdrawals",
    "Resources",
    "Payout details",
    "Settings",
  ],
  account: ["Purchases", "Receipts", "Support", "Profile"],
  admin: [
    "Overview",
    "Finance",
    "Users",
    "Products",
    "Withdrawals",
    "Transactions",
    "VAT",
    "Support",
    "Security",
    "Blog",
    "Settings",
  ],
}

const ENV: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affilova-dashboard.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "affilova-merchant.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "affilova-account.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "affilova-admin.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
}

function countOf(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0
}

/** The labels of the shell's own navigation, in order. */
function navLabels(html: string, label: string): string[] {
  const nav = html.match(
    new RegExp(`<nav aria-label="${label} sections"><ul[^>]*>(.*?)</ul></nav>`),
  )

  expect(nav, `navigation for ${label}`).not.toBeNull()

  return [...(nav?.[1] ?? "").matchAll(/<li><a[^>]*>([^<]*)<\/a><\/li>/g)].map((match) => match[1] ?? "")
}

function activeLabels(html: string): string[] {
  // Only the shell's own navigation. A page can mark its own current tab the
  // same way (the products screen does), and that is a different list.
  const navs = [
    ...html.matchAll(/<nav aria-label="[^"]* sections"><ul[^>]*>([\s\S]*?)<\/ul><\/nav>/g),
  ]

  return navs.flatMap((nav) =>
    [...(nav[1] ?? "").matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(
      (match) => match[1] ?? "",
    ),
  )
}

const EMPTY_PARAMS: PageProps = { searchParams: Promise.resolve({}) }

async function renderPage(page: RenderedPage): Promise<string> {
  return renderToStaticMarkup(await page(EMPTY_PARAMS))
}

async function renderThroughLayout(app: ShellApp, page: RenderedPage): Promise<string> {
  const layout = LAYOUTS[app]
  const tree = await layout({ children: await page(EMPTY_PARAMS) })

  return renderToStaticMarkup(tree)
}

beforeEach(() => {
  vi.clearAllMocks()

  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value
  }

  const user = { id: "user-1", email: "person@example.com" }

  guard.requireUser.mockResolvedValue({ user, roles: ["customer", "vendor"] })
  guard.requirePermission.mockResolvedValue({ user, roles: ["customer", "vendor"] })
  directory.getAccountSummary.mockResolvedValue({
    userId: "user-1",
    displayName: "Ada Lovelace",
    email: "person@example.com",
    roles: [
      { role: "customer", status: "active" },
      { role: "affiliate", status: "revoked" },
    ],
  })

  vi.mocked(usePathname).mockReturnValue("/")

  currentApp.getRequestPath.mockResolvedValue("/products?status=draft")
  catalog.listVendorProductsAction.mockResolvedValue({ ok: true, items: [], nextCursor: null })
  catalog.listReviewQueueAction.mockResolvedValue({ ok: true, items: [], nextCursor: null })

  affiliate.getMarketplaceAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  affiliate.getCategoriesAction.mockResolvedValue({ ok: true, data: [] })
  affiliate.getOverviewAction.mockResolvedValue({
    ok: true,
    data: {
      clicks: 0,
      uniqueClicks: 0,
      orders: 0,
      revenueKobo: 0,
      commissionKobo: 0,
      conversionBps: 0,
      epcKoboPer100Clicks: 0,
      balance: { pendingKobo: 0, availableKobo: 0, totalKobo: 0, negative: false },
    },
  })
  affiliate.getDailySeriesAction.mockResolvedValue({ ok: true, data: [] })
  affiliate.getLinkStatsAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  affiliate.getBreakdownAction.mockResolvedValue({
    ok: true,
    data: { dimension: "product", rows: [] },
  })
  affiliate.getCommissionsAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  affiliate.getCommissionHoldDays.mockResolvedValue(7)
  affiliate.getAffiliateRequestsAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  affiliate.getVendorAffiliateStatsAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  affiliate.getInvitesAction.mockResolvedValue({ ok: true, data: [] })

  account.getMyOrdersAction.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } })
  account.getMyOrderAction.mockResolvedValue({ ok: false, error: "That order could not be found." })

  merchant.getVendorOverviewAction.mockResolvedValue({
    ok: true,
    data: {
      orders: 0,
      grossKobo: 0,
      vendorNetKobo: 0,
      platformFeeKobo: 0,
      affiliateCommissionKobo: 0,
      affiliateOrders: 0,
      refundsCount: 0,
      refundsKobo: 0,
      refundRateBps: 0,
      pendingKobo: 0,
      availableKobo: 0,
    },
  })
  merchant.getVendorDailySeriesAction.mockResolvedValue({ ok: true, data: [] })
  merchant.getVendorTopProductsAction.mockResolvedValue({ ok: true, data: [] })
  merchant.getVendorSalesAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
  merchant.getVendorRefundRequestsAction.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null },
  })
})

describe("every page renders exactly one h1", () => {
  for (const app of Object.keys(PAGES) as ShellApp[]) {
    it(`${app}`, async () => {
      for (const [path, page] of Object.entries(PAGES[app])) {
        const html = await renderPage(page)

        expect(countOf(html, /<h1/g), `${app} ${path}`).toBe(1)
      }
    })
  }

  it("does not render an h1 from the shell itself", async () => {
    const html = await renderThroughLayout("merchant", MerchantProductsPage)

    expect(countOf(html, /<h1/g)).toBe(1)
  })
})

describe("the shell navigation lists each app's sections in order", () => {
  for (const app of Object.keys(SHELL_NAVIGATION) as ShellApp[]) {
    it(`${app}`, async () => {
      const html = await renderThroughLayout(app, PAGES[app]["/"] ?? MerchantPage)
      const nav = SHELL_NAVIGATION[app]

      expect(navLabels(html, nav.label)).toEqual([...EXPECTED_LABELS[app]])
    })
  }

  it("marks the section the request is for", async () => {
    vi.mocked(usePathname).mockReturnValue("/hosts/merchant/products")

    const html = await renderThroughLayout("merchant", MerchantProductsPage)

    expect(activeLabels(html)).toEqual(["Products"])
  })

  it("marks the same section from the visible path after hydration", async () => {
    vi.mocked(usePathname).mockReturnValue("/products")

    const html = await renderThroughLayout("merchant", MerchantProductsPage)

    expect(activeLabels(html)).toEqual(["Products"])
  })

  it("marks the overview at the shell root", async () => {
    vi.mocked(usePathname).mockReturnValue("/hosts/admin")

    const html = await renderThroughLayout("admin", AdminPage)

    expect(activeLabels(html)).toEqual(["Overview"])
  })

  it("marks a nested section of another app", async () => {
    vi.mocked(usePathname).mockReturnValue("/hosts/affiliate/payout-details")

    const html = await renderThroughLayout("affiliate", AffiliatePayoutDetailsPage)

    expect(activeLabels(html)).toEqual(["Payout details"])
  })
})

describe("the shell frame", () => {
  it("offers a skip link to the main content", async () => {
    const html = await renderThroughLayout("merchant", MerchantProductsPage)

    expect(html).toContain('href="#main-content"')
    expect(html).toContain('id="main-content"')
    expect(html).toContain("Skip to content")
  })

  it("shows the account's name, email and roles in the menu trigger region", async () => {
    const html = await renderThroughLayout("merchant", MerchantProductsPage)

    expect(html).toContain("Ada Lovelace")
  })

  it("renders an honest empty state for an unbuilt section", async () => {
    const html = await renderPage(MerchantStorePage)

    expect(html).toContain("This section is not available yet.")
  })

  it("renders the products screen rather than a placeholder", async () => {
    const html = await renderPage(MerchantProductsPage)

    expect(html).toContain("You have not created a product yet.")
    expect(html).not.toContain("This section is not available yet.")
  })

  it("shows the greeting, email and roles on the first page", async () => {
    const html = await renderPage(AdminPage)

    expect(html).toContain("Welcome, Ada Lovelace")
    expect(html).toContain("person@example.com")
    expect(html).toContain("customer")
    expect(html).toContain("affiliate")
    expect(html).toContain("revoked")
  })

  it("greets without inventing a name when the profile has none", async () => {
    directory.getAccountSummary.mockResolvedValue({
      userId: "user-1",
      displayName: null,
      email: "person@example.com",
      roles: [],
    })

    const html = await renderPage(AdminPage)

    expect(html).toContain("Welcome")
    expect(html).not.toContain("Welcome,")
    expect(html).toContain("None")
  })
})

describe("the layout guards", () => {
  it("asks for the right permission in each app", async () => {
    await MerchantLayout({ children: null })
    await AffiliateLayout({ children: null })
    await AccountLayout({ children: null })
    await AdminLayout({ children: null })

    // The forwarded path, not "/": a signed-out visitor is returned to the page
    // they asked for after signing in.
    expect(guard.requirePermission).toHaveBeenCalledWith("area:merchant", "/products?status=draft", "start")
    expect(guard.requirePermission).toHaveBeenCalledWith("area:affiliate", "/products?status=draft", "start")
    expect(guard.requirePermission).toHaveBeenCalledWith("area:admin", "/products?status=draft", "not-found")
    expect(guard.requireUser).toHaveBeenCalledWith("/products?status=draft")
  })

  it("renders the shell only after the guard answers", async () => {
    // Whatever the guard does (it redirects or calls notFound by throwing), the
    // layout must not render the shell if it throws.
    guard.requirePermission.mockRejectedValue(new Error("guard stopped the request"))

    await expect(MerchantLayout({ children: createElement("div") })).rejects.toThrow(
      "guard stopped the request",
    )
  })
})
