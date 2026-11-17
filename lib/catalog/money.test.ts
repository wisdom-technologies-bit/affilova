import { describe, expect, it } from "vitest"

import { formatNaira, MAX_NAIRA, nairaToKobo } from "./money"

describe("nairaToKobo", () => {
  it("parses whole naira", () => {
    expect(nairaToKobo("1500")).toBe(150_000)
    expect(nairaToKobo("100")).toBe(10_000)
    expect(nairaToKobo("0.01")).toBe(1)
  })

  it("parses thousands separators", () => {
    expect(nairaToKobo("1,500")).toBe(150_000)
    expect(nairaToKobo("1,500.50")).toBe(150_050)
    expect(nairaToKobo("10,000,000")).toBe(1_000_000_000)
  })

  it("treats one decimal as tens of kobo, never as a fraction", () => {
    expect(nairaToKobo("1500.5")).toBe(150_050)
    expect(nairaToKobo("1500.05")).toBe(150_005)
  })

  it("ignores surrounding spaces", () => {
    expect(nairaToKobo("  1500  ")).toBe(150_000)
  })

  it("rejects an empty amount", () => {
    expect(nairaToKobo("")).toBeNull()
    expect(nairaToKobo("   ")).toBeNull()
  })

  it("rejects zero and negative amounts", () => {
    expect(nairaToKobo("0")).toBeNull()
    expect(nairaToKobo("0.00")).toBeNull()
    expect(nairaToKobo("-5")).toBeNull()
    expect(nairaToKobo("-1500.50")).toBeNull()
  })

  it("rejects more than two decimals", () => {
    expect(nairaToKobo("1500.555")).toBeNull()
    expect(nairaToKobo("0.001")).toBeNull()
  })

  it("rejects letters, exponents and spaces inside the number", () => {
    expect(nairaToKobo("abc")).toBeNull()
    expect(nairaToKobo("1e3")).toBeNull()
    expect(nairaToKobo("1500 naira")).toBeNull()
    expect(nairaToKobo("1 500")).toBeNull()
    expect(nairaToKobo("₦1500")).toBeNull()
    expect(nairaToKobo("１５００")).toBeNull()
  })

  it("rejects badly grouped separators", () => {
    expect(nairaToKobo("1,50")).toBeNull()
    expect(nairaToKobo("1500,50")).toBeNull()
  })

  it("rejects more than ten million naira", () => {
    expect(nairaToKobo("10,000,001")).toBeNull()
    expect(nairaToKobo("99999999999999999999")).toBeNull()
    expect(nairaToKobo(`${MAX_NAIRA}`)).toBe(MAX_NAIRA * 100)
  })
})

describe("formatNaira", () => {
  it("hides the decimals on a whole amount", () => {
    expect(formatNaira(150_000)).toBe("₦1,500")
    expect(formatNaira(100_000_000)).toBe("₦1,000,000")
    expect(formatNaira(0)).toBe("₦0")
  })

  it("shows two decimals otherwise", () => {
    expect(formatNaira(150_050)).toBe("₦1,500.50")
    expect(formatNaira(5)).toBe("₦0.05")
    expect(formatNaira(1_000_000_000)).toBe("₦10,000,000")
  })

  it("accepts a bigint", () => {
    expect(formatNaira(BigInt(150_050))).toBe("₦1,500.50")
  })

  it("refuses a fractional amount instead of rounding it", () => {
    expect(() => formatNaira(1500.5)).toThrow(TypeError)
  })
})
