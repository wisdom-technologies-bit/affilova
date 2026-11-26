import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// What a list says when it has nothing in it.
//
// An empty state is not an apology. It says what would be here, why it is not,
// and what the person can do next: one primary action, at most one secondary.
// There is no illustration, no mascot and no exclamation mark.

export interface EmptyStateProps {
  /** A 20px icon from components/ds/icons. Decorative: the title carries the meaning. */
  icon?: ReactNode
  /** What is missing, in sentence case: "No products yet". */
  title: string
  /** One or two sentences: what will appear here once there is something. */
  description?: string
  /** The one thing to do next. Usually a Button. */
  primaryAction?: ReactNode
  /** A quieter alternative, such as "Read how payouts work". */
  secondaryAction?: ReactNode
  /** `card` adds the border, for an empty state standing on its own. */
  variant?: "card" | "inline"
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = "card",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-10 text-center",
        variant === "card" ? "rounded-md border border-border bg-background" : undefined,
        className,
      )}
    >
      {icon === undefined ? null : (
        <span
          aria-hidden="true"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-muted"
        >
          {icon}
        </span>
      )}

      <p className="text-body font-medium text-foreground">{title}</p>

      {description === undefined ? null : (
        <p className="mt-1 max-w-[52ch] text-dense text-text-muted">{description}</p>
      )}

      {primaryAction === undefined && secondaryAction === undefined ? null : (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
