// Money in this project is always an integer number of kobo. Nothing here uses
// a float: "1500.5" naira is parsed by reading the two halves as integers, and
// every formatted value is built from integer division.

/** The largest price a product may have: ten million naira. */
export const MAX_NAIRA = 10_000_000

const KAIRO_PER_NAIRA = 100

// Digits with optional thousands separators ("1500" or "1,500") and at most two
// decimal places. Exponents, signs, spaces inside the number and letters are not
// matched at all.
const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

const GROUPING = /^\d{1,3}(?:,\d{3})*$/

/**
 * Parse a naira amount typed by a person into kobo, or return null.
 *
 * Accepts "1500", "1,500", "1500.5" and "1500.50". Rejects an empty string, a
 * negative amount, more than two decimals, letters, exponents and anything above
 * {@link MAX_NAIRA}.
 */
export function nairaToKobo(input: string): number | null {
  const trimmed = input.trim()

  if (trimmed === "") {
    return null
  }

  const match = AMOUNT.exec(trimmed)

  if (!match) {
    return null
  }

  // The integer part, without separators. A grouped number must be grouped
  // properly, so "1,50" is a typo rather than 150.
  const integerPart = trimmed.split(".")[0]

  if (integerPart.includes(",") && !GROUPING.test(integerPart)) {
    return null
  }

  const digits = integerPart.replace(/,/g, "")
  const fraction = match[1] ?? ""

  // "1500.5" is fifty kobo, so the fraction is padded on the right, never parsed
  // as 0.5 of anything.
  const kobo = Number(digits) * KAIRO_PER_NAIRA + Number(fraction.padEnd(2, "0"))

  if (!Number.isSafeInteger(kobo) || kobo <= 0 || kobo > MAX_NAIRA * KAIRO_PER_NAIRA) {
    return null
  }

  return kobo
}

function group(digits: string): string {
  let out = ""

  for (let index = 0; index < digits.length; index += 1) {
    const remaining = digits.length - index

    out += digits[index]

    if (remaining > 1 && remaining % 3 === 1) {
      out += ","
    }
  }

  return out
}

/**
 * Format kobo as naira, for example "₦1,500.50", or "₦1,500" when the amount is
 * a whole number of naira.
 */
export function formatNaira(kobo: number | bigint): string {
  let amount: bigint

  if (typeof kobo === "bigint") {
    amount = kobo
  } else {
    if (!Number.isInteger(kobo)) {
      // A float here is a bug upstream, and rounding it silently would hide it.
      throw new TypeError("formatNaira expects an integer number of kobo")
    }

    amount = BigInt(kobo)
  }

  const zero = BigInt(0)
  const hundred = BigInt(100)
  const negative = amount < zero
  const absolute = negative ? -amount : amount
  const naira = absolute / hundred
  const koboPart = absolute % hundred

  const whole = group(naira.toString())
  const decimals =
    koboPart === zero ? "" : `.${koboPart.toString().padStart(2, "0")}`

  return `${negative ? "-" : ""}₦${whole}${decimals}`
}
