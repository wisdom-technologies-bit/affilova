import { describe, expect, it } from "vitest"

import { bpsToPercentText, csvCell, koboToNairaText, vatCsv, vatCsvFileName, VAT_CSV_COLUMNS } from "./csv"
import type { VatExportRow } from "./screen-types"

function row(overrides: Partial<VatExportRow> = {}): VatExportRow {
  return {
    orderNumber: "AFV-1001",
    paidDateLagos: "2026-09-14",
    basis: "platform_fee",
    rateBps: 750,
    baseKobo: BigInt(100_000),
    taxKobo: BigInt(7_500),
    supplier: "affilova",
    refunded: false,
    ...overrides,
  }
}

describe("csvCell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("AFV-1001")).toBe("AFV-1001")
  })

  it("defuses every character a spreadsheet treats as a formula", () => {
    for (const dangerous of ["=1+1", "+44", "-5", "@SUM(A1)", "\tvalue"]) {
      expect(csvCell(dangerous).startsWith("'")).toBe(true)
    }
  })

  it("quotes a cell with a comma, a quote or a newline", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell("a\nb")).toBe('"a\nb"')
  })

  it("defuses and quotes at the same time", () => {
    expect(csvCell("=a,b")).toBe('"\'=a,b"')
  })
})

describe("money text", () => {
  it("writes kobo as naira with two decimals, without a float", () => {
    expect(koboToNairaText(BigInt(0))).toBe("0.00")
    expect(koboToNairaText(BigInt(7_500))).toBe("75.00")
    expect(koboToNairaText(BigInt(123_456))).toBe("1234.56")
    expect(koboToNairaText(BigInt(-1_500))).toBe("-15.00")
  })

  it("writes basis points as a percentage", () => {
    expect(bpsToPercentText(750)).toBe("7.5")
    expect(bpsToPercentText(1_000)).toBe("10")
    expect(bpsToPercentText(1_250)).toBe("12.5")
    expect(bpsToPercentText(0)).toBe("0")
  })
})

describe("vatCsv", () => {
  it("writes the documented columns, in order", () => {
    const [header] = vatCsv([row()]).split("\r\n")

    expect(header).toBe(VAT_CSV_COLUMNS.join(","))
    expect(header).toBe("order_number,paid_date_lagos,basis,rate_percent,base_naira,tax_naira,supplier,refunded")
  })

  it("writes one line per tax line, and ends with a newline", () => {
    const body = vatCsv([row(), row({ orderNumber: "AFV-1002", refunded: true })])

    expect(body.endsWith("\r\n")).toBe(true)
    expect(body.split("\r\n").filter((line) => line !== "")).toHaveLength(3)
    expect(body).toContain("AFV-1002")
    expect(body).toContain(",yes")
  })

  it("carries no buyer data of any kind", () => {
    const body = vatCsv([row()])

    expect(body).not.toContain("@")
    expect(body.toLowerCase()).not.toContain("buyer")
    expect(body.toLowerCase()).not.toContain("email")
  })

  it("defuses a supplier or order number that looks like a formula", () => {
    const body = vatCsv([row({ orderNumber: "=cmd|' /C calc'!A0", supplier: "@vendor" })])

    expect(body).toContain("'=cmd")
    expect(body).toContain("'@vendor")
  })

  it("names the file after the period", () => {
    expect(vatCsvFileName("2026-09-01")).toBe("vat-2026-09-01.csv")
  })
})
