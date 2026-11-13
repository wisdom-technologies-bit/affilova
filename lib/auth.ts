import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"

// A secret shorter than this is not worth signing a session with.
const MIN_JWT_SECRET_LENGTH = 32

export interface JWTPayload {
  userId: string
  alphanumericId: string
  email: string
  role: string
}

export type RequireRoleResult =
  | { ok: true; session: JWTPayload }
  | { ok: false; status: 401 | 403 }

/**
 * The token signing secret, read from the environment on every call.
 *
 * There is deliberately no fallback: a missing secret is a configuration error,
 * never a reason to sign with a value that is published in the repository.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET

  if (!secret || secret.trim() === "" || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error("JWT_SECRET is not configured")
  }

  return new TextEncoder().encode(secret)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret())
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    // Only HS256 tokens are ours: pinning the algorithm keeps unsigned ("none")
    // and differently signed tokens out.
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] })

    if (
      typeof payload.userId !== "string" ||
      typeof payload.alphanumericId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null
    }

    return {
      userId: payload.userId,
      alphanumericId: payload.alphanumericId,
      email: payload.email,
      role: payload.role,
    }
  } catch {
    // Fail closed: an unreadable token, a missing secret or a bad signature all
    // mean "no session".
    return null
  }
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  })
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("auth-token")?.value

  if (!token) {
    return null
  }

  return verifyToken(token)
}

/**
 * Gate a route on the signed in user's role.
 *
 * 401 when there is no valid session, 403 when the role is not allowed.
 */
export async function requireRole(allowed: readonly string[]): Promise<RequireRoleResult> {
  const session = await getSession()

  if (!session) {
    return { ok: false, status: 401 }
  }

  if (!allowed.includes(session.role)) {
    return { ok: false, status: 403 }
  }

  return { ok: true, session }
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.delete("auth-token")
}

export const verifyAuth = getSession
