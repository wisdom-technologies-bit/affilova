import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it } from "vitest"

import { dailySalt, hashIp, hashUa, hashWithSalt, utcDay } from "./hash"

// The hashes on a click.
//
// Two things matter: the same visitor on the same day has to hash the same, or
// the 30 minute uniqueness window cannot work; and the same visitor on a
// different day has to hash differently, or the stored data becomes a way to
// follow someone for as long as the row lives.

const SECRET = "0123456789abcdef0123456789abcdef"
const OTHER_SECRET = "fedcba9876543210fedcba9876543210"

const DAY_ONE = new Date("2026-11-20T10:00:00.000Z")
const DAY_ONE_LATER = new Date("2026-11-20T23:59:59.000Z")
const DAY_TWO = new Date("2026-11-21T00:00:01.000Z")

beforeEach(() => {
  process.env.CLICK_HASH_SECRET = SECRET
})

describe("the daily salt", () => {
  it("is the same all day and different the next day", () => {
    expect(dailySalt(SECRET, DAY_ONE)).toBe(dailySalt(SECRET, DAY_ONE_LATER))
    expect(dailySalt(SECRET, DAY_ONE)).not.toBe(dailySalt(SECRET, DAY_TWO))
  })

  it("depends on the secret, so two deployments cannot match each other", () => {
    expect(dailySalt(SECRET, DAY_ONE)).not.toBe(dailySalt(OTHER_SECRET, DAY_ONE))
  })

  it("uses the UTC day, not the local one", () => {
    // 00:30 in Lagos on the 21st is still the 20th in UTC.
    expect(utcDay(new Date("2026-11-20T23:30:00.000Z"))).toBe("2026-11-20")
  })
})

describe("hashIp", () => {
  it("gives the same hash for the same address on the same day", () => {
    expect(hashIp("203.0.113.7", DAY_ONE)).toBe(hashIp("203.0.113.7", DAY_ONE_LATER))
  })

  it("rotates the next day", () => {
    expect(hashIp("203.0.113.7", DAY_ONE)).not.toBe(hashIp("203.0.113.7", DAY_TWO))
  })

  it("gives different addresses different hashes", () => {
    expect(hashIp("203.0.113.7", DAY_ONE)).not.toBe(hashIp("203.0.113.8", DAY_ONE))
  })

  it("is a 64 character hex digest and never the address itself", () => {
    const hash = hashIp("203.0.113.7", DAY_ONE)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("203.0.113.7")
    expect(hash).not.toContain("203")
  })

  it("trims, so a padded address is the same visitor", () => {
    expect(hashIp("  203.0.113.7 ", DAY_ONE)).toBe(hashIp("203.0.113.7", DAY_ONE))
  })

  it("refuses to run without a secret long enough to matter", () => {
    process.env.CLICK_HASH_SECRET = "short"

    expect(() => hashIp("203.0.113.7", DAY_ONE)).toThrow(/CLICK_HASH_SECRET/)
  })
})

describe("hashUa", () => {
  it("is stable within a day and rotates the next", () => {
    const agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"

    expect(hashUa(agent, DAY_ONE)).toBe(hashUa(agent, DAY_ONE_LATER))
    expect(hashUa(agent, DAY_ONE)).not.toBe(hashUa(agent, DAY_TWO))
  })

  it("never returns the user agent", () => {
    const agent = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0"

    expect(hashUa(agent, DAY_ONE)).not.toContain("Mozilla")
    expect(hashUa(agent, DAY_ONE)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("hashWithSalt", () => {
  it("is a plain SHA-256 of salt, a colon and the value", () => {
    // Proves the shape is what the comment says: no trailing newline, no other
    // separator, and the salt first.
    expect(hashWithSalt("value", "salt")).toBe(
      createHash("sha256").update("salt:value").digest("hex"),
    )
  })
})
