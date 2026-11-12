import { createHash, timingSafeEqual } from "node:crypto"

// The only accepted header format is "Bearer <secret>", with "Bearer" spelled
// exactly like that.

const BEARER_PREFIX = "Bearer "

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

/**
 * True only when the Authorization header is exactly `Bearer <expectedSecret>`.
 *
 * Both sides are hashed before they are compared, so the comparison is always
 * between two 32 byte buffers: timingSafeEqual cannot throw on a length
 * mismatch and the length of the real secret is never revealed.
 */
export function isValidCronSecret(
  authorizationHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!authorizationHeader || !expectedSecret) {
    return false
  }

  if (!authorizationHeader.startsWith(BEARER_PREFIX)) {
    return false
  }

  const provided = authorizationHeader.slice(BEARER_PREFIX.length)

  if (provided === "") {
    return false
  }

  return timingSafeEqual(sha256(provided), sha256(expectedSecret))
}
