import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"

// Receives Content-Security-Policy reports from the browser while the policy is
// Report-Only (see next.config.mjs).
//
// Rules this handler keeps:
//   * POST only. There is no GET: a report cannot be read back, ever.
//   * It stores nothing. No database, no file, no cache: one console line.
//   * The body is capped at 8 KB and a larger one is refused with 413.
//   * The log line carries two facts only: the violated directive and the
//     origin of the blocked URI. No document URL, no full blocked URI, and no
//     query string, because those routinely contain ids and tokens.
//   * Every answer is 204, including a rate limited one, so a browser learns
//     nothing about the endpoint and never retries in a tight loop.

export const dynamic = "force-dynamic"

const MAX_REPORT_BYTES = 8 * 1024

// 60 reports per client address per minute. A page with a broken policy can
// emit a report per blocked resource per view, so a real visitor can legitimately
// send a burst; anything past this is dropped silently.
const REPORTS_PER_MINUTE = 60
const REPORT_WINDOW_SECONDS = 60

// A directive and an origin are both short. The caps are a guard against a
// hostile body, not a formatting choice.
const MAX_DIRECTIVE_LENGTH = 60
const MAX_ORIGIN_LENGTH = 80

const NO_CONTENT = 204

function noContent(): Response {
  return new Response(null, { status: NO_CONTENT })
}

type MediaType = "csp-report" | "json" | "other"

function mediaTypeOf(request: Request): MediaType {
  const contentType = request.headers.get("content-type") ?? ""
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? ""

  if (media === "application/csp-report") {
    return "csp-report"
  }

  if (media === "application/json") {
    return "json"
  }

  return "other"
}

/**
 * Read the body, giving up as soon as it passes the cap.
 *
 * A Content-Length over the cap is refused before a single byte is read; a
 * chunked body is refused as soon as the running total passes it, so an
 * oversized report never has to fit in memory.
 *
 * Returns null when the body is too large.
 */
async function readWithinCap(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length")

  if (declared !== null) {
    const length = Number.parseInt(declared, 10)

    if (Number.isFinite(length) && length > maxBytes) {
      return null
    }
  }

  if (request.body === null) {
    return ""
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let received = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value) {
        received += value.byteLength

        if (received > maxBytes) {
          await reader.cancel()

          return null
        }

        text += decoder.decode(value, { stream: true })
      }
    }
  } finally {
    reader.releaseLock()
  }

  return text + decoder.decode()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function stringField(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) {
    return null
  }

  const value = source[key]

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * The reported violation, from either body shape:
 *   application/csp-report  { "csp-report": { "violated-directive": ... } }
 *   application/json        [{ type: "csp-violation", body: { ... } }]
 *                           (or the bare "csp-report" object)
 */
function violationFrom(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const record = asRecord(entry)
      const body = asRecord(record?.body)

      if (body !== null) {
        return body
      }
    }

    return null
  }

  const record = asRecord(parsed)

  if (record === null) {
    return null
  }

  const nested = asRecord(record["csp-report"])

  return nested ?? record
}

function directiveOf(violation: Record<string, unknown> | null): string | null {
  const directive =
    stringField(violation, "effective-directive") ??
    stringField(violation, "violated-directive") ??
    // The Reporting API (application/json) spells the same facts in camelCase.
    stringField(violation, "effectiveDirective") ??
    stringField(violation, "violatedDirective")

  if (directive === null) {
    return null
  }

  // A reported value is the directive plus its source list
  // ("script-src 'self' https://example.com"). Only the directive name is
  // logged, so the value is cut at the first space.
  return directive.split(/\s+/)[0] ?? null
}

/**
 * Reduce a blocked URI to its origin.
 *
 * CSP reports use bare keywords for some violations ("inline", "eval",
 * "data", ...); those are kept as they are. Anything that parses as a URL is
 * reduced to protocol + host + port, which drops the path, the query string and
 * any credentials by construction.
 */
function blockedOriginOf(violation: Record<string, unknown> | null): string | null {
  const blocked = stringField(violation, "blocked-uri") ?? stringField(violation, "blockedURL")

  if (blocked === null) {
    return null
  }

  const lowered = blocked.toLowerCase()

  if (lowered === "inline" || lowered === "eval" || lowered === "self" || lowered === "data") {
    return lowered
  }

  try {
    const url = new URL(blocked)

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return url.origin
  } catch {
    return null
  }
}

// Both values end up in a log line, so the characters are limited to what a
// directive name and a URL origin actually use.
function sanitise(value: string, maxLength: number): string {
  return value.replace(/[^A-Za-z0-9._:*/-]/g, "").slice(0, maxLength)
}

export async function POST(request: Request): Promise<Response> {
  // Rate limited first, so an abusive client costs one cheap lookup and never a
  // body read or a log line.
  const ip = clientIpFromHeaders(request.headers)

  const limit = await rateLimit({
    key: rateLimitKey(["csp-report", "ip", ip]),
    limit: REPORTS_PER_MINUTE,
    windowSeconds: REPORT_WINDOW_SECONDS,
    onError: "allow",
  })

  if (!limit.allowed) {
    return noContent()
  }

  const mediaType = mediaTypeOf(request)

  if (mediaType === "other") {
    return noContent()
  }

  let body: string | null

  try {
    body = await readWithinCap(request, MAX_REPORT_BYTES)
  } catch {
    // A connection that dies mid-body is not worth a log line.
    return noContent()
  }

  if (body === null) {
    return new Response(null, { status: 413 })
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return noContent()
  }

  const violation = violationFrom(parsed)
  const directive = directiveOf(violation)
  const origin = blockedOriginOf(violation)

  if (directive !== null && origin !== null) {
    // One line, two facts, nothing that identifies a page or a person.
    console.warn(
      `csp-report: violated-directive=${sanitise(directive, MAX_DIRECTIVE_LENGTH)} blocked-uri=${sanitise(origin, MAX_ORIGIN_LENGTH)}`,
    )
  }

  return noContent()
}
