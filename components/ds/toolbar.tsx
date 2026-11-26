import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The row above a list: a search box, a few filters, and the action that belongs
// to the list rather than to the page.
//
// It wraps. On a wide screen the search takes the space it needs and the filters
// sit beside it; on a phone every control goes full width and stacks, because a
// 120px select next to a 120px select is not usable with a thumb. Every control
// inside keeps its own 44px height, which is why the row is a flex-wrap and not a
// grid with fixed tracks.

export interface ToolbarProps {
  /** The search field, usually a <Field> with an Input. */
  search?: ReactNode
  /** Selects, toggles and date ranges. Wrapped in a labelled group. */
  filters?: ReactNode
  /** The action for the list: "New product", "Export". */
  actions?: ReactNode
  /** The accessible name of the filter group: "Filters". */
  filtersLabel?: string
  /** A line under the controls, such as "12 of 240 shown". */
  status?: string
  className?: string
}

export function Toolbar({
  search,
  filters,
  actions,
  filtersLabel = "Filters",
  status,
  className,
}: ToolbarProps) {
  return (
    <div className={cn("border-b border-border pb-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        {search === undefined ? null : <div className="min-w-0 sm:w-64">{search}</div>}

        {filters === undefined ? null : (
          <div
            role="group"
            aria-label={filtersLabel}
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
          >
            {filters}
          </div>
        )}

        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>
        )}
      </div>

      {status === undefined ? null : (
        <p aria-live="polite" className="mt-2 text-small text-text-muted">
          {status}
        </p>
      )}
    </div>
  )
}
