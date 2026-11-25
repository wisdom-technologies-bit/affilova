// The VAT export, as CSV.
//
// Two rules decide every line here:
//
//   * no buyer data. The export is a tax document about the platform's own
//     supplies: the order number, the day, the basis, the rate, the base, the
//     tax and the supplier. Not an address, not a name, not a reference.
//   * a cell that a spreadsheet would treat as a formula is defused. Excel and
//     Sheets run a cell that starts with =, +, - or @, and a tab can be used to
//     hide the start of one. Those cells are prefixed with a single quote, which
//     both spreadsheets read as "this is text".

import type { VatExportRow } from "./screen-types"

export const VAT_CSV_COLUMNS = [
  "order_number",
  "paid_date_lagos",
  "basis",
  "rate_percent",
  "base_naira",
  "tax_naira",
  "supplier",
  "refunded",
] as const

/** The characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_START = /^[=+\-@\t]/

/** A cell that cannot become a formula and cannot break the quoting. */
export function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }

  return guarded
}

/** Kobo as naira with two decimals, never a float. */
export function koboToNairaText(kobo: bigint): string {
  const negative = kobo < BigInt(0)
  const absolute = negative ? -kobo : kobo
  const whole = absolute / BigInt(100)
  const fraction = absolute % BigInt(100)
  const text = `${whole}.${fraction.toString().padStart(2, "0")}`

  return negative ? `-${text}` : text
}

/** Basis points as a percentage, two decimals at most. */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = Math.abs(bps % 100)

  return fraction === 0 ? `${whole}` : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`
}

export function vatCsv(rows: readonly VatExportRow[]): string {
  const lines: string[] = [VAT_CSV_COLUMNS.join(",")]

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.orderNumber),
        csvCell(row.paidDateLagos),
        csvCell(row.basis),
        csvCell(bpsToPercentText(row.rateBps)),
        csvCell(koboToNairaText(row.baseKobo)),
        csvCell(koboToNairaText(row.taxKobo)),
        csvCell(row.supplier),
        csvCell(row.refunded ? "yes" : "no"),
      ].join(","),
    )
  }

  // A trailing newline: every tool that reads CSV expects the last line to end.
  return `${lines.join("\r\n")}\r\n`
}

/** The file name for one period, e.g. vat-2026-09-01.csv. */
export function vatCsvFileName(period: string): string {
  return `vat-${period}.csv`
}
