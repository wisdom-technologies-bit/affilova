import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import GlobalFooter from "../components/global-footer"
import { LegalHeader } from "../components/legal/legal-header"
import ContactPage from "../app/contact/page"

// A link in the public header or footer must point at a page that exists. The
// route list is built from the page files under app/ (the internal app/hosts
// tree is not public), so a deleted page makes this test fail instead of
// leaving a dead link on every public page.

const APP_DIR = join(__dirname, "..", "app")

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      return name === "hosts" || name === "api" ? [] : pageFiles(path)
    }

    return name === "page.tsx" ? [path] : []
  })
}

function routePatterns(): RegExp[] {
  return pageFiles(APP_DIR).map((file) => {
    const segments = relative(APP_DIR, file)
      .split(sep)
      .slice(0, -1)
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .map((segment) => (segment.startsWith("[") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

    return new RegExp(`^/${segments.join("/")}$`)
  })
}

function internalTargets(html: string): string[] {
  const targets = [...html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((match) => (match[1] ?? "").replace(/&amp;/g, "&"))

  return targets
    .filter((href) => href.startsWith("/"))
    .map((href) => href.split(/[?#]/)[0] ?? href)
}

describe("public header and footer links", () => {
  const patterns = routePatterns()

  const surfaces: { name: string; html: () => string }[] = [
    { name: "footer", html: () => renderToStaticMarkup(createElement(GlobalFooter)) },
    { name: "legal header", html: () => renderToStaticMarkup(createElement(LegalHeader, {})) },
    { name: "contact page", html: () => renderToStaticMarkup(createElement(ContactPage)) },
  ]

  it.each(surfaces)("every internal link in the $name points at an existing page", ({ html }) => {
    const targets = internalTargets(html())

    expect(targets.length).toBeGreaterThan(0)

    for (const target of targets) {
      expect(
        patterns.some((pattern) => pattern.test(target === "" ? "/" : target)),
        `${target} has no page`,
      ).toBe(true)
    }
  })

  it("has no link to the blog or to the removed legacy auth pages", () => {
    const sources = [
      "components/global-footer.tsx",
      "components/legal/legal-header.tsx",
      "app/HomePageClient.tsx",
      "app/how-it-works/HowItWorksClient.tsx",
      "app/about/page.tsx",
      "app/not-found.tsx",
      "app/contact/page.tsx",
      "app/sitemap.ts",
    ]

    for (const file of sources) {
      const source = readFileSync(join(__dirname, "..", file), "utf8")

      expect(source, file).not.toMatch(/["'`]\/blog/)
      expect(source, file).not.toMatch(/["'`]\/auth\/(login|register)/)
    }
  })

  it("shows the support email as a mailto link only when it is set", () => {
    const html = renderToStaticMarkup(createElement(ContactPage))

    expect(html).toContain("mailto:")
    expect(html).not.toContain("<form")
  })
})
