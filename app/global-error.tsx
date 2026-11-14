"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

// The last resort: an error thrown so high that the root layout itself could
// not render. Next.js replaces the whole document with this component, so it
// carries its own <html> and <body> and uses inline styles (the global
// stylesheet is not guaranteed to be loaded here).
//
// The error is reported to Sentry, which is a no-op when no DSN is configured.
// The visitor sees an apology and a retry button, and nothing about the error:
// no message, no digest, no stack. A stack trace on screen is a gift to anyone
// probing the app and no help to a real visitor.

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
          backgroundColor: "#f7f8f7",
          color: "#101812",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ fontSize: "24px", lineHeight: "1.3", margin: "0 0 12px" }}>
            Sorry, something went wrong
          </h1>
          <p style={{ fontSize: "16px", lineHeight: "1.6", margin: "0 0 24px", color: "#46544a" }}>
            The page could not be loaded. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: "#10813F",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "12px 24px",
              fontSize: "16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
