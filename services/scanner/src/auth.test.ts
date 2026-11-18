import { describe, expect, it } from "vitest"

import { extractBearerToken, isAuthorized } from "#auth"

const SECRET = "the-shared-secret-value-0123456789"

describe("extractBearerToken", () => {
  it("returns the token from a bearer header", () => {
    expect(extractBearerToken(`Bearer ${SECRET}`)).toBe(SECRET)
  })

  it("accepts the scheme in any case", () => {
    expect(extractBearerToken(`bEaReR ${SECRET}`)).toBe(SECRET)
  })

  it.each([undefined, "", "Bearer", "Bearer ", "Basic abc", SECRET, "Bearer   "])(
    "returns null for %s",
    (header) => {
      expect(extractBearerToken(header)).toBeNull()
    },
  )
})

describe("isAuthorized", () => {
  it("accepts the exact secret", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it("rejects a missing header", () => {
    expect(isAuthorized(undefined, SECRET)).toBe(false)
  })

  it("rejects the wrong secret of the same length", () => {
    const wrong = "the-shared-secret-value-0123456780"

    expect(wrong).toHaveLength(SECRET.length)
    expect(isAuthorized(`Bearer ${wrong}`, SECRET)).toBe(false)
  })

  it("rejects a prefix of the secret", () => {
    expect(isAuthorized(`Bearer ${SECRET.slice(0, 10)}`, SECRET)).toBe(false)
  })

  it("rejects a longer value that starts with the secret", () => {
    expect(isAuthorized(`Bearer ${SECRET}extra`, SECRET)).toBe(false)
  })

  it("rejects the secret under another scheme", () => {
    expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false)
  })

  it("rejects an empty configured secret", () => {
    expect(isAuthorized("Bearer ", "")).toBe(false)
  })
})
