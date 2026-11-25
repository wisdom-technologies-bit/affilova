import { describe, expect, it } from "vitest"

import {
  STEP_UP_CODE_PATTERN,
  STEP_UP_EXPIRY_SECONDS,
  generateCode,
  hashCode,
  isWellFormedCode,
  normaliseCode,
} from "./step-up"

const SECRET = "0123456789abcdef0123456789abcdef"
const USER_A = "11111111-1111-4111-8111-111111111111"
const USER_B = "22222222-2222-4222-8222-222222222222"

describe("generateCode", () => {
  it("is always exactly six digits, with leading zeros kept", () => {
    expect(generateCode(() => 0)).toBe("000000")
    expect(generateCode(() => 7)).toBe("000007")
    expect(generateCode(() => 4821)).toBe("004821")
    expect(generateCode(() => 999_999)).toBe("999999")
  })

  it("asks the random source for a number below one million", () => {
    let seen = 0
    generateCode((max) => {
      seen = max
      return 1
    })
    expect(seen).toBe(1_000_000)
  })

  it("uses node's secure random by default and always matches the pattern", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateCode()).toMatch(STEP_UP_CODE_PATTERN)
    }
  })

  it("is spread across the whole range, not stuck on a few values", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i += 1) {
      seen.add(generateCode())
    }
    expect(seen.size).toBeGreaterThan(280)
  })
})

describe("hashCode", () => {
  const base = { userId: USER_A, purpose: "withdrawal", code: "123456", secret: SECRET } as const

  it("is a 64 character lowercase hex string", () => {
    expect(hashCode(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is stable for the same input", () => {
    expect(hashCode(base)).toBe(hashCode({ ...base }))
  })

  it("differs per user", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, userId: USER_B }))
  })

  it("differs per purpose", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, purpose: "bank_change" }))
  })

  it("differs per code and per secret", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, code: "123457" }))
    expect(hashCode(base)).not.toBe(hashCode({ ...base, secret: `${SECRET}x` }))
  })

  it("never contains the code", () => {
    expect(hashCode({ ...base, code: "000000" })).not.toContain("000000000")
  })

  it("reads STEP_UP_SECRET when no secret is injected, and refuses a missing one", () => {
    const original = process.env.STEP_UP_SECRET
    try {
      delete process.env.STEP_UP_SECRET
      expect(() => hashCode({ userId: USER_A, purpose: "withdrawal", code: "123456" })).toThrow(
        /STEP_UP_SECRET/,
      )
      process.env.STEP_UP_SECRET = SECRET
      expect(hashCode({ userId: USER_A, purpose: "withdrawal", code: "123456" })).toBe(hashCode(base))
    } finally {
      if (original === undefined) {
        delete process.env.STEP_UP_SECRET
      } else {
        process.env.STEP_UP_SECRET = original
      }
    }
  })
})

describe("normaliseCode and isWellFormedCode", () => {
  it("drops spaces and dashes a person types", () => {
    expect(normaliseCode(" 123 456 ")).toBe("123456")
    expect(normaliseCode("123-456")).toBe("123456")
  })

  it("accepts six digits and nothing else", () => {
    expect(isWellFormedCode("012345")).toBe(true)
    expect(isWellFormedCode("12345")).toBe(false)
    expect(isWellFormedCode("1234567")).toBe(false)
    expect(isWellFormedCode("12345a")).toBe(false)
    expect(isWellFormedCode("")).toBe(false)
  })
})

describe("expiry", () => {
  it("is ten minutes", () => {
    expect(STEP_UP_EXPIRY_SECONDS).toBe(600)
  })
})
