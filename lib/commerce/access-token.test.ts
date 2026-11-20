import { describe, expect, it } from "vitest"

import {
  ACCESS_TOKEN_DEFAULT_DAYS,
  createAccessToken,
  hashAccessEmail,
  verifyAccessToken,
} from "./access-token"

const SECRET = "0123456789abcdef0123456789abcdef"
const ORDER = "3f1b9c62-8d1e-4f27-9a53-1c0f5b2e7d41"
const EMAIL = "Buyer@Example.com"

const NOW = new Date("2026-11-18T12:00:00.000Z")

function deps(overrides: { secret?: string; now?: () => number } = {}) {
  return {
    secret: overrides.secret ?? SECRET,
    now: overrides.now ?? (() => NOW.getTime()),
  }
}

describe("access tokens", () => {
  it("round-trips the order id and the email hash", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())
    const result = verifyAccessToken(token, deps())

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.claims.orderId).toBe(ORDER)
      expect(result.claims.emailHash).toBe(hashAccessEmail(EMAIL))
      expect(result.claims.expiresAt).toBe(
        Math.floor(NOW.getTime() / 1000) + ACCESS_TOKEN_DEFAULT_DAYS * 24 * 60 * 60,
      )
    }
  })

  it("carries no personal data beyond the order id and a hash", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())
    const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"))

    expect(Object.keys(payload).sort()).toEqual(["e", "o", "v", "x"])
    expect(JSON.stringify(payload)).not.toContain("Buyer")
    expect(JSON.stringify(payload)).not.toContain("example.com")
  })

  it("is url safe: two base64url segments and nothing to escape", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it("refuses a tampered payload", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())
    const [payload, signature] = token.split(".")
    const decoded = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"))
    const forged = Buffer.from(JSON.stringify({ ...decoded, o: "another-order" })).toString("base64url")

    const result = verifyAccessToken(`${forged}.${signature ?? ""}`, deps())

    expect(result).toEqual({ ok: false, reason: "invalid_signature" })
  })

  it("refuses a tampered signature", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())
    const [payload, signature] = token.split(".")
    const flipped = `${(signature ?? "").slice(0, -1)}${(signature ?? "").endsWith("A") ? "B" : "A"}`

    expect(verifyAccessToken(`${payload ?? ""}.${flipped}`, deps())).toEqual({
      ok: false,
      reason: "invalid_signature",
    })
  })

  it("refuses an expired token, and accepts it one second earlier", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL, expiresInDays: 1 }, deps())
    const later = () => NOW.getTime() + 24 * 60 * 60 * 1000

    expect(verifyAccessToken(token, deps({ now: later }))).toEqual({ ok: false, reason: "expired" })
    expect(verifyAccessToken(token, deps({ now: () => later() - 1000 })).ok).toBe(true)
  })

  it("refuses a token signed with a different secret", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())
    const other = "fedcba9876543210fedcba9876543210"

    expect(verifyAccessToken(token, deps({ secret: other }))).toEqual({
      ok: false,
      reason: "invalid_signature",
    })
  })

  it("refuses malformed tokens without throwing", () => {
    for (const bad of ["", "one-part", "a.b.c", ".signature", "payload.", "!!!.???"]) {
      expect(verifyAccessToken(bad, deps())).toEqual({ ok: false, reason: "malformed" })
    }
  })

  it("refuses a payload that is signed but not a payload", () => {
    const payload = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url")
    const { createHmac } = require("node:crypto") as typeof import("node:crypto")
    const signature = createHmac("sha256", SECRET).update(payload).digest("base64url")

    expect(verifyAccessToken(`${payload}.${signature}`, deps())).toEqual({
      ok: false,
      reason: "malformed",
    })
  })

  it("refuses everything when no secret is configured", () => {
    const token = createAccessToken({ orderId: ORDER, email: EMAIL }, deps())

    expect(verifyAccessToken(token, { secret: "" })).toEqual({
      ok: false,
      reason: "invalid_signature",
    })
  })

  it("refuses to sign without an order id, an email or a sane lifetime", () => {
    expect(() => createAccessToken({ orderId: "", email: EMAIL }, deps())).toThrow(/order id/)
    expect(() => createAccessToken({ orderId: ORDER, email: "  " }, deps())).toThrow(/email/)
    expect(() =>
      createAccessToken({ orderId: ORDER, email: EMAIL, expiresInDays: 0 }, deps()),
    ).toThrow(/expiresInDays/)
  })

  it("hashes the email case-insensitively and with no address in it", () => {
    expect(hashAccessEmail("Buyer@Example.com")).toBe(hashAccessEmail(" buyer@example.COM "))
    expect(hashAccessEmail(EMAIL)).toMatch(/^[0-9a-f]{32}$/)
    expect(hashAccessEmail(EMAIL)).not.toContain("example")
  })
})
