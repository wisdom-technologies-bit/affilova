# Observability (Sentry and structured logs)

Two things record what the app does when nobody is watching:

- **Sentry** collects errors and a sample of slow requests, so a failure that a
  visitor never reported still shows up with a stack trace.
- **The structured logger** (`lib/logger.ts`) writes one JSON line per event to
  stdout, which is what Vercel keeps in the function logs.

Both are optional. With no `NEXT_PUBLIC_SENTRY_DSN` the Sentry SDK is
initialised disabled, every `Sentry.*` call is a harmless no-op, and the logger
still writes its lines to the console. Builds and tests pass without a DSN.

- [1. Where the code lives](#1-where-the-code-lives)
- [2. What is sent to Sentry](#2-what-is-sent-to-sentry)
- [3. What is scrubbed before it leaves](#3-what-is-scrubbed-before-it-leaves)
- [4. Adding the DSN in Vercel](#4-adding-the-dsn-in-vercel)
- [5. Reading a cron or webhook failure](#5-reading-a-cron-or-webhook-failure)
- [6. Logger rules](#6-logger-rules)

## 1. Where the code lives

| File | What it does |
| --- | --- |
| `instrumentation.ts` | Loads the server config for the Node.js runtime, the edge config for the edge runtime, and exports `onRequestError` so errors thrown in route handlers and Server Components are reported. |
| `instrumentation-client.ts` | Browser initialisation, plus `onRouterTransitionStart`. |
| `sentry.server.config.ts` | `Sentry.init` for the Node.js runtime. |
| `sentry.edge.config.ts` | `Sentry.init` for the edge runtime. |
| `app/global-error.tsx` | Last-resort error boundary. Reports the error and shows a plain apology with a retry button. |
| `lib/observability/scrub.ts` | The whole privacy and noise policy. Pure, no imports at runtime, used as `beforeSend` by all three configs. |
| `lib/logger.ts` | The structured logger. |
| `next.config.mjs` | `withSentryConfig`, with `tunnelRoute: "/monitoring"`. |

## 2. What is sent to Sentry

- **Errors** from the browser, the Node.js server and the edge runtime.
- **Request errors** from route handlers and Server Components, through
  `onRequestError`.
- **Performance samples**: `tracesSampleRate` is `0.1` when
  `NEXT_PUBLIC_APP_ENV` is `production` and `0` in every other environment, so
  development and preview traffic is never traced.
- **Environment** from `NEXT_PUBLIC_APP_ENV`, and **release** from
  `VERCEL_GIT_COMMIT_SHA` (absent locally, which is expected).

Not sent, by configuration:

- **No session replay.** There is no `replayIntegration`, and no integration
  that records screens or keystrokes is enabled.
- **No default personal data.** `sendDefaultPii` no longer exists in
  `@sentry/nextjs` v11; it was replaced by the granular `dataCollection`
  option. `lib/observability/scrub.ts` exports `NO_PII_DATA_COLLECTION`, which
  switches off user info, cookies, request and response bodies, query parameter
  values, database payloads, stack-frame local variables, and generative AI and
  MCP content. All three configs pass it to `Sentry.init`.

Browser events travel to `/monitoring` on our own origin and the Sentry rewrite
proxies them onward. That route is same-origin, so the Content Security Policy
needs no change, and ad blockers that drop requests to `sentry.io` never see
one. `middleware.ts` only matches `/dashboard`, `/admin`, `/auth/login` and
`/auth/register`, so the tunnel route never passes through it.

## 3. What is scrubbed before it leaves

`lib/observability/scrub.ts` is the single place these rules live. `scrubEvent`
is the `beforeSend` hook of all three configs.

Removed from every event:

- the request body (`request.data`),
- `request.cookies`,
- the `cookie`, `set-cookie` and `authorization` headers,
- every header whose name contains `token` or `key` (`x-api-key`,
  `x-csrf-token`, ...).

Masked, not removed, in the message and in `extra` (including nested objects and
arrays): **every email address**, which becomes its first character plus the
domain, `ada.lovelace@example.com` → `a***@example.com`. Enough to tell two
people apart in a report, not enough to contact either of them.

Dropped entirely as noise, so it never reaches the issue list:

- `ResizeObserver loop ...` messages, which the browser raises itself,
- errors whose message or URL is a `chrome-extension://` or `moz-extension://`
  URL, which belong to somebody else's extension,
- Turnstile script errors: anything naming `challenges.cloudflare.com` (the
  widget's own origin), and the "Turnstile script error / failed to load"
  messages that carry no origin.

Nothing else in the event is touched: fields the scrubber was not asked about
are passed through exactly as they arrived. The event handed in is never
mutated.

To add a rule, add it to `scrub.ts` and to `lib/observability/scrub.test.ts`.
Changing it there changes all three runtimes at once.

## 4. Adding the DSN in Vercel

1. Create a project at [sentry.io](https://sentry.io) for the Next.js platform
   and copy its DSN (`https://<key>@o<org>.ingest.sentry.io/<project>`).
2. In Vercel, open the project → **Settings** → **Environment Variables**.
3. Add `NEXT_PUBLIC_SENTRY_DSN` with that value, for **Production** and for
   **Preview** if preview deployments should report too. Leave it out of
   Development if local errors should stay local.
4. Redeploy. The value is read at build time, so an existing deployment does not
   pick it up on its own.

Optional, for readable stack traces (source maps):

| Variable | What it is |
| --- | --- |
| `SENTRY_AUTH_TOKEN` | An org auth token with `project:releases` scope. |
| `SENTRY_ORG` | The organization slug. |
| `SENTRY_PROJECT` | The project slug. |

These three are **not required**. Without `SENTRY_AUTH_TOKEN`, `next.config.mjs`
disables source map handling and silences the build plugin, so a build without
credentials neither fails nor warns loudly. With it, source maps are uploaded
during the build and stack traces point at the original TypeScript.

Verifying it works: open the deployed site, visit `/monitoring` (it should not
404 once a DSN is set), then throw a deliberate error and watch it appear in
Sentry under the environment named by `NEXT_PUBLIC_APP_ENV`.

To switch reporting off again, delete `NEXT_PUBLIC_SENTRY_DSN` and redeploy.
Nothing else has to change: the SDK is initialised disabled.

## 5. Reading a cron or webhook failure

Both routes write a `logger.error` line and return a 5xx, so a failure is
visible in two places.

**In the Vercel logs** (Project → **Logs**, or `vercel logs <deployment>`):

- cron: filter on `cron_job_failed`. Each line is one JSON object with `job`
  (`process-queue`, `heartbeat-check` or `cleanup`) and `reason`.
- queue work: filter on `job_failed`. Each line carries the job `type` and the
  `reason` the handler threw.
- webhooks and route handlers generally: filter on `rate_limit_lookup_failed`,
  or on `"level":"error"` to see every error line from the whole app.

**In Sentry**: an unhandled error in a route handler is reported through
`onRequestError`, and appears with the route as its transaction. A caught error
that the route answered with a 5xx is reported only if it was passed to
`logger.error` as an `Error` field (see below), so search the issue stream for
the message the handler threw, and narrow by `environment:production` and the
release tag (the commit SHA) to compare a broken deploy with the one before it.

A heartbeat problem is still visible in the database: `public.cron_heartbeats`
holds a row per run, and `heartbeat-check` reports a schedule that missed its
five minute window. See [cron.md](cron.md) for the schedules themselves.

`logger.error(event, { error })` reports the error to Sentry as well, but only
when `NEXT_PUBLIC_SENTRY_DSN` is set. With no DSN the call is a no-op and the
JSON line is still written.

## 6. Logger rules

Every call produces exactly one JSON line:

```json
{"level":"error","event":"cron_job_failed","time":"2026-11-14T09:00:00.000Z","job":"process-queue","reason":"connection refused"}
```

`level`, `event` and `time` are always present; the fields follow. Four rules
apply before the line is written:

1. A field whose **key** matches
   `/pass(word)?|token|secret|authorization|cookie|api[-_]?key|otp|code$/i`
   becomes `"[redacted]"`, at any depth.
2. An **email address** in a value is masked the way the scrubber masks it.
3. An **Error** becomes `{ name, message }`, and keeps `stack` only outside
   production.
4. A **value longer than 500 characters** is cut.

The logger never throws: a circular object, a `BigInt`, a value JSON cannot
represent, or a failing Sentry call is contained, because a logger that throws
turns a small problem into an outage.

**The rule that matters: secrets and raw personal data never go into logger
fields.** Not a password, not a token, not a session cookie, not an API key, not
an OTP, not a card number, not a raw email address, not a full request body. The
redaction above is a safety net for the field names it recognises, not a licence
to pass those values: a key it does not recognise, or a value that is not under
a key at all, goes out verbatim in the JSON line. Log the identifier instead
(`user_id`, `order_id`, `job` type), never the credential, and never the payload
that carried it.
