import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EmailPreviews, EMAIL_PREVIEW_HEIGHTS, EMAIL_PREVIEW_WIDTHS } from "@/components/design-guide/email-previews"
import { emailTemplateCatalog } from "@/emails/catalog"

// The email review pages.
//
// Renders the Emails section of the style guide through the real component, then
// writes one standalone page per template per width, taken from the very iframe
// the guide shows: the srcdoc attribute of each frame is what a browser renders
// inside it, so the page that is screenshotted cannot differ from the frame an
// admin sees.
//
// Two adjustments, both of them to the review page only and never to a template:
//
//   * the logo's absolute URL becomes a local file, because a review machine
//     cannot resolve affilova.example and a broken image would hide a layout
//     problem behind a broken image;
//   * nothing else is touched. The styles are the template's own inline styles,
//     and the page loads no stylesheet at all.
//
// The screenshots themselves are taken in Chrome from these files; see
// docs/design-review/emails/README.md for the command.

const OUTPUT = join(process.cwd(), "docs/design-review/emails/html")
const LOGO = join(process.cwd(), "public/brand/email/affilova-logo-email.png")

const env: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.example.com",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.example.com",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.example.com",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.example.com",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
}

for (const [key, value] of Object.entries(env)) {
  process.env[key] = value
}

/** The five entities React writes into an attribute. */
function decodeAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
}

/**
 * The srcdoc of every iframe in the rendered guide, in document order.
 *
 * A srcdoc attribute is HTML, so it is read to the matching quote rather than to
 * the next one: an email is full of quotes, and every one of them is escaped.
 */
function srcdocs(html: string): string[] {
  return [...html.matchAll(/<iframe\b[^>]*\bsrcdoc="((?:[^"]|&quot;)*)"/gi)].map((match) =>
    decodeAttribute(match[1] ?? ""),
  )
}

function localLogo(html: string): string {
  return html.replace(/https?:\/\/[^"]*\/brand\/email\/affilova-logo-email\.png/g, "logo.png")
}

describe.skipIf(process.env.SCREENS !== "1")("the email review pages", () => {
  it("writes one page per template per width, taken from the style guide's frames", () => {
    const entries = emailTemplateCatalog()
    const section = renderToStaticMarkup(createElement(EmailPreviews, { entries }))

    mkdirSync(OUTPUT, { recursive: true })
    writeFileSync(join(OUTPUT, "logo.png"), readFileSync(LOGO))

    // The section as the admin page renders it, with the stylesheet the build
    // emitted. This file is the record of what the guide looks like; the frames
    // are what the screenshots are taken from.
    const frames = srcdocs(section)

    expect(frames).toHaveLength(entries.length * EMAIL_PREVIEW_WIDTHS.length)

    entries.forEach((entry, index) => {
      EMAIL_PREVIEW_WIDTHS.forEach((width, offset) => {
        const frame = frames[index * EMAIL_PREVIEW_WIDTHS.length + offset]

        expect(frame, `${entry.name} at ${width}`).toBeTypeOf("string")
        expect(frame).toContain("<html")

        const page = localLogo(frame ?? "").replace(
          "<head>",
          `<head>\n<meta name="review-width" content="${width}">\n<meta name="review-height" content="${EMAIL_PREVIEW_HEIGHTS[width]}">`,
        )

        writeFileSync(join(OUTPUT, `${entry.name}-${width}.html`), `${page}\n`)
      })
    })

    // Every entry produced both pages.
    const written = readdirSync(OUTPUT).filter((name) => name.endsWith(".html"))

    expect(written).toHaveLength(entries.length * EMAIL_PREVIEW_WIDTHS.length)
  })
})
