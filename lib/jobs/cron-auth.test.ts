import { describe, expect, it } from "vitest"

import { isValidCronSecret } from "./cron-auth"

const SECRET = "8f4c1f6a2b7d9e0c3a5f8b1d4e7a0c2f"

describe("isValidCronSecret", () => {
  it("accepts the exact bearer token", () => {
    expect(isValidCronSecret(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it("rejects a wrong secret of the same length", () => {
    const wrong = `${SECRET.slice(0, -1)}0`

    expect(wrong).toHaveLength(SECRET.length)
    expect(isValidCronSecret(`Bearer ${wrong}`, SECRET)).toBe(false)
  })

  it("rejects a missing header", () => {
    expect(isValidCronSecret(null, SECRET)).toBe(false)
    expect(isValidCronSecret(undefined, SECRET)).toBe(false)
    expect(isValidCronSecret("", SECRET)).toBe(false)
  })

  it("rejects a different scheme", () => {
    expect(isValidCronSecret(`Basic ${SECRET}`, SECRET)).toBe(false)
    expect(isValidCronSecret(`Token ${SECRET}`, SECRET)).toBe(false)
    expect(isValidCronSecret(`bearer ${SECRET}`, SECRET)).toBe(false)
    expect(isValidCronSecret(SECRET, SECRET)).toBe(false)
  })

  it("rejects a secret of a different length", () => {
    expect(isValidCronSecret(`Bearer ${SECRET}extra`, SECRET)).toBe(false)
    expect(isValidCronSecret("Bearer a", SECRET)).toBe(false)
  })

  it("rejects an empty token after the scheme", () => {
    expect(isValidCronSecret("Bearer ", SECRET)).toBe(false)
  })

  it("rejects an empty expected secret", () => {
    expect(isValidCronSecret(`Bearer ${SECRET}`, "")).toBe(false)
    expect(isValidCronSecret(`Bearer ${SECRET}`, null)).toBe(false)
    expect(isValidCronSecret(`Bearer ${SECRET}`, undefined)).toBe(false)
    expect(isValidCronSecret("Bearer ", "")).toBe(false)
  })
})
