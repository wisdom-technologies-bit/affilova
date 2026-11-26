"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

import { TOKENS } from "@/lib/design/tokens"

// The last resort: an error thrown so high that the root layout itself could not
// render. Next.js replaces the whole document with this component, so it carries
// its own <html> and <body> and uses inline styles (the global stylesheet is not
// guaranteed to be loaded here).
//
// The error is reported to Sentry, which is a no-op when no DSN is configured.
// The visitor sees an apology, one button that tries again, and two quiet ways
// out. Nothing about the error itself: no message, no digest, no stack. A stack
// trace on screen is a gift to anyone probing the app and no help to a real
// visitor.

const LINK_STYLE = {
  color: TOKENS.brand700.hex,
  fontSize: "15px",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
} as const

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: TOKENS.surfaceSubtle.hex,
          color: TOKENS.ink.hex,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "440px" }}>
          <h1 style={{ fontSize: "30px", lineHeight: "36px", letterSpacing: "-0.02em", margin: "0 0 12px" }}>
            Sorry, something went wrong
          </h1>
          <p style={{ fontSize: "15px", lineHeight: "24px", margin: "0 0 24px", color: TOKENS.textMuted.hex }}>
            This page could not be loaded. Trying again usually works.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: TOKENS.brand600.hex,
              color: TOKENS.background.hex,
              border: "none",
              borderRadius: "8px",
              height: "52px",
              padding: "0 24px",
              fontSize: "15px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ fontSize: "13px", lineHeight: "18px", margin: "24px 0 0", color: TOKENS.textSubtle.hex }}>
            <a href="/marketplace" style={LINK_STYLE}>
              Browse the marketplace
            </a>
            <span aria-hidden="true" style={{ margin: "0 10px" }}>
              ·
            </span>
            <a href="/sign-in" style={LINK_STYLE}>
              Sign in
            </a>
          </p>
        </main>
      </body>
    </html>
  )
}
