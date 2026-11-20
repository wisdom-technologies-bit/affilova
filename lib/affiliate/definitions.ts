// The words behind the affiliate numbers.
//
// One place for the label, the one-line definition and the longer explanation,
// so the KPI card, the hover text and the "How these are calculated" disclosure
// can never drift apart. Nothing here reads the database or the clock.

export interface MetricDefinition {
  label: string
  /** One sentence, shown on hover. */
  definition: string
  /** The arithmetic, in plain words, for the disclosure. */
  how: string
}

export const METRICS = {
  clicks: {
    label: "Clicks",
    definition: "Every human visit through one of your links in the selected days.",
    how: "Counted once per visit. Automated traffic is filtered out before it is stored.",
  },
  uniqueClicks: {
    label: "Unique clicks",
    definition: "Clicks from a different person, not the same visitor again.",
    how: "A click is unique when the same link has not seen the same visitor in the previous 30 minutes.",
  },
  orders: {
    label: "Orders",
    definition: "Paid orders that were attributed to one of your links.",
    how: "Only orders that were paid inside the range. A refunded order leaves this count.",
  },
  conversion: {
    label: "Conversion rate",
    definition: "How many unique clicks turned into a paid order.",
    how: "Orders divided by unique clicks, shown as a percentage.",
  },
  epc: {
    label: "Earnings per 100 clicks",
    definition: "The commission you earned for every 100 clicks on your links.",
    how: "Commission divided by clicks, then multiplied by 100. It is a guide, not a promise.",
  },
  commission: {
    label: "Commission earned",
    definition: "Your share of the paid orders in the range.",
    how: "The product's commission percentage of each paid order, added up.",
  },
  pending: {
    label: "Pending balance",
    definition: "Commission that is still inside the hold period.",
    how: "Commission credited but not yet released. The hold is set by the platform, and the Earnings page states the current number of days.",
  },
  available: {
    label: "Available balance",
    definition: "Commission that has cleared the hold.",
    how: "Everything credited minus everything paid out and minus what is still pending, never below zero.",
  },
} as const satisfies Record<string, MetricDefinition>

export const HOW_CALCULATED: readonly MetricDefinition[] = [
  METRICS.clicks,
  METRICS.uniqueClicks,
  METRICS.orders,
  METRICS.conversion,
  METRICS.epc,
  METRICS.commission,
  METRICS.pending,
  METRICS.available,
]

/** Basis points as a percentage with two decimals at most: 2250 -> "22.5%". */
export function formatBpsPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new TypeError("formatBpsPercent expects a whole, non-negative number")
  }

  const whole = Math.floor(bps / 100)
  const remainder = bps % 100

  if (remainder === 0) {
    return `${whole}%`
  }

  return `${whole}.${remainder.toString().padStart(2, "0").replace(/0$/, "")}%`
}

/** A count with thousands separators, using the runtime's own grouping. */
export function formatCount(value: number): string {
  if (!Number.isInteger(value)) {
    throw new TypeError("formatCount expects a whole number")
  }

  return value.toLocaleString("en-GB")
}
