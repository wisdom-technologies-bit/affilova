import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// What the catalog screens put in the HTML, without a browser.
//
// The list asks the server for its first page only on "Load more", so a render
// with items in hand needs no network. The actions module is mocked anyway: a
// render test must not be able to reach Supabase by accident.

vi.mock("@/lib/catalog/actions/vendor", () => ({
  listVendorProductsAction: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
}))

import { ProductList } from "@/components/catalog/product-list"
import { ReadinessChecklist } from "@/components/catalog/readiness-checklist"
import { StatusBadge } from "@/components/catalog/status-badge"
import { fileStatusLabel, formatBytes, scanStatusLabel } from "@/lib/catalog/format"
import type { ProductReadiness, ProductStatus, ProductSummary } from "@/lib/catalog/action-types"

const PRODUCT: ProductSummary = {
  id: "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30",
  title: "Instagram Growth Playbook",
  slug: "instagram-growth-playbook",
  shortDescription: "A practical guide to growing an account without buying followers.",
  priceKobo: 2_500_000,
  currency: "NGN",
  status: "draft",
  submittedAt: null,
  publishedAt: null,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-17T10:30:00.000Z",
  rejectReason: null,
}

const READY: ProductReadiness = {
  title: true,
  shortDescription: true,
  description: true,
  category: true,
  price: true,
  commission: true,
  file: true,
  cover: true,
  missing: [],
}

describe("the status badge", () => {
  const STATUSES: ProductStatus[] = ["draft", "submitted", "live", "paused", "rejected", "archived"]

  it("shows a word for every status, not just a colour", () => {
    const words: Record<ProductStatus, string> = {
      draft: "Draft",
      submitted: "Submitted",
      live: "Live",
      paused: "Paused",
      rejected: "Rejected",
      archived: "Archived",
    }

    for (const status of STATUSES) {
      const html = renderToStaticMarkup(createElement(StatusBadge, { status }))

      expect(html, status).toContain(words[status])
    }
  })

  it("carries an icon with every status", () => {
    for (const status of STATUSES) {
      const html = renderToStaticMarkup(createElement(StatusBadge, { status }))

      expect(html, status).toContain("<svg")
      // The icon is decoration: the word above is what a screen reader reads.
      expect(html, status).toContain('aria-hidden="true"')
    }
  })
})

describe("the readiness checklist", () => {
  it("says so when nothing is missing", () => {
    const html = renderToStaticMarkup(createElement(ReadinessChecklist, { readiness: READY }))

    expect(html).toContain("Everything a reviewer needs is here.")
    expect(html).not.toContain("<a ")
  })

  it("links every missing item to the section that fixes it", () => {
    const html = renderToStaticMarkup(
      createElement(ReadinessChecklist, {
        readiness: { ...READY, category: false, price: false, cover: false, missing: ["category", "price", "cover"] },
      }),
    )

    expect(html).toContain("3 things are still missing")
    expect(html).toContain('href="#details"')
    expect(html).toContain('href="#pricing"')
    expect(html).toContain('href="#images"')
    expect(html).toContain("A category")
    expect(html).toContain("A cover image")
    // What is already done is still listed, so the page reads as a checklist.
    expect(html).toContain("Requirements already met")
  })

  it("uses the singular for one missing item", () => {
    const html = renderToStaticMarkup(
      createElement(ReadinessChecklist, { readiness: { ...READY, file: false, missing: ["file"] } }),
    )

    expect(html).toContain("One thing is still missing")
    expect(html).toContain('href="#files"')
  })
})

describe("the product list", () => {
  it("renders the products it was given, with price and updated date", () => {
    const html = renderToStaticMarkup(
      createElement(ProductList, {
        status: "all",
        initialItems: [PRODUCT],
        initialCursor: null,
      }),
    )

    expect(html).toContain("Instagram Growth Playbook")
    expect(html).toContain("₦25,000")
    expect(html).toContain("17 Nov 2026")
    expect(html).toContain("Draft")
    expect(html).toContain(`/products/${PRODUCT.id}`)
    // Both the wide table and the narrow cards are in the markup; CSS picks one.
    expect(html.match(/Instagram Growth Playbook/g)?.length).toBe(2)
  })

  it("shows the status tabs with the current one marked", () => {
    const html = renderToStaticMarkup(
      createElement(ProductList, { status: "live", initialItems: [], initialCursor: null }),
    )

    for (const label of ["All", "Draft", "Submitted", "Live", "Paused", "Rejected", "Archived"]) {
      expect(html).toContain(`>${label}</a>`)
    }

    expect(html).toContain('aria-current="page"')
    expect(html).toContain('href="/products?status=live"')
  })

  it("renders an honest empty state, with a way to start", () => {
    const html = renderToStaticMarkup(
      createElement(ProductList, { status: "all", initialItems: [], initialCursor: null }),
    )

    expect(html).toContain("You have not created a product yet.")
    expect(html).toContain('href="/products/new"')
    expect(html).not.toContain("<table")
  })

  it("has a different empty state for each tab", () => {
    const drafts = renderToStaticMarkup(
      createElement(ProductList, { status: "draft", initialItems: [], initialCursor: null }),
    )
    const submitted = renderToStaticMarkup(
      createElement(ProductList, { status: "submitted", initialItems: [], initialCursor: null }),
    )

    expect(drafts).toContain("No drafts.")
    expect(submitted).toContain("No products are waiting for review.")
    expect(drafts).not.toContain('href="/products/new"')
  })

  it("announces an error instead of pretending the list is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ProductList, {
        status: "all",
        initialItems: [],
        initialCursor: null,
        initialError: "Your products could not be loaded.",
      }),
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain("Your products could not be loaded.")
  })

  it("offers Load more only when there is another page", () => {
    const withCursor = renderToStaticMarkup(
      createElement(ProductList, { status: "all", initialItems: [PRODUCT], initialCursor: "cursor-2" }),
    )
    const withoutCursor = renderToStaticMarkup(
      createElement(ProductList, { status: "all", initialItems: [PRODUCT], initialCursor: null }),
    )

    expect(withCursor).toContain("Load more")
    expect(withoutCursor).not.toContain("Load more")
  })
})

describe("file status words", () => {
  it("never shows a raw database value", () => {
    expect(scanStatusLabel("not_scanned")).toBe("Not scanned")
    expect(scanStatusLabel("clean")).toBe("Clean")
    expect(scanStatusLabel("infected")).toBe("Rejected: malware detected")
    expect(scanStatusLabel("error")).toBe("Scan failed")
    expect(fileStatusLabel("pending")).toBe("Uploading")
    expect(fileStatusLabel("uploaded")).toBe("Uploaded")
  })

  it("shows a size a person can read", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(64 * 1024 * 1024)).toBe("64 MB")
  })
})
