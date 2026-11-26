import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }))

import GlobalError from "@/app/global-error"
import NotFound from "@/app/not-found"
import { JoinOutcome } from "@/components/affiliate/join-outcome"

// The three pages that exist for the moment something went wrong.

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

describe("an invitation that worked", () => {
  it("names the product and offers one way onward", () => {
    const html = render(
      createElement(JoinOutcome, {
        outcome: { ok: true, productTitle: "Calm notebook" },
        affiliateUrl: "https://affiliate.affilova.com/marketplace",
      }),
    )

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Invitation accepted")
    expect(html).toContain("Calm notebook")
    expect(html).toContain("https://affiliate.affilova.com/marketplace")
  })
})

describe("an invitation that did not", () => {
  it("says the same neutral sentence whatever the reason", () => {
    const html = render(
      createElement(JoinOutcome, {
        outcome: { ok: false },
        affiliateUrl: "https://affiliate.affilova.com/marketplace",
      }),
    )

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("This invite is not valid")
    expect(html).toContain("It may have expired, been used already, or been withdrawn.")
  })
})

describe("a page that does not exist", () => {
  it("is calm and specific, and offers the two useful ways out", () => {
    const html = render(createElement(NotFound))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Page not found")
    expect(html).toContain('href="/marketplace"')
    expect(html).toContain('href="/sign-in"')
    expect(html).toContain("Browse the marketplace")
  })
})

describe("an error that took the page down", () => {
  it("apologises plainly, offers Try again, and leaks nothing technical", () => {
    const html = render(
      createElement(GlobalError, { error: new Error("column does not exist"), reset: () => undefined }),
    )

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Sorry, something went wrong")
    expect(html).toContain("Try again")
    expect(html).not.toContain("column does not exist")
    expect(html).not.toContain("Error:")
    expect(html).not.toContain("stack")
  })

  it("keeps a way out for someone who is stuck", () => {
    const html = render(createElement(GlobalError, { error: new Error("x"), reset: () => undefined }))

    expect(html).toContain('href="/marketplace"')
    expect(html).toContain('href="/sign-in"')
  })
})
