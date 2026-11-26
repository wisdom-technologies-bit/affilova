import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/start/actions", () => ({
  becomeVendorAction: vi.fn(),
  becomeAffiliateAction: vi.fn(),
}))

vi.mock("@/lib/identity/app-urls", () => ({
  appUrl: (_app: string, path: string) => `https://affilova.com${path}`,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: () => Promise.resolve({ id: "user-1", email: "ada@example.com" }),
  getUserRoles: () => Promise.resolve([]),
}))

import VendorPage from "@/app/start/vendor/page"
import AffiliatePage from "@/app/start/affiliate/page"
import { RoleChooser } from "@/app/start/page"
import { AffiliateDonePanel, AffiliateForm } from "@/app/start/_components/affiliate-form"
import { VendorDonePanel, VendorForm } from "@/app/start/_components/vendor-form"

// The role chooser and the two onboarding forms.

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const VENDOR_PROPS = {
  storeUrlPrefix: "https://affilova.com/store/",
  nextHref: "https://merchant.affilova.com/products/new",
}

describe("the role chooser", () => {
  it("offers both roles with a state chip, and says you can do both", () => {
    const html = render(createElement(RoleChooser, { roles: [] }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Sell your own products")
    expect(html).toContain("Promote other people&#x27;s products")
    expect(html.match(/Not set up/g) ?? []).toHaveLength(2)
    expect(html).toContain("You can do both")
  })

  it("marks the role the account already holds and drops its button", () => {
    const html = render(createElement(RoleChooser, { roles: ["vendor"] }))

    expect(html.match(/Active/g) ?? []).toHaveLength(1)
    expect(html.match(/Not set up/g) ?? []).toHaveLength(1)
    expect(html.match(/href="\/start\/vendor"/g) ?? []).toHaveLength(0)
    expect(html).toContain('href="/start/affiliate"')
  })

  it("draws its facts from the site config rather than typed-in numbers", () => {
    const html = render(createElement(RoleChooser, { roles: [] }))

    expect(html).toContain("Affilova keeps 10% of each sale.")
    expect(html).toContain("Payouts are sent Monday to Friday.")
    expect(html).toContain("Commission is confirmed 7 days after the order.")
  })
})

describe("the vendor form", () => {
  it("is sectioned, with a live preview of the public store address", () => {
    const html = render(createElement(VendorForm, VENDOR_PROPS))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Business details")
    expect(html).toContain("Store address")
    expect(html).toContain("Contact")
    expect(html).toContain("https://affilova.com/store/your-store")
    expect(html).toContain('aria-live="polite"')
  })

  it("keeps the store address field separate from the domain", () => {
    const html = render(createElement(VendorForm, VENDOR_PROPS))

    expect(html).toContain('for="vendor-slug"')
    expect(html).toContain("Lowercase letters, numbers and hyphens")
  })

  it("names the next step and links to it after success", () => {
    const html = render(
      createElement(VendorDonePanel, {
        storeUrl: "https://affilova.com/store/calm-notebook",
        nextHref: VENDOR_PROPS.nextHref,
      }),
    )

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Add your first product")
    expect(html).toContain(VENDOR_PROPS.nextHref)
  })

  it("renders the page with its own h1", async () => {
    const html = render(await VendorPage())

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Business details")
  })
})

describe("the affiliate form", () => {
  it("is sectioned and explains the username rule before it is broken", () => {
    const html = render(createElement(AffiliateForm, { nextHref: "https://affiliate.affilova.com/marketplace" }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Profile")
    expect(html).toContain("Where you promote")
    expect(html).toContain('for="affiliate-username"')
    expect(html).toContain("Lowercase letters, numbers and underscores.")
  })

  it("groups the promotion channels as one labelled set", () => {
    const html = render(createElement(AffiliateForm, { nextHref: "https://affiliate.affilova.com/marketplace" }))

    expect(html).toContain("<fieldset")
    expect(html).toContain("<legend")
    expect(html.match(/type="checkbox"/g)?.length ?? 0).toBeGreaterThan(4)
  })

  it("names the next step and links to it after success", () => {
    const html = render(
      createElement(AffiliateDonePanel, {
        username: "ada",
        nextHref: "https://affiliate.affilova.com/marketplace",
      }),
    )

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Browse the marketplace")
    expect(html).toContain("https://affiliate.affilova.com/marketplace")
  })

  it("renders the page with its own h1", async () => {
    const html = render(await AffiliatePage())

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Where you promote")
  })
})
