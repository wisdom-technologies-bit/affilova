import type { Event } from "@sentry/nextjs"

// The request shape inside an event; the SDK does not export the type on its own.
type SentryRequest = NonNullable<Event["request"]>

// The single place where the observability privacy and noise policy lives.
//
// Everything here is pure: no network, no globals are written, and the event
// passed in is never mutated. The three Sentry init files (instrumentation
// client, server and edge) all hand `scrubEvent` to `beforeSend`, so a rule
// added here applies to every runtime at once.
//
// What is deliberately never sent:
//   * request cookies, the authorization header, set-cookie, every header whose
//     name mentions a token or a key, and the request body
//   * any email address in the message or in `extra` (masked, not dropped)
//   * four kinds of event that are known noise and cannot be acted on

/**
 * The privacy defaults, as the SDK spells them in v11.
 *
 * `sendDefaultPii: false` was the v10 spelling and no longer exists: Sentry
 * replaced the single boolean with one switch per category of collected data
 * ("dataCollection", documented since 10.57.0, defaults always applied from
 * v11). The intent is unchanged, so every category that can carry personal
 * data is switched off here: no user info, no cookies, no request or response
 * bodies, no query parameter values, no database payloads, no local variable
 * values from stack frames, no generative AI or MCP content.
 *
 * Header names are collected, header values are not trusted: `scrubEvent`
 * below removes the ones that carry credentials.
 */
export const NO_PII_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
}

const PRODUCTION = "production"

/** Tracing is a 10% sample in production and off everywhere else. */
export function tracesSampleRateFor(appEnv: string | undefined): number {
  return appEnv === PRODUCTION ? 0.1 : 0
}

// An address is matched loosely (dot-atom local part, dotted domain) because
// this runs over free text: a false positive costs a masked character, a false
// negative leaks a real address.
// The capturing group is the domain, which is the part that is kept.
const EMAIL_PATTERN =
  /[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)/g

/**
 * "ada.lovelace@example.com" becomes "a***@example.com": the first character
 * and the domain survive, which is enough to tell two people apart in a log and
 * not enough to contact either of them.
 */
export function maskEmail(value: string): string {
  return value.replace(EMAIL_PATTERN, (match: string, ...rest: unknown[]): string => {
    const domain = typeof rest[0] === "string" ? rest[0] : ""

    return domain === "" ? `${match.charAt(0)}***` : `${match.charAt(0)}***@${domain}`
  })
}

// A header that carries a credential. "cookie", "authorization" and
// "set-cookie" are named explicitly; the two substring rules catch the rest
// (x-api-key, x-auth-token, x-csrf-token, ...).
function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase()

  return (
    lower === "cookie" ||
    lower === "set-cookie" ||
    lower === "authorization" ||
    lower.includes("token") ||
    lower.includes("key")
  )
}

// The noise that arrives from browsers and cannot be acted on. Each entry is
// matched against the message, the request URL and every stack frame URL.
const NOISE_PATTERNS: readonly RegExp[] = [
  // Fired by the browser itself when a resize handler changes layout.
  /ResizeObserver loop/i,
  // Errors thrown inside another extension's content script.
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  // The Turnstile widget's own origin (challenges.cloudflare.com).
  /challenges\.cloudflare\.com/i,
  // Turnstile script failures that carry no origin: "Turnstile script error",
  // "Turnstile failed to load", "Turnstile load failed".
  /turnstile[^\n]{0,80}(?:script error|failed to load|load failed)/i,
]

const MAX_DEPTH = 6

function stringsOf(value: unknown, found: string[]): void {
  if (typeof value === "string") {
    found.push(value)
  }
}

/**
 * True when the event is one of the known-noise shapes. Checked before anything
 * is scrubbed, so a dropped event costs nothing.
 */
export function isNoiseEvent(event: Event): boolean {
  const texts: string[] = []

  stringsOf(event.message, texts)
  stringsOf(event.request?.url, texts)

  for (const exception of event.exception?.values ?? []) {
    stringsOf(exception.value, texts)

    for (const frame of exception.stacktrace?.frames ?? []) {
      stringsOf(frame.filename, texts)
      stringsOf(frame.abs_path, texts)
    }
  }

  return NOISE_PATTERNS.some((pattern) => texts.some((text) => pattern.test(text)))
}

// Strings are masked, arrays and plain objects are walked, and everything else
// is handed back untouched. `seen` breaks cycles; `depth` stops a pathological
// payload from walking forever.
function scrubData(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") {
    return maskEmail(value)
  }

  if (depth >= MAX_DEPTH) {
    return value
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]"
    }

    seen.add(value)

    return value.map((entry) => scrubData(entry, seen, depth + 1))
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[circular]"
    }

    // A Date or an Error has no enumerable data worth walking; the logger is
    // where those shapes are normalised.
    if (value instanceof Date || value instanceof Error) {
      return value
    }

    seen.add(value)

    const copy: Record<string, unknown> = {}

    for (const [key, entry] of Object.entries(value)) {
      copy[key] = scrubData(entry, seen, depth + 1)
    }

    return copy
  }

  return value
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeader(name)) {
      continue
    }

    copy[name] = value
  }

  return copy
}

function scrubRequest(request: SentryRequest): SentryRequest {
  const copy: SentryRequest = { ...request }

  // The body can hold a password, a card number or an uploaded file.
  delete copy.data
  delete copy.cookies

  if (copy.headers) {
    copy.headers = scrubHeaders(copy.headers)
  }

  return copy
}

/**
 * The `beforeSend` hook shared by the client, server and edge configs.
 *
 * Returns `null` for a noise event, otherwise a scrubbed copy of the event. The
 * argument is never mutated: fields that are not mentioned here are copied over
 * exactly as they arrived.
 */
export function scrubEvent<T extends Event>(event: T): T | null {
  if (isNoiseEvent(event)) {
    return null
  }

  const copy: T = { ...event }

  if (typeof copy.message === "string") {
    copy.message = maskEmail(copy.message)
  }

  if (copy.request) {
    copy.request = scrubRequest(copy.request)
  }

  if (copy.extra) {
    copy.extra = scrubData(copy.extra, new WeakSet<object>(), 0) as T["extra"]
  }

  return copy
}
