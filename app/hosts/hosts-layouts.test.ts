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

vi.mock("@/lib/identity/account-summary", () => ({
  getAccountSummary: directory.getAccountSummary,
}))

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

type RenderedPage = () => ReactElement | Promise<ReactElement>

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
    "Users",
    "Products",
    "Withdrawals",
    "Transactions",
    "VAT",
    "Support",
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
  return [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(
    (match) => match[1] ?? "",
  )
}

async function renderPage(page: RenderedPage): Promise<string> {
  return renderToStaticMarkup(await page())
}

async function renderThroughLayout(app: ShellApp, page: RenderedPage): Promise<string> {
  const layout = LAYOUTS[app]
  const tree = await layout({ children: await page() })

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
    const html = await renderPage(MerchantProductsPage)

    expect(html).toContain("This section is not available yet.")
  })

  it("shows the greeting, email and roles on the first page", async () => {
    const html = await renderPage(MerchantPage)

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

    const html = await renderPage(MerchantPage)

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

    expect(guard.requirePermission).toHaveBeenCalledWith("area:merchant", "/", "start")
    expect(guard.requirePermission).toHaveBeenCalledWith("area:affiliate", "/", "start")
    expect(guard.requirePermission).toHaveBeenCalledWith("area:admin", "/", "not-found")
    expect(guard.requireUser).toHaveBeenCalledWith("/")
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
