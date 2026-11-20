import type { MetricDefinition } from "@/lib/affiliate/definitions"

/**
 * One number on the overview: its name, its value, and the definition on hover.
 *
 * The definition is a title attribute, which is what a mouse shows on hover, and
 * the same sentence is repeated in the visible "How these are calculated"
 * disclosure below the cards, so it is never only a hover away.
 */
export function KpiCard({
  metric,
  value,
  hint,
}: {
  metric: MetricDefinition
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span title={metric.definition} className="cursor-help">
          {metric.label}
        </span>
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-brand-ink">{value}</dd>
      {hint === undefined ? null : <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}
