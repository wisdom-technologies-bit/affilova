import { existsSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LegalIndexView } from "@/app/legal/page"
import sitemap from "@/app/sitemap"
import GlobalFooter from "@/components/global-footer"
import { LegalDocument } from "@/components/legal/legal-document"
import { LEGAL_DOCUMENTS } from "@/content/legal"
import { termsOfServiceDocument } from "@/content/legal/terms-of-service"
import { POLICY_VERSIONS } from "@/lib/site-config"

function render(element: React.ReactElement): string {
  return renderToString(element)
}

describe("LegalDocument", () => {
  it("renders one h1, effective date, version, summary, numbered clauses and matching TOC anchors", () => {
    const html = render(createElement(LegalDocument, { document: termsOfServiceDocument }))

    const h1Matches = html.match(/<h1\b/g) ?? []
    expect(h1Matches).toHaveLength(1)
    expect(html).toContain(termsOfServiceDocument.title)
    expect(html).toContain(termsOfServiceDocument.effectiveDate)
    expect(html).toContain(POLICY_VERSIONS.terms_of_service)
    expect(html).toContain("Plain-language summary")

    for (const bullet of termsOfServiceDocument.summary) {
      expect(html).toContain(bullet)
    }

    for (const section of termsOfServiceDocument.sections) {
      expect(html).toContain(`href="#${section.id}"`)
      expect(html).toContain(`id="${section.id}"`)
    }

    expect(html).toContain("1.1")
    expect(html).toContain('href="/legal"')
    expect(html).toContain('href="/privacy-policy"')
  })

  it("shows the draft notice only when policyStatus is draft", () => {
    const draftHtml = render(
      createElement(LegalDocument, {
        document: termsOfServiceDocument,
        policyStatus: "draft",
      }),
    )
    const finalHtml = render(
      createElement(LegalDocument, {
        document: termsOfServiceDocument,
        policyStatus: "final",
      }),
    )

    expect(draftHtml).toContain("Draft pending legal review")
    expect(finalHtml).not.toContain("Draft pending legal review")
  })

  it("renders the legal identity line only when populated", () => {
    const emptyHtml = render(
      createElement(LegalDocument, {
        document: termsOfServiceDocument,
        identityLine: "",
      }),
    )
    const setHtml = render(
      createElement(LegalDocument, {
        document: termsOfServiceDocument,
        identityLine: "Affilova is operated by Example Tech Ltd, Lagos (registration no. RC-999)",
      }),
    )

    expect(emptyHtml).not.toContain("Example Tech Ltd")
    expect(setHtml).toContain("Affilova is operated by Example Tech Ltd, Lagos (registration no. RC-999)")
  })
})

describe("Legal index, footer, routes and sitemap", () => {
  it("lists every policy with version and effective date on /legal", () => {
    const html = render(createElement(LegalIndexView, { policyStatus: "draft" }))
    expect(html).toContain("Draft pending legal review")
    for (const doc of LEGAL_DOCUMENTS) {
      expect(html).toContain(doc.title)
      expect(html).toContain(`href="${doc.href}"`)
      expect(html).toContain(doc.version)
      expect(html).toContain(doc.effectiveDate)
    }
  })

  it("includes every legal link in GlobalFooter", () => {
    const html = render(createElement(GlobalFooter))
    expect(html).toContain('href="/legal"')
    for (const doc of LEGAL_DOCUMENTS) {
      expect(html).toContain(`href="${doc.href}"`)
    }
  })

  it("has a static page file and sitemap entry for /legal and every policy route", async () => {
    const routePaths = ["/legal", ...LEGAL_DOCUMENTS.map((doc) => doc.href)]
    for (const routePath of routePaths) {
      const pageFile = join(process.cwd(), "app", routePath.slice(1), "page.tsx")
      expect(existsSync(pageFile), `missing route file ${pageFile}`).toBe(true)
    }

    // The sitemap is async since the marketplace entries are read from the
    // database; a read that fails leaves the legal entries in place.
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)
    for (const routePath of routePaths) {
      expect(urls.some((url) => url.endsWith(routePath))).toBe(true)
    }
  })
})
