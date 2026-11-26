import { formatNaira } from "@/lib/catalog/money"
import { cn } from "@/lib/utils"

// Money, as a person reads it.
//
// Amounts in this product are integers of kobo, everywhere, and they are never
// turned into a float on the way to the screen: formatNaira divides integers and
// the result is a string. This component adds three things on top:
//   * tabular figures, so a column of amounts lines up on the decimal;
//   * an optional explicit sign, for a delta ("+₦1,200") rather than a balance;
//   * a tone for a negative amount, which is also always written with a minus,
//     so the meaning does not rest on the colour.
//
// The currency is naira (₦). There is no option to change it: this product
// prices in one currency.

export interface MoneyProps {
  /** The amount in kobo. Negative for a debit. */
  kobo: number | bigint
  /** Prefix a positive amount with "+". Use for a change, not for a balance. */
  sign?: boolean
  /** Renders a negative amount in the danger colour. The minus stays either way. */
  toneNegative?: boolean
  /** Adds the currency word for a screen reader where ₦ might be read oddly. */
  label?: string
  className?: string
}

function isNegative(kobo: number | bigint): boolean {
  return typeof kobo === "bigint" ? kobo < BigInt(0) : kobo < 0
}

function isZero(kobo: number | bigint): boolean {
  return typeof kobo === "bigint" ? kobo === BigInt(0) : kobo === 0
}

export function Money({ kobo, sign = false, toneNegative = false, label, className }: MoneyProps) {
  const negative = isNegative(kobo)
  const prefix = sign && !negative && !isZero(kobo) ? "+" : ""
  const formatted = formatNaira(kobo)

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        negative && toneNegative ? "text-danger" : undefined,
        className,
      )}
    >
      {label === undefined ? null : <span className="sr-only">{`${label}: `}</span>}
      {`${prefix}${formatted}`}
    </span>
  )
}
