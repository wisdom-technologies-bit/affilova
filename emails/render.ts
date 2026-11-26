import { toPlainText } from "@react-email/render"
import type { ReactElement } from "react"
// react-dom/server.edge, not react-dom/server: Next.js refuses to compile a
// Server Component that imports react-dom/server ("render or return the content
// directly"), and the edge build exports the same renderToStaticMarkup without
// that guard. Nothing here needs a Node-only feature of the renderer.
import { renderToStaticMarkup } from "react-dom/server.edge"

import type { RenderedEmailBody } from "@/emails/types"

// Rendering a template into the three things the sender needs.
//
// Why react-dom/server and not the render package's own HTML mode: the public
// functions in lib/email/templates.ts are synchronous and their callers rely on
// that, while @react-email/render's render() returns a Promise in this version.
// renderToStaticMarkup is synchronous and produces the same markup.
//
// The plain-text version is the render package's own converter, toPlainText. In
// 2.3.1 its plainText option is exactly this call:
//
//   if (options.plainText) return toPlainText(html, options.htmlToTextOptions)
//
// so the runtime uses the package's conversion and not a second text format.
// render() itself cannot be used here even from a test: its streaming renderer
// fails on these templates under React 19.3.1 with "Element type is invalid"
// while renderToStaticMarkup renders the same element, so a parity check against
// render() would be a check of the package's streaming path, not of our text.

/**
 * The options both text paths use.
 *
 * html-to-text shouts a heading by default ("PAYMENT RECEIVED"). The words in an
 * email are already written in the case they should be read in, so the six
 * heading selectors are told not to change it. The option lives on the selector,
 * not at the top level, in the html-to-text version this depends on.
 */
export const PLAIN_TEXT_OPTIONS = {
  selectors: ["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
    selector,
    options: { uppercase: false },
  })),
} as const

/** The doctype is not part of React's output, and a mail client wants it. */
const DOCTYPE = "<!DOCTYPE html>\n"

/** One template's markup, with a doctype a mail client recognises. */
export function renderEmailHtml(node: ReactElement): string {
  const markup = renderToStaticMarkup(node)

  return markup.startsWith("<!DOCTYPE") ? markup : `${DOCTYPE}${markup}`
}

/**
 * One template, as HTML and as text.
 *
 * Synchronous on purpose: the adapter functions keep the shape they had before
 * this folder existed.
 */
export function renderEmail(node: ReactElement): RenderedEmailBody {
  const html = renderEmailHtml(node)

  return { html, text: toPlainText(html, PLAIN_TEXT_OPTIONS) }
}
