// The invitation token, and the hash the database keeps.
//
// The plain token exists in exactly two places: the response to the vendor who
// created it, and the link they share. The database stores only its SHA-256, so
// a copy of the table cannot be turned into a working invitation.

import { createHash, randomBytes } from "node:crypto"

/** 32 random bytes, url-safe: 43 characters, no padding. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

/** SHA-256 hex of the token. This is the only form stored. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
