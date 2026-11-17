/**
 * What an unbuilt section shows.
 *
 * The wording is fixed on purpose: until a section has real content, the page
 * says so and says nothing else. There is no placeholder chart, no sample row
 * and no copy about what the section will do.
 */
export function EmptyState({
  message = "This section is not available yet.",
}: {
  message?: string
}) {
  return (
    <div className="rounded-md border border-border bg-background px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
