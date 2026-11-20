import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { getOrderAccessSecret } from "@/lib/env"

// The buyer's download link.
//
// A token is `payload.signature`, both base64url, where the payload is a small
// JSON object and the signature is HMAC-SHA256 over the encoded payload. It
// carries the order id, a hash of the buyer's email and an expiry, and nothing
// else: no name, no address, no product, so a link that leaks says nothing about
// the person holding it beyond the order it belongs to.
//
// Verification is constant time and checks the expiry after the signature, so a
// tampered payload never reaches the expiry check.

/** Default life of a link, in days. */
export const ACCESS_TOKEN_DEFAULT_DAYS = 30

const MAX_DAYS = 365

const PAYLOAD_VERSION = 1

export interface AccessTokenClaims {
  orderId: string
  /** SHA-256 of the normalised email, truncated to 32 hex characters. */
  emailHash: string
  /** Unix seconds. */
  expiresAt: number
}

export type AccessTokenFailure = "malformed" | "invalid_signature" | "expired"

export type AccessTokenResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: AccessTokenFailure }

export interface AccessTokenDeps {
  /** The signing secret. Read through lib/env.ts by default. */
  secret?: string
  /** Injected clock, in milliseconds. */
  now?: () => number
}

interface WirePayload {
  v: number
  o: string
  e: string
  x: number
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function sign(secret: string, encodedPayload: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url")
}

function secretFor(deps: AccessTokenDeps): string {
  const secret = deps.secret ?? getOrderAccessSecret()

  if (secret.trim() === "") {
    throw new Error("ORDER_ACCESS_SECRET is required to sign or verify access links")
  }

  return secret
}

/** The email hash stored in the token: lowercased, trimmed, SHA-256, 32 hex. */
export function hashAccessEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32)
}

export interface CreateAccessTokenInput {
  orderId: string
  email: string
  expiresInDays?: number
}

/**
 * Build a signed access token for one order.
 *
 * Throws when the secret is missing: a link signed with an empty secret would be
 * forgeable by anyone, so it is better to fail the job and retry than to send it.
 */
export function createAccessToken(
  input: CreateAccessTokenInput,
  deps: AccessTokenDeps = {},
): string {
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : ""

  if (orderId === "") {
    throw new Error("createAccessToken needs an order id")
  }

  const email = typeof input.email === "string" ? input.email.trim() : ""

  if (email === "") {
    throw new Error("createAccessToken needs the buyer email")
  }

  const days = input.expiresInDays ?? ACCESS_TOKEN_DEFAULT_DAYS

  if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) {
    throw new Error(`createAccessToken: expiresInDays must be between 1 and ${MAX_DAYS}`)
  }

  const now = deps.now ?? Date.now
  const expiresAt = Math.floor(now() / 1000) + Math.round(days * 24 * 60 * 60)

  const payload: WirePayload = {
    v: PAYLOAD_VERSION,
    o: orderId,
    e: hashAccessEmail(email),
    x: expiresAt,
  }

  const encoded = encode(JSON.stringify(payload))

  return `${encoded}.${sign(secretFor(deps), encoded)}`
}

function isWirePayload(value: unknown): value is WirePayload {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    candidate.v === PAYLOAD_VERSION &&
    typeof candidate.o === "string" &&
    candidate.o !== "" &&
    typeof candidate.e === "string" &&
    /^[0-9a-f]{32}$/.test(candidate.e) &&
    typeof candidate.x === "number" &&
    Number.isInteger(candidate.x)
  )
}

/** Compare two base64url signatures without leaking where they differ. */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)

  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

/** Check a token and return its claims, or the reason it was refused. */
export function verifyAccessToken(token: string, deps: AccessTokenDeps = {}): AccessTokenResult {
  if (typeof token !== "string") {
    return { ok: false, reason: "malformed" }
  }

  const parts = token.split(".")

  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" }
  }

  const BASE64URL = /^[A-Za-z0-9_-]+$/

  if (!BASE64URL.test(parts[0] ?? "") || !BASE64URL.test(parts[1] ?? "")) {
    return { ok: false, reason: "malformed" }
  }

  const [encoded, signature] = parts as [string, string]

  let expected: string

  try {
    expected = sign(secretFor(deps), encoded)
  } catch {
    // No secret configured: nothing can be verified, and nothing is trusted.
    return { ok: false, reason: "invalid_signature" }
  }

  if (!signatureMatches(expected, signature)) {
    return { ok: false, reason: "invalid_signature" }
  }

  let payload: unknown

  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (!isWirePayload(payload)) {
    return { ok: false, reason: "malformed" }
  }

  const now = deps.now ?? Date.now

  if (payload.x * 1000 <= now()) {
    return { ok: false, reason: "expired" }
  }

  return {
    ok: true,
    claims: { orderId: payload.o, emailHash: payload.e, expiresAt: payload.x },
  }
}
