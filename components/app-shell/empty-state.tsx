import { EmptyState as DsEmptyState } from "@/components/ds/empty-state"

/**
 * What an unbuilt section shows.
 *
 * The wording is fixed on purpose: until a section has real content, the page
 * says so and says nothing else. There is no placeholder chart, no sample row
 * and no copy about what the section will do.
 *
 * The drawing is the design system's EmptyState, so an unbuilt section and an
 * empty list look like the same product.
 */
export function EmptyState({
  message = "This section is not available yet.",
}: {
  message?: string
}) {
  return <DsEmptyState title={message} />
}
