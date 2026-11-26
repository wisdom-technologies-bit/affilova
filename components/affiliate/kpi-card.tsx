import { Stat } from "@/components/ds/stat"
import type { MetricDefinition } from "@/lib/affiliate/definitions"

/**
 * One number on the overview: its name, its value, and the definition on hover.
 *
 * The definition is a title attribute, which is what a mouse shows on hover, and
 * the same sentence is repeated in the visible "How these are calculated"
 * disclosure below the cards, so it is never only a hover away.
 *
 * It is the design system's Stat: tabular figures so eight of these line up, a
 * 1px border instead of a shadow, and the value set at the same size on every
 * screen. The props are the ones the affiliate screens already pass.
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
  return <Stat label={metric.label} value={value} hint={hint} description={metric.definition} />
}
