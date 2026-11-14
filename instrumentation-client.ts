import * as Sentry from "@sentry/nextjs"

import {
  NO_PII_DATA_COLLECTION,
  scrubEvent,
  tracesSampleRateFor,
} from "@/lib/observability/scrub"

// Browser-side initialisation. The DSN is public by design: it is an ingest
// endpoint, not a credential.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const appEnv = process.env.NEXT_PUBLIC_APP_ENV

Sentry.init({
  dsn,
  // No DSN: the SDK stays switched off and every call is a no-op.
  enabled: Boolean(dsn),
  environment: appEnv,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  dataCollection: NO_PII_DATA_COLLECTION,
  tracesSampleRate: tracesSampleRateFor(appEnv),
  // No replayIntegration and no other integration that records screens or
  // inputs: session replay is off by design.
  beforeSend: (event) => scrubEvent(event),
})

// Instruments client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
