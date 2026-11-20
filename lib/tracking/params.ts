// What a tracked link is allowed to carry.
//
// Every value here comes from the URL, which means it comes from whoever sent
// the link. So each one is either cut down to a known shape or dropped: nothing
// is passed to the database as it arrived.

/** The longest code or alias a link may have. Matches the link CHECK in SQL. */
export const MAX_CODE_LENGTH = 40

/** The longest sub id or campaign value kept. Matches the click CHECK in SQL. */
export const MAX_LABEL_LENGTH = 60

/** A code or alias: lowercase letters, digits and hyphens, 4 to 40 characters. */
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/

/** A label, sub id or campaign value: lowercase letters, digits, hyphen, underscore. */
const LABEL_PATTERN = /^[a-z0-9_-]+$/

/**
 * The code from /r/<code>, or null when it cannot be a code.
 *
 * A null answer is not an error to report: the route sends the visitor home, and
 * a stranger learns nothing about whether a link with a similar name exists.
 */
export function sanitiseCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const code = value.trim().toLowerCase()

  if (code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return null
  }

  return CODE_PATTERN.test(code) ? code : null
}

/**
 * A sub id or campaign value, or null.
 *
 * Anything that is not plainly a word (a quote, a space, an angle bracket, an
 * emoji, a value pasted from another language) is dropped rather than cleaned
 * up: a half-sanitised value is worse than no value, because it looks
 * intentional.
 */
export function sanitiseLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const label = value.trim().toLowerCase()

  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    return null
  }

  return LABEL_PATTERN.test(label) ? label : null
}

export interface ClickParams {
  sub1: string | null
  sub2: string | null
  sub3: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

export type SearchParamsLike = {
  get: (name: string) => string | null
}

/**
 * The tracking parameters on the link, already sanitised.
 *
 * s1, s2 and s3 are the affiliate's own names for a placement. The utm_* pair is
 * what every other analytics tool understands. Both are kept because an
 * affiliate may use either, and neither is required.
 */
export function parseClickParams(searchParams: SearchParamsLike): ClickParams {
  return {
    sub1: sanitiseLabel(searchParams.get("s1")),
    sub2: sanitiseLabel(searchParams.get("s2")),
    sub3: sanitiseLabel(searchParams.get("s3")),
    utmSource: sanitiseLabel(searchParams.get("utm_source")),
    utmMedium: sanitiseLabel(searchParams.get("utm_medium")),
    utmCampaign: sanitiseLabel(searchParams.get("utm_campaign")),
  }
}

export type ClickDevice = "mobile" | "desktop" | "tablet" | "other"

/** iPad and other tablets say "tablet", or carry a mobile token without "Mobile". */
export function deviceFromUserAgent(userAgent: string | null | undefined): ClickDevice {
  if (typeof userAgent !== "string") {
    return "other"
  }

  const value = userAgent.toLowerCase()

  if (value.trim() === "") {
    return "other"
  }

  if (value.includes("ipad") || value.includes("tablet") || value.includes("playbook")) {
    return "tablet"
  }

  // An Android tablet omits "Mobile"; an Android phone includes it.
  if (value.includes("android") && !value.includes("mobile")) {
    return "tablet"
  }

  if (
    value.includes("mobile") ||
    value.includes("iphone") ||
    value.includes("ipod") ||
    value.includes("windows phone")
  ) {
    return "mobile"
  }

  if (value.includes("mozilla") || value.includes("windows") || value.includes("macintosh") || value.includes("linux")) {
    return "desktop"
  }

  return "other"
}
