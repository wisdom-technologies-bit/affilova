import * as Sentry from "@sentry/nextjs"

import {
  NO_PII_DATA_COLLECTION,
  scrubEvent,
  tracesSampleRateFor,
} from "@/lib/observability/scrub"

// Edge runtime (middleware, edge route handlers).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const appEnv = process.env.NEXT_PUBLIC_APP_ENV

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: appEnv,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  dataCollection: NO_PII_DATA_COLLECTION,
  tracesSampleRate: tracesSampleRateFor(appEnv),
  // Session replay and every other recording integration stay off.
  beforeSend: (event) => scrubEvent(event),
})
