import { describe, expect, it } from "vitest"

import { isValidProductSlug, slugify } from "./slug"

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Keto Meal Plan")).toBe("keto-meal-plan")
    expect(slugify("Keto  Meal   Plan")).toBe("keto-meal-plan")
    expect(slugify("Keto_Meal_Plan")).toBe("keto-meal-plan")
  })

  it("drops punctuation at the edges", () => {
    expect(slugify("  --Hello--World--  ")).toBe("hello-world")
    expect(slugify("Keto Meal Plan!!!")).toBe("keto-meal-plan")
    expect(slugify("(free) guide")).toBe("free-guide")
  })

  it("strips diacritics", () => {
    expect(slugify("Café Crème")).toBe("cafe-creme")
    expect(slugify("Über naïve façade")).toBe("uber-naive-facade")
  })

  it("keeps digits", () => {
    expect(slugify("Top 10 Tips 2026")).toBe("top-10-tips-2026")
  })

  it("returns an empty string when nothing is left", () => {
    expect(slugify("😀")).toBe("")
    expect(slugify("日本語")).toBe("")
    expect(slugify("")).toBe("")
  })

  it("cuts to 80 characters without a trailing hyphen", () => {
    const long = slugify("word ".repeat(40))

    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith("-")).toBe(false)
  })
})

describe("isValidProductSlug", () => {
  it("accepts a normal address", () => {
    expect(isValidProductSlug("keto-meal-plan")).toBe(true)
    expect(isValidProductSlug("abcd")).toBe(true)
    expect(isValidProductSlug("a1bc")).toBe(true)
    expect(isValidProductSlug("2026-guide")).toBe(true)
  })

  it("refuses the shapes the database refuses", () => {
    expect(isValidProductSlug("")).toBe(false)
    expect(isValidProductSlug("ab")).toBe(false)
    expect(isValidProductSlug("abc")).toBe(false)
    expect(isValidProductSlug("Abc")).toBe(false)
    expect(isValidProductSlug("-abc")).toBe(false)
    expect(isValidProductSlug("abc-")).toBe(false)
    expect(isValidProductSlug("a_bc")).toBe(false)
    expect(isValidProductSlug("a bc")).toBe(false)
    expect(isValidProductSlug("a".repeat(81))).toBe(false)
  })

  it("accepts what slugify produces", () => {
    expect(isValidProductSlug(slugify("Keto Meal Plan"))).toBe(true)
  })
})
