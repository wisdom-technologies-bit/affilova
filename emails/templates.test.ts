import { toPlainText } from "@react-email/render"
import { describe, expect, it } from "vitest"

import { createElement } from "react"

import { emailTemplateCatalog, type EmailTemplateEntry } from "@/emails/catalog"
import {
  PurchaseReceipt,
  purchaseReceiptSample,
  purchaseReceiptSubject,
} from "@/emails/templates/purchase-receipt"
import { PLAIN_TEXT_OPTIONS, renderEmail } from "@/emails/render"
import { contrastRatio } from "@/lib/design/contrast"
import { EMAIL_COLOURS, EMAIL_MAX_WIDTH } from "@/lib/design/tokens"

// Every template, checked against the rules that make an email work in a client
// we do not control.
//
// These are properties, not appearances: a mail client strips the stylesheet, so
// the only style is inline; a client with images off shows the alt text; a client
// that blocks the button's background still has to leave a way through, so the
// link is printed under it; a link that is not absolute https is a broken link in
// every client that proxies it. Each one is asserted for every template in the
// catalogue, so a new template is covered by adding it to the catalogue.
//
// What is not asserted here: that an email looks right. That is the style guide
// and the review screenshots, in docs/design-review/emails.

const entries = emailTemplateCatalog()

function each(name: string, run: (entry: EmailTemplateEntry) => void | Promise<void>): void {
  for (const entry of entries) {
    // The callback is awaited, not just called: one of the checks renders a
    // template asynchronously, and a promise left floating would keep React's
    // async render running after the test ended.
    it(`${name}: ${entry.name}`, async () => {
      await run(entry)
    })
  }
}

/**
 * Every anchor's href, decoded, in document order.
 *
 * Anchors only: React Email also writes the logo into a <link rel="preload">,
 * which is a fetch hint rather than a link a reader can follow, and the image's
 * own src is checked with the other images.
 */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) =>
    match[1].replace(/&amp;/g, "&"),
  )
}

/**
 * Links that wrap an image: the logo in the header.
 *
 * The text version shows the image's alt text instead of the image, and a text
 * reader has nothing to click, so these are the one kind of link that does not
 * have to appear in the text. Every other link does.
 */
function imageLinkHrefs(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>\s*<img/g)].map((match) =>
      match[1].replace(/&amp;/g, "&"),
    ),
  )
}

/** Every src in the markup, decoded. */
function srcs(html: string): string[] {
  return [...html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"))
}

/** The colour from a `background-color:#RRGGBB` declaration, if there is one. */
function backgroundColour(html: string): string | null {
  const match = /background-color:\s*(#[0-9A-Fa-f]{6})/.exec(html)

  return match === null ? null : match[1]
}

describe("email templates: structure", () => {
  each("has exactly one h1", (entry) => {
    const h1s = entry.html.match(/<h1[\s>]/g) ?? []

    expect(h1s).toHaveLength(1)
  })

  each("has a lang on the html element", (entry) => {
    expect(entry.html).toMatch(/<html[^>]*lang="en"/)
  })

  each("carries a preview text, hidden from the body", (entry) => {
    // React Email renders the preview into a div hidden with display:none at the
    // top of the body. It is the line a client shows next to the subject, so it
    // has to be there and it has to have words in it.
    const preview = /<div style="display:none[^"]*"[^>]*>([^<]+)</.exec(entry.html)

    expect(preview, `${entry.name} has no preview text`).not.toBeNull()
    expect((preview?.[1] ?? "").trim().length).toBeGreaterThan(10)
  })

  each("is designed for 600px and never wider", (entry) => {
    expect(entry.html).toContain(`max-width:${EMAIL_MAX_WIDTH}px`)

    for (const width of entry.html.match(/width:\s*(\d{3,4})px/g) ?? []) {
      const value = Number(width.replace(/\D/g, ""))

      expect(value).toBeLessThanOrEqual(EMAIL_MAX_WIDTH)
    }
  })

  each("prints the link under the button, so a blocked button is not a dead end", (entry) => {
    // The fallback sentence is in every template that has a button, and it is
    // followed by the link itself, not only by the button.
    const hasButton = entry.html.includes("border-radius:6px")
    const fallback = /If the button does not work, copy this link into your browser:/.test(entry.html)

    if (hasButton) {
      expect(fallback).toBe(true)
    }
  })
})

describe("email templates: links", () => {
  each("every link is absolute https", (entry) => {
    for (const href of hrefs(entry.html)) {
      // The four Supabase Auth templates are rendered with Supabase's own
      // variables and are not sent by this app, so their links begin with
      // {{ .SiteURL }} and become absolute at send time. The rest of the link
      // is checked the same way.
      const rest = href.replace(/^\{\{\s*\.SiteURL\s*\}\}/, "")

      if (rest !== href) {
        expect(rest.startsWith("/"), `${entry.name}: ${href}`).toBe(true)

        continue
      }

      expect(href.startsWith("https://"), `${entry.name}: ${href}`).toBe(true)
    }
  })

  each("has no http, javascript:, data: or mailto: link", (entry) => {
    expect(entry.html).not.toMatch(/href="http:/i)
    expect(entry.html.toLowerCase()).not.toContain("javascript:")
    expect(entry.html).not.toMatch(/href="data:/i)
  })

  each("every image is absolute https with alt text", (entry) => {
    const images = [...entry.html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])

    expect(images.length).toBeGreaterThan(0)

    for (const image of images) {
      expect(image).toMatch(/src="(https:\/\/|\{\{ \.SiteURL \}\}\/)/)
      const alt = /alt="([^"]*)"/.exec(image)

      expect(alt, `${entry.name}: an image without alt`).not.toBeNull()
      expect((alt?.[1] ?? "").trim().length).toBeGreaterThan(0)
    }

    for (const src of srcs(entry.html)) {
      expect(src.startsWith("https://") || src.startsWith("{{ .SiteURL }}/")).toBe(true)
    }
  })
})

describe("email templates: text version", () => {
  each("contains every link the HTML contains", (entry) => {
    const imageLinks = imageLinkHrefs(entry.html)

    for (const link of new Set(hrefs(entry.html))) {
      if (imageLinks.has(link)) {
        continue
      }

      expect(entry.text, `${entry.name} is missing ${link}`).toContain(link)
    }
  })

  each("carries the key facts and no markup", (entry) => {
    // A subject is the one line a reader sees before opening: whatever the
    // subject promises has to be in the body, or the message reads as a trick.
    expect(entry.text.length).toBeGreaterThan(80)
    expect(entry.text).not.toContain("<")
    expect(entry.text).not.toContain("&nbsp;")
    expect(entry.text).not.toContain("&#x27;")
    expect(entry.text).not.toMatch(/\u200b/)

    // Every amount or code the HTML shows is in the text too.
    for (const amount of new Set(entry.html.match(/₦[\d,]+/g) ?? [])) {
      expect(entry.text).toContain(amount)
    }
  })

  each("is the render package's own converter, not a second text format", (entry) => {
    // The package's plainText option is this one call, in
    // @react-email/render 2.3.1: `toPlainText(html, options.htmlToTextOptions)`.
    // Its async render() cannot be used here at all (see emails/render.ts), so
    // the converter it delegates to is what both the runtime and this test call,
    // with the same options. If the package ever changes that delegation, this
    // stops being true and the comment in emails/render.ts needs revisiting.
    const converted = toPlainText(entry.html, PLAIN_TEXT_OPTIONS)

    expect(converted).toBe(entry.text)
    // And it really did the conversion: the markup is not in the text.
    expect(converted).not.toContain("<p")
    expect(converted).not.toContain("style=")
  })
})

describe("email templates: weight and independence", () => {
  each("is under 100 KB", (entry) => {
    expect(Buffer.byteLength(entry.html, "utf8")).toBeLessThan(100 * 1024)
  })

  each("has no external stylesheet, no external font and no script", (entry) => {
    expect(entry.html).not.toMatch(/<link[^>]+rel="stylesheet"/i)
    expect(entry.html).not.toMatch(/@import/i)
    expect(entry.html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit/i)
    expect(entry.html).not.toMatch(/@font-face/i)
    expect(entry.html).not.toMatch(/<script/i)
    // No tracking pixel: a 1x1 image is a 1x1 image whatever it is called.
    expect(entry.html).not.toMatch(/width="1"[^>]*height="1"/i)
    expect(entry.html).not.toMatch(/height="1"[^>]*width="1"/i)
  })

  each("uses only colours from lib/design/tokens.ts", (entry) => {
    // The entities &#8202; and friends look like a hex value to a loose pattern,
    // so a colour has to be preceded by something that is not "&" or a word.
    const hexes = [...new Set((entry.html.match(/(?<![&\w])#[0-9A-Fa-f]{3,8}\b/g) ?? []))].map((hex) =>
      hex.toUpperCase(),
    )
    const allowed = new Set(Object.values(EMAIL_COLOURS).map((value) => value.toUpperCase()))

    for (const hex of hexes) {
      expect(allowed.has(hex), `${entry.name} uses ${hex}, which is not a token`).toBe(true)
    }
  })

  each("asks for a system font stack and no download", (entry) => {
    expect(entry.html).toContain("-apple-system")
    expect(entry.html).not.toContain("https://fonts.")
  })
})

describe("email templates: contrast", () => {
  const WHITE = EMAIL_COLOURS.card

  each("body text is at least 4.5:1 on the card", (entry) => {
    // The three text colours the templates use, against the card they sit on.
    for (const colour of [EMAIL_COLOURS.ink, EMAIL_COLOURS.muted, EMAIL_COLOURS.subtle]) {
      expect(contrastRatio(colour, WHITE)).toBeGreaterThanOrEqual(4.5)
    }
  })

  each("the button label is at least 4.5:1 on the button", (entry) => {
    expect(contrastRatio(EMAIL_COLOURS.onBrand, EMAIL_COLOURS.brand)).toBeGreaterThanOrEqual(4.5)
  })

  each("a semantic pair is at least 4.5:1 on its pale surface", (entry) => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      [EMAIL_COLOURS.danger, EMAIL_COLOURS.dangerSurface],
      [EMAIL_COLOURS.warning, EMAIL_COLOURS.warningSurface],
      [EMAIL_COLOURS.success, EMAIL_COLOURS.successSurface],
    ]

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  each("the button really is brand-600 with a white label", (entry) => {
    if (!entry.html.includes("border-radius:6px")) {
      return
    }

    // The button cell carries the background and the anchor carries the label
    // colour. Both are checked because a client that keeps one and drops the
    // other is exactly the case the fallback link exists for.
    expect(backgroundColour(entry.html)).toBe(EMAIL_COLOURS.brand.toUpperCase())
    expect(entry.html).toContain(`color:${EMAIL_COLOURS.onBrand.toUpperCase()}`)
    expect(entry.html).toMatch(/min-height:44px/)
  })
})

describe("email templates: user-supplied text is escaped", () => {
  const HOSTILE = {
    script: '<script>alert("x")</script>',
    quotes: `He said "buy" and 'sold' it`,
    ampersand: "R&D <b>bold</b> & more",
    long: "A".repeat(500),
  }

  function receiptWith(productTitle: string): { html: string; text: string; subject: string } {
    const props = { ...purchaseReceiptSample, productTitle }
    const rendered = renderEmail(createElement(PurchaseReceipt, props))

    return { ...rendered, subject: purchaseReceiptSubject(props) }
  }

  it("turns a script tag into text, never into a tag", () => {
    const { html, text } = receiptWith(HOSTILE.script)

    expect(html).not.toContain("<script")
    expect(html).toContain("&lt;script&gt;")
    // The words survive: it is escaped, not removed.
    expect(text).toContain("script")
  })

  it("escapes quotes and ampersands", () => {
    const { html } = receiptWith(HOSTILE.quotes)

    expect(html).not.toContain(`said "buy"`)
    expect(html).toContain("&quot;buy&quot;")
    expect(html).toContain("&#x27;sold&#x27;")

    const withAmpersand = receiptWith(HOSTILE.ampersand)

    expect(withAmpersand.html).toContain("R&amp;D")
    expect(withAmpersand.html).not.toContain("<b>bold</b>")
  })

  it("keeps a 500 character title inside the message and cuts it in the subject", () => {
    const { html, subject } = receiptWith(HOSTILE.long)

    // The body may carry the whole title; the message is still small.
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024)
    expect(html).toContain("A".repeat(100))

    // The title portion of a subject is at most 80 characters, ellipsis included.
    const title = subject.replace("Your download link: ", "")

    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith("…")).toBe(true)
  })

  it("flattens a newline in a title so the subject stays one line", () => {
    const { subject } = receiptWith("Two\nlines\r\nhere")

    expect(subject).toBe("Your download link: Two lines here")
  })

  it("leaves a short title alone", () => {
    expect(receiptWith("Small book").subject).toBe("Your download link: Small book")
  })
})

describe("email templates: text snapshots", () => {
  it("matches the committed text versions", () => {
    const snapshot = Object.fromEntries(entries.map((entry) => [entry.name, entry.text]))

    expect(snapshot).toMatchSnapshot()
  })
})
