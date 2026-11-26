import { timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { getBrevoWebhookToken } from "@/lib/env"
import { addSuppression, isSuppressionReason, type SuppressionReason } from "@/lib/email/suppression"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"

// POST /api/brevo/webhook/[token]
//
// Brevo's transactional webhook, and the reason this route exists: a message
// that hard bounces, is blocked, or is marked as spam must not be sent again.
// Everything else Brevo reports is ignored.
//
// The order of the checks is the design:
//
//   1. the path token equals BREVO_WEBHOOK_TOKEN, compared in constant time, or
//      the answer is 404 with an empty body. 404 rather than 401 because a 401
//      confirms the path exists;
//   2. the method is POST, and the body is at most 64 KB, refused before it is
//      read into a string;
//   3. the body parses as the shape Brevo documents for a transactional event;
//   4. the address is hashed with the pepper and written to the suppression
//      list. The address is never stored, never logged and never returned;
//   5. every other event is ignored, and a valid body always answers 200.
//
// A 200 means "I have this": suppressed, or deliberately ignored. Brevo retries
// a non-2xx delivery, and a retry of "this address complained" does not become
// truer the second time.
//
// Brevo documents no signature on a transactional webhook, so the path is the
// credential: at least 32 characters of randomness, generated once and stored in
// the deployment, and rotated by changing both the variable and the URL in
// Brevo's dashboard. The IP allowlist Brevo publishes is a second, optional
// control; it is not enforced here because a misconfigured proxy in front of the
// deployment would then silently drop every suppression.

export const dynamic = "force-dynamic"

/** Brevo's transactional events are a few kilobytes. 64 KB is far above them. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

/** Generous: one address can bounce a hundred times in a burst, and each is one row. */
export const WEBHOOK_RATE_LIMIT = 600
export const WEBHOOK_RATE_WINDOW_SECONDS = 60

/**
 * The event names in the body, which are snake_case.
 *
 * The dashboard and the create-webhook API call these Hard Bounce, softBounce
 * and invalid, but the payload Brevo posts uses the names below. That difference
 * is the reason this list is written out rather than inferred: docs/email.md
 * records both spellings.
 */
const SUPPRESSING_EVENTS: Readonly<Record<string, SuppressionReason>> = {
  hard_bounce: "hard_bounce",
  blocked: "blocked",
  // A spam complaint is the event that damages a sending domain most, so it is
  // the one reason worth its own word.
  spam: "complaint",
  invalid_email: "invalid",
  unsubscribed: "unsubscribed",
}

/** Reported by Brevo and deliberately not acted on. */
const IGNORED_EVENTS: readonly string[] = [
  "soft_bounce",
  "deferred",
  "delivered",
  "request",
  "sent",
  "opened",
  "unique_opened",
  "click",
  "error",
  "proxy_open",
  "unique_proxy_open",
]

/**
 * What is read from the body.
 *
 * Only three fields: the event, the address and the webhook id, which is the
 * only thing recorded in a log line. Everything else Brevo sends (subject, tags,
 * sending_ip, mirror_link) is dropped unread, because none of it is needed and
 * every extra field is one more thing that could carry an address into a log.
 */
const eventSchema = z.object({
  event: z.string().min(1).max(60),
  email: z.string().min(3).max(320),
  id: z.number().int().nonnegative().nullish(),
})

export interface BrevoWebhookDeps {
  /** The configured path token, or undefined when the deployment has none. */
  token: string | undefined
  addSuppression: typeof addSuppression
  rateLimit: typeof rateLimit
  log: {
    info: (event: string, fields?: Record<string, unknown>) => void
    warn: (event: string, fields?: Record<string, unknown>) => void
    error: (event: string, fields?: Record<string, unknown>) => void
  }
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } })
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/**
 * Constant time, and a length difference is refused without comparing bytes.
 *
 * The same primitive, written the same way, as the Paystack transfer approval
 * route: one way of comparing a secret in a path, used twice, is easier to trust
 * than two ways that drifted apart.
 */
export function tokenMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8")
  const right = Buffer.from(expected, "utf8")

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

function configuredDeps(): BrevoWebhookDeps {
  return {
    token: getBrevoWebhookToken(),
    addSuppression,
    rateLimit,
    log: logger,
  }
}

/** The handler, with its dependencies passed in so a test needs no environment. */
export async function handleBrevoWebhook(
  request: Request,
  token: string,
  deps: BrevoWebhookDeps,
): Promise<Response> {
  // 1. The path token. Absent configuration, or a wrong token, is a 404 with no
  // body: an unauthenticated caller learns nothing, not even that the route is
  // there.
  if (deps.token === undefined || deps.token === "" || !tokenMatches(token, deps.token)) {
    deps.log.warn("brevo_webhook_token_rejected", {})

    return empty(404)
  }

  // 2. The method and the size.
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    })
  }

  const declared = Number(request.headers.get("content-length") ?? "0")

  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }

  let raw: string

  try {
    raw = await request.text()
  } catch {
    return json({ error: "unreadable_body" }, 400)
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }

  // 3. A generous limit, keyed on the caller's address and hashed before it
  // reaches the database. It is "allow" on a database error: a limiter outage
  // must not become a reason to stop suppressing complaints.
  const limit = await deps.rateLimit({
    key: rateLimitKey(["brevo-webhook", clientIpFromHeaders(request.headers)]),
    limit: WEBHOOK_RATE_LIMIT,
    windowSeconds: WEBHOOK_RATE_WINDOW_SECONDS,
    onError: "allow",
  })

  if (!limit.allowed) {
    deps.log.warn("brevo_webhook_rate_limited", {})

    return json({ error: "rate_limited" }, 429)
  }

  let parsedBody: unknown

  try {
    parsedBody = JSON.parse(raw)
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const parsed = eventSchema.safeParse(parsedBody)

  if (!parsed.success) {
    return json({ error: "invalid_body" }, 400)
  }

  const { event, email, id } = parsed.data
  // The event name is a short token Brevo controls; it is safe to log and it is
  // the one thing that makes a stuck webhook diagnosable.
  const eventName = event.trim().toLowerCase()

  if (IGNORED_EVENTS.includes(eventName)) {
    deps.log.info("brevo_webhook_ignored", { event: eventName, webhookId: id ?? null })

    return json({ ok: true, handled: "ignored" }, 200)
  }

  const reason = SUPPRESSING_EVENTS[eventName]

  if (reason === undefined) {
    // An event this deployment does not know about, including a new one Brevo
    // adds later. Answering 200 stops Brevo retrying it forever; the log line is
    // what makes it visible.
    deps.log.info("brevo_webhook_unknown_event", { event: eventName, webhookId: id ?? null })

    return json({ ok: true, handled: "unknown" }, 200)
  }

  if (!isSuppressionReason(reason)) {
    // Unreachable: SUPPRESSING_EVENTS is typed to SuppressionReason. It is here
    // so the table's closed list stays the single source of truth if one is ever
    // added without adding it to that type.
    deps.log.error("brevo_webhook_reason_unsupported", { event: eventName })

    return json({ ok: true, handled: "unsupported" }, 200)
  }

  // 4. The write. addSuppression hashes the address with the pepper, never
  // throws, and never logs the address.
  const result = await deps.addSuppression(email, reason, "brevo_webhook")

  deps.log.info("brevo_webhook_handled", {
    event: eventName,
    reason,
    webhookId: id ?? null,
    stored: result.ok,
  })

  // 5. 200 whatever the write did. A 500 would make Brevo retry, and a retry of
  // "this address is gone" does not change the address.
  return json({ ok: true, handled: "suppressed", reason, stored: result.ok }, 200)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params

  return handleBrevoWebhook(request, token, configuredDeps())
}

/** Every other method, so a browser or a scanner gets a clear answer. */
export async function GET(): Promise<Response> {
  return empty(405)
}

export const PUT = GET
export const PATCH = GET
export const DELETE = GET
export const HEAD = GET
