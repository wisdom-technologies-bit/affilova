import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement, type ElementType, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// The design system review pages.
//
// Renders the style guide, the two auth screens and the merchant product list
// through the real components with fixed props, and writes plain HTML. A browser
// then screenshots those files at the two review sizes. No database, no session,
// no server action.
//
// The stylesheet is the one the build emitted, with the self-hosted Inter files
// inlined, so the pages render with no request to anything.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

vi.mock("@/app/auth/actions", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  requestPasswordResetAction: vi.fn(),
  resetPasswordAction: vi.fn(),
}))

vi.mock("@/lib/catalog/actions/vendor", () => ({
  listVendorProductsAction: vi.fn(),
  createProductDraftAction: vi.fn(),
  updateProductAction: vi.fn(),
  transitionProductAction: vi.fn(),
  getProductForEditAction: vi.fn(),
}))

vi.mock("@/lib/affiliate/read-actions", () => ({
  getLinkQrAction: vi.fn(),
}))

import { AppShell } from "@/components/app-shell/app-shell"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignInForm } from "@/components/auth/sign-in-form"
import { SignUpForm } from "@/components/auth/sign-up-form"
import { ProductList } from "@/components/catalog/product-list"
import { DesignSystemGuide } from "@/components/design-guide/guide"
import { PageHeader } from "@/components/ds/page-header"
import type { ProductSummary } from "@/lib/catalog/action-types"
import type { AccountSummary } from "@/lib/identity/account-summary"

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

// The review trees are built by hand; the factory is used with each component's
// props object rather than TypeScript's overloads.
const h = createElement as unknown as (
  type: ElementType,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactElement

const OUTPUT = join(process.cwd(), "docs/design-review/system/html")
const CSS_DIR = join(process.cwd(), ".next/static/chunks")
const MEDIA_DIR = join(process.cwd(), ".next/static/media")

const STAFF: AccountSummary = {
  userId: "11111111-1111-4111-8111-111111111101",
  displayName: "Ifeoma Adeyemi",
  email: "staff@affilova.example.com",
  roles: [{ role: "staff", status: "active" }],
}

const VENDOR: AccountSummary = {
  userId: "22222222-2222-4222-8222-222222222201",
  displayName: "Ada Okonkwo",
  email: "ada@calmnotebook.example.com",
  roles: [{ role: "vendor", status: "active" }],
}

const PRODUCTS: readonly ProductSummary[] = [
  {
    id: "33333333-3333-4333-8333-333333333301",
    title: "The Calm Notebook",
    slug: "the-calm-notebook",
    shortDescription: "A 120-page notebook for planning a month without a screen.",
    priceKobo: 450_000,
    currency: "NGN",
    status: "live",
    submittedAt: "2026-10-02T09:00:00.000Z",
    publishedAt: "2026-10-03T11:20:00.000Z",
    createdAt: "2026-09-28T08:10:00.000Z",
    updatedAt: "2026-11-18T14:05:00.000Z",
    rejectReason: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333302",
    title: "Invoice templates for freelancers",
    slug: "invoice-templates",
    shortDescription: "Twelve invoice and receipt templates in one archive.",
    priceKobo: 250_000,
    currency: "NGN",
    status: "live",
    submittedAt: "2026-09-11T09:00:00.000Z",
    publishedAt: "2026-09-12T10:00:00.000Z",
    createdAt: "2026-09-08T09:00:00.000Z",
    updatedAt: "2026-11-12T08:30:00.000Z",
    rejectReason: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333303",
    title: "Budget planner, spreadsheet edition",
    slug: "budget-planner",
    shortDescription: "A spreadsheet that tracks income, expenses and savings.",
    priceKobo: 180_000,
    currency: "NGN",
    status: "draft",
    submittedAt: null,
    publishedAt: null,
    createdAt: "2026-11-16T12:00:00.000Z",
    updatedAt: "2026-11-22T17:45:00.000Z",
    rejectReason: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333304",
    title: "Client onboarding pack",
    slug: "client-onboarding-pack",
    shortDescription: "A welcome email, a brief and a checklist.",
    priceKobo: 320_000,
    currency: "NGN",
    status: "submitted",
    submittedAt: "2026-11-23T10:15:00.000Z",
    publishedAt: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-23T10:15:00.000Z",
    rejectReason: null,
  },
]

/** Every stylesheet the build emitted, with the self-hosted fonts inlined. */
function css(): string {
  let names: string[] = []

  try {
    names = readdirSync(CSS_DIR).filter((name) => name.endsWith(".css"))
  } catch {
    return ""
  }

  const joined = names.map((name) => readFileSync(join(CSS_DIR, name), "utf8")).join("\n")

  // The build points at /_next/static/media/..., which is a server path. The
  // review pages are opened from disk, so each font file becomes a data URI and
  // the page needs no network at all.
  return joined.replace(/(?:\/_next\/static\/media\/|\.\.\/media\/)([\w.-]+)/g, (whole, file: string) => {
    try {
      return `data:font/woff2;base64,${readFileSync(join(MEDIA_DIR, file)).toString("base64")}`
    } catch {
      return whole
    }
  })
}

/** The class next/font puts on <body>, which defines --font-inter. */
function fontClass(styles: string): string {
  const match = /\.([A-Za-z0-9_-]+__variable)\s*\{/.exec(styles)

  return match === null ? "" : match[1]
}

function document(styles: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${styles}</style>
</head>
<body class="${fontClass(styles)} bg-background font-sans text-foreground antialiased">${body}</body>
</html>`
}

function writeScreen(styles: string, name: string, title: string, body: string): void {
  const html = document(styles, title, body).replaceAll('src="/brand/', 'src="./brand/')

  writeFileSync(join(OUTPUT, `${name}.html`), html)
}

function shell(app: "merchant" | "admin", user: AccountSummary, children: ReactNode): string {
  return renderToStaticMarkup(
    h(AppShell, {
      app,
      roles: app === "admin" ? (["staff"] as const) : (["vendor"] as const),
      user,
      children,
    }),
  )
}

describe.skipIf(process.env.SCREENS !== "1")("the design system review pages", () => {
  it("writes the style guide, the auth screens and the product list", () => {
    mkdirSync(OUTPUT, { recursive: true })

    const styles = css()
    writeFileSync(join(OUTPUT, "app.css"), styles)

    // The style guide, in the admin shell, exactly as the route renders it.
    writeScreen(
      styles,
      "style-guide",
      "Design system",
      shell("admin", STAFF, h(DesignSystemGuide)),
    )

    // Sign in and sign up, in the auth shell.
    writeScreen(
      styles,
      "sign-in",
      "Sign in",
      renderToStaticMarkup(
        h(
          AuthShell,
          {
            panel: {
              heading: "Welcome back.",
              body: "Sign in to manage your products, links and earnings.",
            },
          },
          h(SignInForm, {}),
        ),
      ),
    )

    writeScreen(
      styles,
      "sign-up",
      "Create an account",
      renderToStaticMarkup(
        h(
          AuthShell,
          {
            panel: {
              heading: "Sell and promote, in one place.",
              body: "One account for your products, your links and the money you have earned.",
            },
          },
          h(SignUpForm),
        ),
      ),
    )

    // The merchant product list: the page header, the description row and the
    // list itself with four products in four states.
    writeScreen(
      styles,
      "merchant-products",
      "Products",
      shell(
        "merchant",
        VENDOR,
        h(
          "div",
          null,
          h(PageHeader, { title: "Products" }),
          h(
            "div",
            { className: "mb-6 flex flex-wrap items-center justify-between gap-3" },
            h(
              "p",
              { className: "text-small text-text-muted" },
              "Everything you sell, from the first draft to the products in the marketplace.",
            ),
            h(
              "a",
              {
                href: "/products/new",
                className:
                  "focus-ring inline-flex h-control-md items-center rounded-md bg-brand-600 px-5 text-dense font-medium text-background transition-colors duration-150 hover:bg-brand-700",
              },
              "New product",
            ),
          ),
          h(ProductList, {
            status: "all",
            initialItems: PRODUCTS,
            initialCursor: null,
            initialError: null,
          }),
        ),
      ),
    )

    expect(styles.length).toBeGreaterThan(1000)
  })
})
