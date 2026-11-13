import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
  sets: [] as { name: string; value: string; options?: Record<string, unknown> }[],
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieState.values.set(name, value)
      cookieState.sets.push({ name, value, options })
    },
    delete: (name: string) => {
      cookieState.values.delete(name)
    },
  }),
}))

import {
  createToken,
  getJwtSecret,
  getSession,
  requireRole,
  setAuthCookie,
  verifyToken,
} from "@/lib/auth"
import {
  OTHER_JWT_SECRET,
  TEST_JWT_SECRET,
  adminPayload,
  expiredToken,
  signTokenWithAlgorithm,
  unsignedToken,
  vendorPayload,
} from "@/tests/helpers/legacy-jwt"

const originalSecret = process.env.JWT_SECRET

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  cookieState.values.clear()
  cookieState.sets.length = 0
})

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = originalSecret
  }
})

describe("getJwtSecret", () => {
  it("throws when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET

    expect(() => getJwtSecret()).toThrow("JWT_SECRET is not configured")
  })

  it("throws when JWT_SECRET is blank", () => {
    process.env.JWT_SECRET = "   "

    expect(() => getJwtSecret()).toThrow("JWT_SECRET is not configured")
  })

  it("throws when JWT_SECRET is 31 characters", () => {
    process.env.JWT_SECRET = "a".repeat(31)

    expect(() => getJwtSecret()).toThrow("JWT_SECRET is not configured")
  })

  it("returns the encoded secret when JWT_SECRET is 32 characters", () => {
    const secret = "b".repeat(32)
    process.env.JWT_SECRET = secret

    expect(getJwtSecret()).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(getJwtSecret())).toBe(secret)
  })

  it("reads the environment on every call", () => {
    process.env.JWT_SECRET = "c".repeat(32)
    expect(new TextDecoder().decode(getJwtSecret())).toBe("c".repeat(32))

    process.env.JWT_SECRET = "d".repeat(40)
    expect(new TextDecoder().decode(getJwtSecret())).toBe("d".repeat(40))
  })
})

describe("verifyToken", () => {
  it("returns the payload for a token signed with the configured secret", async () => {
    const token = await createToken(adminPayload)

    await expect(verifyToken(token)).resolves.toEqual(adminPayload)
  })

  it("returns null for a token signed with a different secret", async () => {
    const token = await new SignJWT({ ...adminPayload })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(OTHER_JWT_SECRET))

    await expect(verifyToken(token)).resolves.toBeNull()
  })

  it("returns null for an alg none token", async () => {
    await expect(verifyToken(unsignedToken())).resolves.toBeNull()
  })

  it("returns null for a token signed with an algorithm other than HS256", async () => {
    const token = await signTokenWithAlgorithm(adminPayload, "HS512", TEST_JWT_SECRET.repeat(2))

    await expect(verifyToken(token)).resolves.toBeNull()
  })

  it("returns null for an expired token", async () => {
    const token = await expiredToken(adminPayload, TEST_JWT_SECRET)

    await expect(verifyToken(token)).resolves.toBeNull()
  })

  it("returns null when JWT_SECRET is missing", async () => {
    const token = await createToken(adminPayload)
    delete process.env.JWT_SECRET

    await expect(verifyToken(token)).resolves.toBeNull()
  })

  it("returns null when the token has no session shape", async () => {
    const token = await new SignJWT({ sub: "usr_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(TEST_JWT_SECRET))

    await expect(verifyToken(token)).resolves.toBeNull()
  })
})

describe("getSession", () => {
  it("returns null without an auth-token cookie", async () => {
    await expect(getSession()).resolves.toBeNull()
  })

  it("returns the session for a valid auth-token cookie", async () => {
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    await expect(getSession()).resolves.toEqual(vendorPayload)
  })

  it("returns null for a valid token stored under another cookie name", async () => {
    cookieState.values.set("auth_token", await createToken(vendorPayload))

    await expect(getSession()).resolves.toBeNull()
  })
})

describe("setAuthCookie", () => {
  it("stores the token in the auth-token cookie with the existing options", async () => {
    const token = await createToken(vendorPayload)

    await setAuthCookie(token)

    expect(cookieState.sets).toHaveLength(1)
    expect(cookieState.sets[0]).toEqual({
      name: "auth-token",
      value: token,
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      },
    })
  })
})

describe("requireRole", () => {
  it("answers 401 when there is no session", async () => {
    await expect(requireRole(["admin"])).resolves.toEqual({ ok: false, status: 401 })
  })

  it("answers 401 when the auth-token cookie is not a valid token", async () => {
    cookieState.values.set("auth-token", unsignedToken())

    await expect(requireRole(["admin"])).resolves.toEqual({ ok: false, status: 401 })
  })

  it("answers 403 when the role is not allowed", async () => {
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    await expect(requireRole(["admin"])).resolves.toEqual({ ok: false, status: 403 })
  })

  it("returns the session when the role is allowed", async () => {
    cookieState.values.set("auth-token", await createToken(adminPayload))

    await expect(requireRole(["admin"])).resolves.toEqual({
      ok: true,
      session: adminPayload,
    })
  })
})
