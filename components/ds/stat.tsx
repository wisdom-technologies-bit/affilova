import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// One number with its name, its unit and, where it helps, one line of context.
//
// Three rules:
//   * the value is set in tabular figures, so eight of these in a row line up
//     digit for digit and a change from 1,199 to 1,200 does not shift the column;
//   * a trend is words, not an arrow in green: "12% more than the previous 7
//     days" is read by everyone, including a person who cannot see the colour;
//   * the value is never invented here. It is the string the caller measured.
//
// The card is a 1px border on white. It is a description list entry, so a screen
// reader hears "Clicks, 1,204".

export interface StatProps {
  /** What is being counted, in sentence case: "Clicks". */
  label: string
  /** The number, already formatted: "1,204" or "₦18,250". */
  value: string
  /** One line under the value: the unit, the range, the definition. */
  hint?: string
  /** A change, in words. Never a bare arrow or a bare colour. */
  trend?: string
  /**
   * The definition of the measure, in one sentence. Shown on hover and used as
   * the description of the term, so the meaning is never only a hover away.
   */
  description?: string
  /** Draws attention to the value without using colour alone: a small word. */
  flag?: string
  className?: string
}

export function Stat({ label, value, hint, trend, description, flag, className }: StatProps) {
  return (
    <div className={cn("rounded-md border border-border bg-background px-4 py-3", className)}>
      <dt className="text-small font-medium text-text-muted" title={description}>
        {label}
        {flag === undefined ? null : (
          <span className="ml-2 rounded-sm border border-border bg-surface-subtle px-1.5 py-0.5 text-caption font-medium text-text-muted">
            {flag}
          </span>
        )}
      </dt>
      <dd className="tabular mt-1 text-h2 text-foreground">{value}</dd>
      {hint === undefined ? null : <dd className="mt-0.5 text-small text-text-subtle">{hint}</dd>}
      {trend === undefined ? null : <dd className="mt-1 text-small text-text-muted">{trend}</dd>}
    </div>
  )
}

/** A row of stats, as one description list. Wrap stats in this, not in a div. */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode
  /** How many across from lg up. Two on a phone, always. */
  columns?: 2 | 3 | 4
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        columns === 2 ? "lg:grid-cols-2" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  )
}
