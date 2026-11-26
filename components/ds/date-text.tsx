import { formatLagosDate, formatLagosDateTime, NOT_SET } from "@/lib/catalog/format"
import { cn } from "@/lib/utils"

// A date or a timestamp, in Africa/Lagos, in one format.
//
// Nigeria runs on one clock, and every screen in this product shows that clock:
// a payout requested at 23:30 Lagos time is the 24th, whatever the reader's
// laptop thinks. The formatting is not done here either: formatLagosDate and
// formatLagosDateTime are the two functions the whole app uses, so "18 Nov 2026"
// means the same thing on a receipt, a payout and an invoice.
//
// An empty value is "Not set", never a dash and never 01/01/1970.
//
// A machine-readable <time dateTime> is included when the value is a valid
// instant, so a reader can copy it and a crawler can parse it.

export interface DateTextProps {
  /** An ISO instant, or null/undefined when nothing has happened yet. */
  value: string | null | undefined
  /** Show the time as well as the day. */
  withTime?: boolean
  /** Words used in place of "Not set", such as "Not paid yet". */
  fallback?: string
  className?: string
}

function isValidInstant(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value === "") {
    return false
  }

  return !Number.isNaN(new Date(value).getTime())
}

export function DateText({ value, withTime = false, fallback, className }: DateTextProps) {
  const text = withTime ? formatLagosDateTime(value) : formatLagosDate(value)

  if (text === NOT_SET) {
    return <span className={cn("text-text-subtle", className)}>{fallback ?? NOT_SET}</span>
  }

  return (
    <time dateTime={isValidInstant(value) ? value : undefined} className={cn("tabular", className)}>
      {text}
    </time>
  )
}
