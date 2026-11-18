/**
 * SSRF guards for the two URLs that arrive in a scan request.
 *
 * `downloadUrl` is fetched by this service, so it is restricted to https, a
 * default port, no embedded credentials, a non-literal host that ends with the
 * configured storage suffix. `callbackUrl` is posted to by this service, so it
 * is restricted to https and an exact origin from the allowlist, at the fixed
 * result path.
 *
 * Every check works on the parsed URL rather than the raw string: the WHATWG
 * parser normalises case, resolves the authority and exposes userinfo, which is
 * what makes tricks like `https://a.r2.cloudflarestorage.com@evil.com` visible.
 */

export const CALLBACK_PATH = "/api/internal/scan-result"

export type UrlAccepted = { readonly ok: true; readonly url: URL }

export type UrlRejected = { readonly ok: false; readonly reason: string }

export type UrlCheck = UrlAccepted | UrlRejected

const BRACKETED_HOST = /^\[/

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

const NUMERIC_HOST = /^(?:0x[0-9a-f]+|\d+)$/i

function reject(reason: string): UrlRejected {
  return { ok: false, reason }
}

/**
 * True for anything the URL parser leaves looking like an address rather than a
 * name: dotted IPv4, bracketed IPv6, and the integer/hex forms that resolvers
 * accept as IPv4 (`2130706433`, `0x7f000001`).
 */
export function isIpLiteralHost(hostname: string): boolean {
  return BRACKETED_HOST.test(hostname) || IPV4_LITERAL.test(hostname) || NUMERIC_HOST.test(hostname) || hostname.includes(":")
}

function parseHttpsUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string" || raw.trim() === "") {
    return reject("must be a non-empty string")
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return reject("is not a valid URL")
  }

  if (url.protocol !== "https:") {
    return reject("must use https")
  }

  if (url.username !== "" || url.password !== "") {
    return reject("must not embed credentials")
  }

  if (url.hostname.endsWith(".")) {
    return reject("must not use a trailing dot in the host")
  }

  if (isIpLiteralHost(url.hostname)) {
    return reject("must not use an IP literal")
  }

  return { ok: true, url }
}

/**
 * Validates an object download URL against the storage host suffix.
 */
export function checkDownloadUrl(raw: unknown, allowedHostSuffix: string): UrlCheck {
  const parsed = parseHttpsUrl(raw)

  if (!parsed.ok) {
    return parsed
  }

  if (parsed.url.port !== "") {
    return reject("must not use a non-default port")
  }

  const suffix = allowedHostSuffix.toLowerCase()
  const host = parsed.url.hostname

  if (!host.endsWith(suffix)) {
    return reject("host is not an allowed storage host")
  }

  if (host.length <= suffix.length) {
    return reject("host is missing a bucket label")
  }

  return parsed
}

/**
 * Validates a callback URL against the origin allowlist and the fixed result
 * path.
 */
export function checkCallbackUrl(raw: unknown, allowedOrigins: readonly string[]): UrlCheck {
  const parsed = parseHttpsUrl(raw)

  if (!parsed.ok) {
    return parsed
  }

  if (!allowedOrigins.includes(parsed.url.origin)) {
    return reject("origin is not allowed")
  }

  if (parsed.url.pathname !== CALLBACK_PATH) {
    return reject(`path must be ${CALLBACK_PATH}`)
  }

  if (parsed.url.search !== "") {
    return reject("must not include a query string")
  }

  if (parsed.url.hash !== "") {
    return reject("must not include a fragment")
  }

  return parsed
}
