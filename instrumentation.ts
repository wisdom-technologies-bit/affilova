import * as Sentry from "@sentry/nextjs"

// Next.js calls register() once per runtime. Each import is conditional so the
// Node.js config never loads in the edge runtime and the other way round.
//
// With no NEXT_PUBLIC_SENTRY_DSN the SDK is initialised disabled (see the two
// config files), so nothing is captured, sent or buffered.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

// Reports errors thrown in Server Components, route handlers and middleware.
export const onRequestError = Sentry.captureRequestError
