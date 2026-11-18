/**
 * HMAC signing for scan result callbacks.
 *
 * The signature covers `${timestamp}.${rawBody}`, where the raw body is exactly
 * the JSON string that goes on the wire. Signing the serialised body rather than
 * the object means the receiver can verify without parsing first and without
 * worrying about key order or whitespace.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

const ALGORITHM = "sha256"

/**
 * Returns the lowercase hex HMAC-SHA256 of `${timestamp}.${rawBody}`.
 */
export function signCallbackBody(secret: string, timestamp: number, rawBody: string): string {
  return createHmac(ALGORITHM, secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")
}

/**
 * Constant time verification of a received callback signature.
 */
export function verifyCallbackSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signCallbackBody(secret, timestamp, rawBody), "utf8")
  const provided = Buffer.from(signature.toLowerCase(), "utf8")

  if (expected.length !== provided.length) {
    return false
  }

  return timingSafeEqual(expected, provided)
}
