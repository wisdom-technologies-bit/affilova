import { createHmac, timingSafeEqual } from "node:crypto"

// The scanner signs its callback, and only this module decides what a good
// signature is.
//
// The signed string is `${timestamp}.${rawBody}`: the timestamp is inside the
// signature, so a body cannot be replayed later with a fresh timestamp, and the
// raw bytes are used, not a re-serialised object, so field order and whitespace
// cannot change the meaning.
//
// Nothing here logs. A secret, a signature and a body all belong to somebody
// else's traffic.

/** How far a callback timestamp may be from our clock, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300

const HEX_SHA256 = /^[0-9a-f]{64}$/
const DIGITS = /^[0-9]{1,12}$/

/** The hex HMAC-SHA256 of `${timestamp}.${rawBody}` under `secret`. */
export function signCallback(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

export type CallbackRejection =
  | "missing_headers"
  | "malformed_signature"
  | "malformed_timestamp"
  | "signature_mismatch"
  | "timestamp_out_of_window"

export interface VerifyCallbackInput {
  secret: string
  /** The X-Scanner-Timestamp header, unix seconds. */
  timestamp: string | null
  /** The X-Scanner-Signature header, lowercase or uppercase hex. */
  signature: string | null
  /** The exact bytes the scanner sent. */
  rawBody: string
  /** Our clock in unix seconds. Injected so the window can be tested. */
  now: number
  toleranceSeconds?: number
}

export type VerifyCallbackResult = { ok: true } | { ok: false; reason: CallbackRejection }

/**
 * Is this callback genuinely from the scanner, and recent enough to act on?
 *
 * Every rejection is one of five fixed reasons and carries no detail, so a
 * caller can answer 401 without hinting at which part failed.
 */
export function verifyCallback(input: VerifyCallbackInput): VerifyCallbackResult {
  const { secret, timestamp, signature, rawBody, now } = input
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS

  if (timestamp === null || signature === null || timestamp === "" || signature === "") {
    return { ok: false, reason: "missing_headers" }
  }

  const expected = signCallback(secret, timestamp, rawBody).toLowerCase()
  const provided = signature.trim().toLowerCase()

  // A length check first: timingSafeEqual throws on different lengths, and a
  // wrong-length value is not a signature at all.
  if (!HEX_SHA256.test(provided)) {
    return { ok: false, reason: "malformed_signature" }
  }

  const expectedBytes = Buffer.from(expected, "hex")
  const providedBytes = Buffer.from(provided, "hex")

  if (expectedBytes.length !== providedBytes.length) {
    return { ok: false, reason: "malformed_signature" }
  }

  // Constant time: the comparison must not reveal how many leading characters
  // were right.
  if (!timingSafeEqual(expectedBytes, providedBytes)) {
    return { ok: false, reason: "signature_mismatch" }
  }

  if (!DIGITS.test(timestamp)) {
    return { ok: false, reason: "malformed_timestamp" }
  }

  const sentAt = Number.parseInt(timestamp, 10)

  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "malformed_timestamp" }
  }

  if (Math.abs(now - sentAt) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_window" }
  }

  return { ok: true }
}
