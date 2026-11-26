import { describe, expect, it } from "vitest"

import {
  GOOD_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_GUIDANCE,
  passwordStrength,
} from "./password-strength"

// The guidance line, as a table.
//
// The two things this has to guarantee: the word is a word (so it survives
// greyscale and a screen reader), and nothing under the server's own minimum is
// ever called acceptable while everything at or over it is.

describe("passwordStrength", () => {
  const table: ReadonlyArray<[length: number, label: string, meetsMinimum: boolean]> = [
    [0, "Too short", false],
    [1, "Too short", false],
    [5, "Too short", false],
    [9, "Too short", false],
    [10, "Acceptable", true],
    [11, "Acceptable", true],
    [13, "Acceptable", true],
    [14, "Good", true],
    [20, "Good", true],
    [64, "Good", true],
    [128, "Good", true],
  ]

  for (const [length, label, meetsMinimum] of table) {
    it(`${length} characters reads "${label}"`, () => {
      expect(passwordStrength(length)).toEqual({ label, meetsMinimum })
    })
  }

  it("changes its word exactly at the server's minimum", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10)
    expect(passwordStrength(MIN_PASSWORD_LENGTH - 1).meetsMinimum).toBe(false)
    expect(passwordStrength(MIN_PASSWORD_LENGTH).meetsMinimum).toBe(true)
  })

  it("changes its word exactly where a longer password starts to be called good", () => {
    expect(passwordStrength(GOOD_PASSWORD_LENGTH - 1).label).toBe("Acceptable")
    expect(passwordStrength(GOOD_PASSWORD_LENGTH).label).toBe("Good")
  })

  it("never returns an empty label, so the line always says something", () => {
    for (const length of [0, 1, 9, 10, 14, 200]) {
      expect(passwordStrength(length).label.trim()).not.toBe("")
    }
  })

  it("names the minimum in the guidance, from the same constant the check uses", () => {
    expect(PASSWORD_GUIDANCE).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it("is a length rule only: two passwords of the same length read the same", () => {
    expect(passwordStrength(12)).toEqual(passwordStrength(12))
    expect(passwordStrength("a".repeat(12).length).label).toBe("Acceptable")
  })
})
