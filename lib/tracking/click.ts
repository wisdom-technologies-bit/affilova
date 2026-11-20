// The tracked link, as one testable function.
//
// /r/<code> is the only public way into the tracking feature, and it is a
// redirect: a person who follows a link must never wait for analytics. So every
// step either answers with a location or gives up on the click, and nothing on
// this path can throw to the visitor.
//
// The order is the point:
//   1. the code has to look like a code, or there is nothing to look up;
//   2. the rate limit runs before any database work;
//   3. a bot or a preview fetcher is redirected without a click and without a
//      cookie, because it is not a person and must not count;
//   4. a person gets a click row and a cookie, and is sent to the product.
//
// Anything unknown, archived or ineligible goes home with no cookie and no
// explanation, so a guessed code cannot be told apart from a dead one.

import {
  AFFILIATE_COOKIE_NAME,
  attributionCookieOptions,
  mergeAttribution,
  parseAttributionCookie,
  serialiseAttributionCookie,
} from "@/lib/tracking/cookie"
import { isBotOrPreview } from "@/lib/tracking/bots"
import { deviceFromUserAgent, parseClickParams, sanitiseCode } from "@/lib/tracking/params"
import type { RateLimitOptions, RateLimitResult } from "@/lib/rate-limit"

/** How many tracked links one client may follow in a minute. */
export const CLICK_RATE_LIMIT = 120

export const CLICK_RATE_WINDOW_SECONDS = 60

/**
 * The whole request budget. The route has to answer well inside a second, so a
 * database call that hangs is abandoned and the visitor goes home instead of
 * waiting.
 */
export const CLICK_DEADLINE_MS = 1200

/** The headers every answer carries, whatever the outcome. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
}

export interface RecordClickInput {
  clickId: string
  code: string
  ipHash: string
  uaHash: string
  referrerHost: string | null
  country: string | null
  device: string
  sub1: string | null
  sub2: string | null
  sub3: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

export interface RecordClickResult {
  ok: boolean
  productSlug: string | null
  /** The product the click belongs to: the cookie is keyed by it. */
  productId: string | null
}

export interface ClickDeps {
  rateLimit: (options: RateLimitOptions) => Promise<RateLimitResult>
  hashIp: (ip: string, now: Date) => string
  hashUa: (userAgent: string, now: Date) => string
  recordClick: (input: RecordClickInput) => Promise<RecordClickResult>
  getLinkTarget: (code: string) => Promise<string | null>
  /** Injected so a test can predict the click id. */
  newClickId: () => string
  now: () => Date
  /** The key builder from lib/rate-limit, injected so nothing raw is logged. */
  rateLimitKey: (parts: readonly string[]) => string
}

export interface ClickRequest {
  code: string
  searchParams: { get: (name: string) => string | null }
  headers: Headers
  /** The afv_ref cookie, already read from the request. */
  cookieValue: string | null
  /** True when NEXT_PUBLIC_APP_ENV is production. */
  production: boolean
  clientIp: string
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { ...BASE_HEADERS, Location: location, ...extra },
  })
}

/**
 * Resolve a promise, or null when the deadline passes first.
 *
 * The losing promise is left with a catch handler, so a late rejection is not an
 * unhandled one.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })

  try {
    return await Promise.race([promise.catch(() => null), deadline])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * The referrer's host, and only the host.
 *
 * A full referrer can carry a search query or a private path, so it is never
 * stored. An unparseable value is simply absent.
 */
export function referrerHost(referrer: string | null): string | null {
  if (referrer === null || referrer.trim() === "") {
    return null
  }

  try {
    const host = new URL(referrer).hostname.toLowerCase()

    return host === "" ? null : host
  } catch {
    return null
  }
}

/** The afv_ref value from a Cookie header, without decoding anything else. */
export function cookieValueFromHeader(header: string | null): string | null {
  if (header === null) {
    return null
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=")

    if (separator <= 0) {
      continue
    }

    if (part.slice(0, separator).trim() === AFFILIATE_COOKIE_NAME) {
      return part.slice(separator + 1).trim()
    }
  }

  return null
}

/** The Set-Cookie value for one merged cookie. */
export function attributionSetCookie(value: string, production: boolean): string {
  const options = attributionCookieOptions({ production })
  const parts = [
    `${AFFILIATE_COOKIE_NAME}=${value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
  ]

  if (options.secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

export async function handleClick(request: ClickRequest, deps: ClickDeps): Promise<Response> {
  // 1. The code has to be a code.
  const code = sanitiseCode(request.code)

  if (code === null) {
    return redirect("/")
  }

  // 2. The limit, before any database work. A limiter that cannot count lets the
  //    click through: a redirect is cheap and a broken counter is not a reason to
  //    stop sending people to the product.
  const limit = await deps.rateLimit({
    key: deps.rateLimitKey(["click", "ip", request.clientIp]),
    limit: CLICK_RATE_LIMIT,
    windowSeconds: CLICK_RATE_WINDOW_SECONDS,
    onError: "allow",
  })

  if (!limit.allowed) {
    return redirect("/")
  }

  const userAgent = request.headers.get("user-agent")

  // 3. A bot or a link preview: the product, but no click and no cookie.
  if (isBotOrPreview(userAgent)) {
    const slug = await withDeadline(deps.getLinkTarget(code), CLICK_DEADLINE_MS)

    return slug === null ? redirect("/") : redirect(`/p/${encodeURIComponent(slug)}`)
  }

  // 4. A person. The click is written first; the cookie is only set when the
  //    database accepted the click, so a cookie never points at nothing.
  const now = deps.now()
  const params = parseClickParams(request.searchParams)
  const clickId = deps.newClickId()
  const ipHash = deps.hashIp(request.clientIp, now)
  const uaHash = deps.hashUa(userAgent ?? "", now)

  const recorded = await withDeadline(
    deps.recordClick({
      clickId,
      code,
      ipHash,
      uaHash,
      referrerHost: referrerHost(request.headers.get("referer")),
      country: request.headers.get("x-vercel-ip-country"),
      device: deviceFromUserAgent(userAgent),
      ...params,
    }),
    CLICK_DEADLINE_MS,
  )

  if (recorded === null || !recorded.ok || recorded.productSlug === null || recorded.productId === null) {
    return redirect("/")
  }

  const merged = mergeAttribution(parseAttributionCookie(request.cookieValue), {
    productId: recorded.productId,
    clickId,
  })

  const value = serialiseAttributionCookie(merged)

  return redirect(`/p/${encodeURIComponent(recorded.productSlug)}`, {
    "Set-Cookie": attributionSetCookie(value, request.production),
  })
}
