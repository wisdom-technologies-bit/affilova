import { createHmac, timingSafeEqual } from "node:crypto"

// Webhook authenticity.
//
// Paystack documents two headers, and this module checks both:
//
//   x-paystack-signature   HMAC-SHA512 of the raw request body, keyed with the
//                          secret key (sk_...). Lowercase hex, 128 characters,
//                          no timestamp. This is what events carry today.
//   Paystack-Signature     t=<unix seconds>,v1=<key id>:<signature>. The
//                          signature is HMAC-SHA512 over "<t>.<raw body>",
//                          keyed with the webhook signing secret (whsec_...).
//                          An event may carry several v1 values, one per key
//                          during a rotation.
//
// Both are compared in constant time. The body must be the bytes Paystack sent:
// parsing and re-serialising it changes the bytes and every check fails.

export const PAYSTACK_SIGNATURE_HEADER = "x-paystack-signature"
export const PAYSTACK_SIGNATURE_V1_HEADER = "paystack-signature"

/** The documented tolerance for the timestamp in the newer header. */
export const PAYSTACK_SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * The source addresses Paystack documents for webhooks. The list is the same in
 * test and live mode.
 */
export const PAYSTACK_WEBHOOK_IPS: readonly string[] = [
  "52.31.139.75",
  "52.49.173.169",
  "52.214.14.220",
]

const LOWER_HEX_128 = /^[0-9a-f]{128}$/

export type SignatureScheme = "legacy" | "v1"

export type SignatureFailure = "missing" | "malformed" | "mismatch" | "expired"

export type SignatureCheck = { ok: true; scheme: SignatureScheme } | { ok: false; reason: SignatureFailure }

export interface SignatureCheckInput {
  /** The exact bytes of the request body. */
  rawBody: Uint8Array
  /** The x-paystack-signature header, if it was sent. */
  legacySignature: string | null
  /** The Paystack-Signature header, if it was sent. */
  v1Signature: string | null
  /** The secret key, used by the legacy header. */
  secretKey: string
  /** The webhook signing secret, used by the newer header. */
  webhookSecret?: string | undefined
  /** Unix seconds. Injected so a test can age a header without waiting. */
  nowSeconds?: number
  toleranceSeconds?: number
}

function hmacSha512(key: string, body: Uint8Array): Buffer {
  return createHmac("sha512", key).update(body).digest()
}

/** Equal length is required by timingSafeEqual, so it is checked first. */
function sameHex(expected: Buffer, candidate: string): boolean {
  if (!LOWER_HEX_128.test(candidate)) {
    return false
  }

  const given = Buffer.from(candidate, "hex")

  if (given.length !== expected.length) {
    return false
  }

  return timingSafeEqual(expected, given)
}

/** The legacy header: HMAC-SHA512 of the body, keyed with the secret key. */
function checkLegacy(input: SignatureCheckInput): SignatureCheck {
  const header = input.legacySignature

  if (header === null || header.trim() === "") {
    return { ok: false, reason: "missing" }
  }

  if (!LOWER_HEX_128.test(header.trim())) {
    return { ok: false, reason: "malformed" }
  }

  const expected = hmacSha512(input.secretKey, input.rawBody)

  return sameHex(expected, header.trim())
    ? { ok: true, scheme: "legacy" }
    : { ok: false, reason: "mismatch" }
}

interface V1Entry {
  timestamp: string
  signatures: readonly string[]
}

function parseV1Header(header: string): V1Entry | null {
  const timestamp: string[] = []
  const signatures: string[] = []

  for (const part of header.split(",")) {
    const trimmed = part.trim()

    if (trimmed === "") {
      continue
    }

    const separator = trimmed.indexOf("=")

    if (separator === -1) {
      // Any other field in the header is ignored, as the documentation says.
      continue
    }

    const name = trimmed.slice(0, separator)
    const value = trimmed.slice(separator + 1)

    if (name === "t") {
      timestamp.push(value)
      continue
    }

    if (name !== "v1") {
      continue
    }

    // v1 is "<key id>:<signature>"; the signature is after the first colon.
    const colon = value.indexOf(":")

    if (colon === -1) {
      continue
    }

    signatures.push(value.slice(colon + 1))
  }

  if (timestamp.length !== 1 || signatures.length === 0) {
    return null
  }

  return { timestamp: timestamp[0] as string, signatures }
}

/** The newer header: HMAC-SHA512 of "<t>.<body>", keyed with the signing secret. */
function checkV1(input: SignatureCheckInput): SignatureCheck {
  const header = input.v1Signature

  if (header === null || header.trim() === "") {
    return { ok: false, reason: "missing" }
  }

  const secret = input.webhookSecret

  if (secret === undefined || secret === "") {
    // The header is present but this deployment holds no signing secret, so it
    // cannot be checked. Fail closed rather than trusting an unverified body.
    return { ok: false, reason: "mismatch" }
  }

  const parsed = parseV1Header(header)

  if (parsed === null) {
    return { ok: false, reason: "malformed" }
  }

  if (!/^[0-9]{1,12}$/.test(parsed.timestamp)) {
    return { ok: false, reason: "malformed" }
  }

  const tolerance = input.toleranceSeconds ?? PAYSTACK_SIGNATURE_TOLERANCE_SECONDS
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)

  if (Math.abs(now - Number(parsed.timestamp)) > tolerance) {
    return { ok: false, reason: "expired" }
  }

  const signed = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    Buffer.from(input.rawBody),
  ])
  const expected = createHmac("sha512", secret).update(signed).digest()

  for (const signature of parsed.signatures) {
    if (sameHex(expected, signature)) {
      return { ok: true, scheme: "v1" }
    }
  }

  return { ok: false, reason: "mismatch" }
}

/**
 * Accepts a delivery when either documented header checks out.
 *
 * The legacy header is tried first because it is what events carry today; the
 * newer header is the one Paystack issues once a signing secret exists.
 */
export function verifyWebhookSignature(input: SignatureCheckInput): SignatureCheck {
  const legacy = checkLegacy(input)

  if (legacy.ok) {
    return legacy
  }

  const v1 = checkV1(input)

  if (v1.ok) {
    return v1
  }

  // The most specific failure wins, so a log line says "expired" rather than
  // "missing" when a timestamp is the actual problem.
  if (v1.reason === "expired") {
    return { ok: false, reason: "expired" }
  }

  if (legacy.reason === "mismatch" || v1.reason === "mismatch") {
    return { ok: false, reason: "mismatch" }
  }

  if (legacy.reason === "malformed" || v1.reason === "malformed") {
    return { ok: false, reason: "malformed" }
  }

  return { ok: false, reason: "missing" }
}

/**
 * The client address, from the proxy chain. Only the first entry of
 * x-forwarded-for is the caller.
 */
export function sourceIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")

  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim() ?? ""

    if (first !== "") {
      return first
    }
  }

  const realIp = headers.get("x-real-ip")?.trim() ?? ""

  return realIp === "" ? "unknown" : realIp
}

/** True when the address is one Paystack documents, IPv4-mapped IPv6 included. */
export function isPaystackSourceIp(ip: string): boolean {
  const normalised = ip.trim().replace(/^::ffff:/i, "")

  return PAYSTACK_WEBHOOK_IPS.includes(normalised)
}
