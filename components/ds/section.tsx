import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// A titled block of a page: the h2, one sentence, the actions that act on the
// block, and the content.
//
// The border is 1px and there is no shadow. A section is separated from the next
// by a rule and by space, not by depth, because a page of floating cards reads as
// noise and this product is meant to be quiet.
//
// The heading is always an h2: PageHeader owns the h1, so a page never has two.

export interface SectionProps {
  /** The section title. An h2, so it sits under the page's single h1. */
  title: string
  /** One sentence under the title: what the section holds. */
  description?: string
  /** Section-level actions, aligned right on a wide screen. */
  actions?: ReactNode
  /** Anchored by a table of contents or a link, when given. */
  id?: string
  /** Padding and edge treatment. `plain` is for a section inside another panel. */
  variant?: "panel" | "plain"
  children: ReactNode
  className?: string
}

export function Section({
  title,
  description,
  actions,
  id,
  variant = "panel",
  children,
  className,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={id === undefined ? undefined : `${id}-title`}
      className={cn(
        variant === "panel" ? "rounded-md border border-border bg-background p-4 sm:p-6" : undefined,
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id === undefined ? undefined : `${id}-title`} className="text-h2 text-foreground">
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="mt-1 max-w-reading text-dense text-text-muted">{description}</p>
          )}
        </div>

        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children}
    </section>
  )
}
