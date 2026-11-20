// The first-party attribution cookie.
//
// One cookie holds the last click for up to twenty products, as
// "<productId>:<clickId>" joined by "|". A new click for a product replaces that
// product's entry and moves it to the end; past twenty entries the oldest one is
// dropped. That is the whole "last click wins, per product" rule, in one place.
//
// The cookie is not a source of truth. Checkout reads a click id out of it and
// asks the database whether that click is real, belongs to this product, is
// inside the window and still has an eligible affiliate. A forged cookie gets a
// null back, not an affiliate.

/** The cookie name. It is written in docs/tracking.md and in the cookie policy. */
export const AFFILIATE_COOKIE_NAME = "afv_ref"

/** How long a click is remembered, in days. Mirrors attribution_window_days. */
export const AFFILIATE_COOKIE_DAYS = 30

/** The most products one cookie remembers. Twenty is about 1.5 KB. */
export const MAX_COOKIE_ENTRIES = 20

/**
 * The longest value that is even looked at.
 *
 * Twenty entries need about 1.5 KB, so 4 KB leaves room and still refuses a
 * value a browser or an attacker padded to the header limit.
 */
export const MAX_COOKIE_LENGTH = 4096

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AttributionEntry {
  productId: string
  clickId: string
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * The entries in a cookie value, oldest first.
 *
 * Defensive on purpose: the value is written by this app but read from a
 * request, so it may be truncated, doubled, hand-edited or not ours at all. A
 * malformed pair is skipped, a repeated product keeps its last entry, and an
 * oversized value is treated as empty rather than parsed.
 */
export function parseAttributionCookie(value: string | null | undefined): AttributionEntry[] {
  if (typeof value !== "string") {
    return []
  }

  const raw = value.trim()

  if (raw === "" || raw.length > MAX_COOKIE_LENGTH) {
    return []
  }

  const byProduct = new Map<string, string>()

  for (const part of raw.split("|")) {
    const separator = part.indexOf(":")

    if (separator <= 0) {
      continue
    }

    const productId = part.slice(0, separator).trim()
    const clickId = part.slice(separator + 1).trim()

    if (!isUuid(productId) || !isUuid(clickId)) {
      continue
    }

    // A repeated product moves to the end: the later pair is the newer click.
    byProduct.delete(productId)
    byProduct.set(productId, clickId)
  }

  const entries: AttributionEntry[] = []

  for (const [productId, clickId] of byProduct) {
    entries.push({ productId, clickId })
  }

  return entries.slice(-MAX_COOKIE_ENTRIES)
}

/** The cookie value for these entries. The oldest entry goes past twenty. */
export function serialiseAttributionCookie(entries: readonly AttributionEntry[]): string {
  return entries
    .slice(-MAX_COOKIE_ENTRIES)
    .map((entry) => `${entry.productId}:${entry.clickId}`)
    .join("|")
}

/**
 * Add one click to the entries, replacing any earlier click for that product.
 *
 * The new entry goes last, so it is the last to be dropped.
 */
export function mergeAttribution(
  entries: readonly AttributionEntry[],
  next: AttributionEntry,
): AttributionEntry[] {
  const kept = entries.filter((entry) => entry.productId !== next.productId)

  return [...kept, next].slice(-MAX_COOKIE_ENTRIES)
}

/** The click id remembered for one product, or null. */
export function readClickId(value: string | null | undefined, productId: string): string | null {
  const entries = parseAttributionCookie(value)

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]

    if (entry !== undefined && entry.productId === productId) {
      return entry.clickId
    }
  }

  return null
}

export interface AttributionCookieOptions {
  httpOnly: true
  sameSite: "lax"
  path: "/"
  secure: boolean
  maxAge: number
}

/**
 * The options every write uses.
 *
 * HttpOnly, so a script on the page cannot read or rewrite it; SameSite=Lax, so
 * a link opened from another site still arrives with it; Secure only in
 * production, because a local development server is plain HTTP.
 */
export function attributionCookieOptions(input: { production: boolean }): AttributionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: input.production,
    maxAge: AFFILIATE_COOKIE_DAYS * 24 * 60 * 60,
  }
}
