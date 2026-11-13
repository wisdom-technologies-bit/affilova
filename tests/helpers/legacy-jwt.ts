import { SignJWT } from "jose"

import type { JWTPayload } from "@/lib/auth"

// Fixtures shared by the legacy auth tests. Nothing here touches the network:
// tokens are signed locally with the same library the app uses.

export const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef"
export const OTHER_JWT_SECRET = "fedcba9876543210fedcba9876543210"

export const adminPayload: JWTPayload = {
  userId: "usr_admin",
  alphanumericId: "ADM0001",
  email: "admin@example.com",
  role: "admin",
}

export const vendorPayload: JWTPayload = {
  userId: "usr_vendor",
  alphanumericId: "VND0001",
  email: "vendor@example.com",
  role: "vendor",
}

export const affiliatePayload: JWTPayload = {
  userId: "usr_affiliate",
  alphanumericId: "AFF0001",
  email: "affiliate@example.com",
  role: "affiliate",
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

/** An unsigned token with alg "none", the shape an attacker would try. */
export function unsignedToken(payload: JWTPayload = adminPayload): string {
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`
}

/** A token signed with an arbitrary algorithm, used to prove alg pinning. */
export async function signTokenWithAlgorithm(
  payload: JWTPayload,
  algorithm: "HS384" | "HS512",
  secret: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret))
}

/** An already expired token. */
export async function expiredToken(
  payload: JWTPayload,
  secret: string,
): Promise<string> {
  const expiredAt = Math.floor(Date.now() / 1000) - 60

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(expiredAt - 60)
    .setExpirationTime(expiredAt)
    .sign(new TextEncoder().encode(secret))
}
