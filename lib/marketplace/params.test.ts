import { describe, expect, it } from "vitest"

import {
  buildMarketplaceHref,
  cleanCategory,
  cleanCursor,
  cleanNaira,
  cleanQuery,
  cleanSort,
  cleanVendorSlug,
  isFiltered,
  koboToNairaInput,
  MARKETPLACE_SORTS,
  MAX_QUERY_LENGTH,
  PAGE_SIZE,
  parseMarketplaceQuery,
  resultCountLabel,
  sortLabel,
  EMPTY_QUERY,
  type MarketplaceQuery,
} from "./params"

function query(overrides: Partial<MarketplaceQuery> = {}): MarketplaceQuery {
  return { ...EMPTY_QUERY, ...overrides }
}

describe("parseMarketplaceQuery", () => {
  it("reads a full, valid query", () => {
    expect(
      parseMarketplaceQuery({
        q: "keto",
        category: "education",
        min: "1500",
        max: "2,500.50",
        sort: "price_low",
        cursor: "eyJ2IjoiMSJ9",
      }),
    ).toEqual({
      q: "keto",
      category: "education",
      minKobo: 150_000,
      maxKobo: 250_050,
      sort: "price_low",
      cursor: "eyJ2IjoiMSJ9",
    })
  })

  it("answers the defaults for no parameters at all", () => {
    expect(parseMarketplaceQuery({})).toEqual(EMPTY_QUERY)
  })

  it("takes the first value of a repeated parameter", () => {
    expect(parseMarketplaceQuery({ q: ["first", "second"] }).q).toBe("first")
  })

  it("ignores a parameter that is not a string or an array of strings", () => {
    expect(parseMarketplaceQuery({ q: undefined }).q).toBe("")
  })

  it("falls back to newest for an unknown sort", () => {
    expect(parseMarketplaceQuery({ sort: "cheapest" }).sort).toBe("newest")
    expect(parseMarketplaceQuery({ sort: "NEWEST" }).sort).toBe("newest")
  })

  it("accepts every sort the database knows", () => {
    for (const sort of MARKETPLACE_SORTS) {
      expect(parseMarketplaceQuery({ sort }).sort).toBe(sort)
    }
  })

  it("lowercases a category and refuses anything that is not a slug", () => {
    expect(parseMarketplaceQuery({ category: "EDUCATION" }).category).toBe("education")
    expect(parseMarketplaceQuery({ category: "not a slug" }).category).toBe("")
    expect(parseMarketplaceQuery({ category: "../etc/passwd" }).category).toBe("")
    expect(parseMarketplaceQuery({ category: "-leading" }).category).toBe("")
    expect(parseMarketplaceQuery({ category: "a".repeat(41) }).category).toBe("")
  })

  it("refuses a price that is not a real naira amount", () => {
    expect(parseMarketplaceQuery({ min: "abc" }).minKobo).toBeNull()
    expect(parseMarketplaceQuery({ min: "-5" }).minKobo).toBeNull()
    expect(parseMarketplaceQuery({ min: "1e5" }).minKobo).toBeNull()
    expect(parseMarketplaceQuery({ min: "1500.999" }).minKobo).toBeNull()
    expect(parseMarketplaceQuery({ min: "999999999999999999" }).minKobo).toBeNull()
    expect(parseMarketplaceQuery({ min: "0" }).minKobo).toBeNull()
  })

  it("converts naira to kobo exactly, never through a float", () => {
    expect(parseMarketplaceQuery({ min: "1500" }).minKobo).toBe(150_000)
    expect(parseMarketplaceQuery({ min: "1500.5" }).minKobo).toBe(150_050)
    expect(parseMarketplaceQuery({ min: "1500.05" }).minKobo).toBe(150_005)
    expect(parseMarketplaceQuery({ min: "1,500.50" }).minKobo).toBe(150_050)
    expect(parseMarketplaceQuery({ max: "0.01" }).maxKobo).toBe(1)
  })

  it("keeps a search that looks like markup as text", () => {
    expect(parseMarketplaceQuery({ q: "<script>alert(1)</script>" }).q).toBe("<script>alert(1)</script>")
  })

  it("strips control characters out of a search", () => {
    expect(parseMarketplaceQuery({ q: "ke\u0000to\u001f" }).q).toBe("ke to")
  })

  it("cuts a search to the limit without splitting a character", () => {
    const long = "😀".repeat(200)
    const cleaned = cleanQuery(long)

    expect(Array.from(cleaned)).toHaveLength(MAX_QUERY_LENGTH)
    expect(cleaned).toBe("😀".repeat(MAX_QUERY_LENGTH))
  })

  it("keeps unicode text as it was typed", () => {
    expect(parseMarketplaceQuery({ q: "café 日本語" }).q).toBe("café 日本語")
  })

  it("refuses a cursor that is not shaped like one", () => {
    expect(parseMarketplaceQuery({ cursor: "not a cursor!" }).cursor).toBe("")
    expect(parseMarketplaceQuery({ cursor: "<script>" }).cursor).toBe("")
    expect(parseMarketplaceQuery({ cursor: "a".repeat(513) }).cursor).toBe("")
  })

  it("accepts a base64url cursor", () => {
    const cursor = "eyJ2IjoiMTIzIiwiaWQiOiJhYmMifQ"

    expect(parseMarketplaceQuery({ cursor }).cursor).toBe(cursor)
  })
})

describe("clean helpers", () => {
  it("cleanQuery trims and limits", () => {
    expect(cleanQuery("  keto  ")).toBe("keto")
    expect(cleanQuery("")).toBe("")
  })

  it("cleanCategory refuses a value that is only hyphens", () => {
    expect(cleanCategory("---")).toBe("")
  })

  it("cleanCursor keeps the base64url alphabet", () => {
    expect(cleanCursor("ab-_09")).toBe("ab-_09")
    expect(cleanCursor("ab+c/9=")).toBe("")
  })

  it("cleanNaira answers null for an empty value", () => {
    expect(cleanNaira("")).toBeNull()
    expect(cleanNaira("   ")).toBeNull()
  })

  it("cleanSort is case insensitive", () => {
    expect(cleanSort("PRICE_HIGH")).toBe("price_high")
  })

  it("cleanVendorSlug enforces the database's own handle shape", () => {
    expect(cleanVendorSlug("ada-digital")).toBe("ada-digital")
    expect(cleanVendorSlug("ADA-DIGITAL")).toBe("ada-digital")
    expect(cleanVendorSlug("ab")).toBe("")
    expect(cleanVendorSlug("-ada")).toBe("")
    expect(cleanVendorSlug("ada digital")).toBe("")
  })
})

describe("isFiltered", () => {
  it("is false for the plain listing", () => {
    expect(isFiltered(EMPTY_QUERY)).toBe(false)
  })

  it("is true for a search, a category, a price, a sort and a cursor", () => {
    expect(isFiltered(query({ q: "keto" }))).toBe(true)
    expect(isFiltered(query({ category: "education" }))).toBe(true)
    expect(isFiltered(query({ minKobo: 100 }))).toBe(true)
    expect(isFiltered(query({ maxKobo: 100 }))).toBe(true)
    expect(isFiltered(query({ sort: "price_low" }))).toBe(true)
    expect(isFiltered(query({ cursor: "abc" }))).toBe(true)
  })
})

describe("koboToNairaInput", () => {
  it("writes a whole naira amount without decimals", () => {
    expect(koboToNairaInput(150_000)).toBe("1500")
  })

  it("writes kobo exactly", () => {
    expect(koboToNairaInput(150_050)).toBe("1500.50")
    expect(koboToNairaInput(5)).toBe("0.05")
    expect(koboToNairaInput(1)).toBe("0.01")
  })

  it("answers an empty string for nothing", () => {
    expect(koboToNairaInput(null)).toBe("")
    expect(koboToNairaInput(-1)).toBe("")
    expect(koboToNairaInput(1.5)).toBe("")
  })

  it("round trips through the parser", () => {
    for (const kobo of [1, 5, 99, 100, 150_050, 999_999, 10_000_000_00]) {
      expect(cleanNaira(koboToNairaInput(kobo))).toBe(kobo)
    }
  })
})

describe("buildMarketplaceHref", () => {
  it("writes the plain listing without a query string", () => {
    expect(buildMarketplaceHref({ basePath: "/marketplace", query: {} })).toBe("/marketplace")
  })

  it("writes only the values that differ from the default", () => {
    expect(
      buildMarketplaceHref({
        basePath: "/marketplace",
        query: { q: "keto", category: "", sort: "newest", minKobo: null, maxKobo: null, cursor: "" },
      }),
    ).toBe("/marketplace?q=keto")
  })

  it("writes every value in a fixed order", () => {
    expect(
      buildMarketplaceHref({
        basePath: "/marketplace",
        query: { q: "keto", category: "education", minKobo: 100_000, maxKobo: 200_000, sort: "price_low", cursor: "abc" },
      }),
    ).toBe("/marketplace?q=keto&category=education&min=1000&max=2000&sort=price_low&cursor=abc")
  })

  it("encodes hostile text instead of trusting it", () => {
    const href = buildMarketplaceHref({ basePath: "/marketplace", query: { q: "a&b=c <d>" } })

    expect(href).toBe("/marketplace?q=a%26b%3Dc+%3Cd%3E")
    expect(new URL(href, "https://example.com").searchParams.get("q")).toBe("a&b=c <d>")
  })

  it("drops the cursor when the form must start at page one", () => {
    expect(
      buildMarketplaceHref({ basePath: "/marketplace", query: { q: "keto", cursor: "abc" }, withoutCursor: true }),
    ).toBe("/marketplace?q=keto")
  })

  it("refuses to write a cursor that is not one", () => {
    expect(buildMarketplaceHref({ basePath: "/marketplace", query: { cursor: "not a cursor" } })).toBe("/marketplace")
  })

  it("builds a category page's own path", () => {
    expect(buildMarketplaceHref({ basePath: "/marketplace/education", query: { q: "keto" } })).toBe(
      "/marketplace/education?q=keto",
    )
  })

  it("never writes a negative or fractional price", () => {
    expect(buildMarketplaceHref({ basePath: "/marketplace", query: { minKobo: -5 } })).toBe("/marketplace")
    expect(buildMarketplaceHref({ basePath: "/marketplace", query: { minKobo: 1.5 } })).toBe("/marketplace")
  })
})

describe("labels", () => {
  it("names every sort", () => {
    for (const sort of MARKETPLACE_SORTS) {
      expect(sortLabel(sort).length).toBeGreaterThan(0)
    }
  })

  it("counts products honestly", () => {
    expect(resultCountLabel(0, 0)).toBe("No products found")
    expect(resultCountLabel(1, 1)).toBe("1 product")
    expect(resultCountLabel(12, 12)).toBe("12 products")
    expect(resultCountLabel(0, 0)).not.toContain("!")
  })

  it("has a page size the database will accept", () => {
    expect(PAGE_SIZE).toBeGreaterThan(0)
    expect(PAGE_SIZE).toBeLessThanOrEqual(24)
  })
})
