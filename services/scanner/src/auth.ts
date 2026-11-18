/**
 * Bearer token authentication for `POST /scan`.
 *
 * The comparison is constant time: both values are hashed with SHA-256 first so
 * `timingSafeEqual` always receives two buffers of the same length regardless of
 * what the caller sent. A missing, malformed or wrong token is reported as a
 * plain `false`; callers must answer 401 without any detail.
 */

import { createHash, timingSafeEqual } from "node:crypto"

const SCHEME = "bearer"

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

/**
 * Extracts the token from an `Authorization` header value, or returns null when
 * the header is absent or uses another scheme.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null
  }

  const separator = header.indexOf(" ")

  if (separator <= 0) {
    return null
  }

  const scheme = header.slice(0, separator).toLowerCase()

  if (scheme !== SCHEME) {
    return null
  }

  const token = header.slice(separator + 1).trim()

  if (token === "") {
    return null
  }

  return token
}

/**
 * Constant time check of an `Authorization` header against the shared secret.
 */
export function isAuthorized(header: string | undefined, secret: string): boolean {
  const token = extractBearerToken(header)

  if (token === null || secret === "") {
    return false
  }

  return timingSafeEqual(digest(token), digest(secret))
}
