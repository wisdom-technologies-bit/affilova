import "server-only"

import { createHash, createHmac } from "node:crypto"

import { getTrackingEnv } from "@/lib/env"

// The hashes stored on a click.
//
// An IP address and a user agent are personal data, and a plain SHA-256 of an
// address is not anonymous: the whole IPv4 space is small enough to hash in
// minutes. So the digest is salted with a secret and with the UTC date, which
// means the same visitor has a different hash tomorrow. That is enough to count
// "this device, this link, in the last 30 minutes" and not enough to follow
// anyone across days.
//
// Nothing here returns, logs or throws a raw value: every function's answer is a
// hex digest.

/** A namespace so a click salt can never collide with another use of the secret. */
const SALT_LABEL = "affiliate-click-salt"

/** The UTC day a moment belongs to, as YYYY-MM-DD. The salt rotates on this. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * The salt for one UTC day: HMAC-SHA256 of "<label>:<day>" keyed by the secret.
 *
 * Exported for the tests, and because it is the whole rotation rule in one
 * readable place.
 */
export function dailySalt(secret: string, now: Date): string {
  return createHmac("sha256", secret).update(`${SALT_LABEL}:${utcDay(now)}`).digest("hex")
}

/**
 * SHA-256 of "<salt>:<value>".
 *
 * The salt goes first so a value can never be crafted to look like a salt
 * prefix. The separator is a colon, which cannot appear in the salt (hex) and
 * keeps the two parts unambiguous.
 */
export function hashWithSalt(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex")
}

/**
 * The hash stored in affiliate_clicks.ip_hash.
 *
 * `now` is required on purpose: a caller has to say which day it is hashing for,
 * so a test can prove the rotation and a retry cannot silently land on a
 * different day.
 */
export function hashIp(ip: string, now: Date): string {
  const { CLICK_HASH_SECRET } = getTrackingEnv()

  return hashWithSalt(ip.trim(), dailySalt(CLICK_HASH_SECRET, now))
}

/**
 * The hash stored in affiliate_clicks.ua_hash.
 *
 * It rotates on the same daily salt, so a device is recognisable within a day
 * and not across two.
 */
export function hashUa(userAgent: string, now: Date = new Date()): string {
  const { CLICK_HASH_SECRET } = getTrackingEnv()

  return hashWithSalt(userAgent.trim(), dailySalt(CLICK_HASH_SECRET, now))
}
