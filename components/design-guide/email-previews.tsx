import type { EmailTemplateEntry } from "@/emails/catalog"

// The Emails section of the style guide.
//
// Every message this product sends, drawn by the template that sends it: not a
// mock-up and not a screenshot, the actual HTML, in an iframe. Two widths,
// because an email is read on a phone as often as on a laptop, and the plain-text
// version underneath, because that is what a client with images off shows.
//
// The iframe is sandboxed with an empty sandbox attribute: no scripts, no forms,
// no top navigation. An email is untrusted by construction (a vendor types the
// product title), so the one place it is displayed in our own UI is the one place
// it can do nothing.
//
// No hooks and no state: this renders on the server, and the plain-text toggle is
// a native <details>, so the page ships no JavaScript for it.

/** The two widths an email is reviewed at. 600 is the widest a client gives. */
export const EMAIL_PREVIEW_WIDTHS = [600, 360] as const

/**
 * How tall each frame is.
 *
 * A frame cannot size itself to its content without a script, so these are the
 * tallest message at each width (measured: 868px at 600, 1116px at 360, for the
 * receipt with its long order summary) plus room for a longer product title. A
 * message that grows past it scrolls inside its frame rather than being cut off.
 */
export const EMAIL_PREVIEW_HEIGHTS: Readonly<Record<(typeof EMAIL_PREVIEW_WIDTHS)[number], number>> = {
  600: 900,
  360: 1180,
}

export interface EmailPreviewsProps {
  entries: readonly EmailTemplateEntry[]
}

export function EmailPreviews({ entries }: EmailPreviewsProps) {
  return (
    <div className="space-y-10">
      {entries.map((entry) => (
        <article key={entry.name} id={entry.name} className="border-t border-border pt-8 first:border-t-0 first:pt-0">
          <h2 className="text-h2 text-foreground">{entry.title}</h2>
          <p className="mt-1 max-w-reading text-dense text-text-muted">{entry.when}</p>

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-small sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-text-muted">Subject</dt>
              <dd className="min-w-0 break-words text-foreground">{entry.subject}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted">Template name</dt>
              <dd className="font-mono text-caption text-foreground">{entry.name}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-6">
            {EMAIL_PREVIEW_WIDTHS.map((width) => (
              <figure key={width} className="min-w-0">
                <figcaption className="mb-2 text-caption text-text-muted">{width}px wide</figcaption>
                <iframe
                  title={`${entry.title} at ${width}px`}
                  srcDoc={entry.html}
                  sandbox=""
                  width={width}
                  height={EMAIL_PREVIEW_HEIGHTS[width]}
                  className="block max-w-full rounded-md border border-border bg-background"
                  style={{ width, maxWidth: "100%", height: EMAIL_PREVIEW_HEIGHTS[width] }}
                />
              </figure>
            ))}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-small text-foreground">Plain text version</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-surface-subtle p-3 text-caption whitespace-pre-wrap text-foreground">
              {entry.text}
            </pre>
          </details>
        </article>
      ))}
    </div>
  )
}
