import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The top of a page: one h1, one sentence of context, and the actions that
// belong to the page rather than to a section.
//
// Rules this component enforces:
//   * exactly one h1 per page. Everything below it is an h2 (Section) or an h3
//     (a panel title), so the heading order never skips a level;
//   * breadcrumbs are a real nav with a list, and the last item is the page
//     itself: it is text, not a link, and carries aria-current;
//   * the actions sit on the same baseline as the title on a wide screen and
//     wrap under it on a phone, so a 44px button never crowds a 30px title.

/** One step in the breadcrumb trail. The last one is the page you are on. */
export interface Breadcrumb {
  label: string
  href?: string
}

export interface PageHeaderProps {
  /** The page title. Rendered as the page's only h1. */
  title: string
  /** One sentence: what this page is for. Optional but preferred. */
  description?: string
  /** Primary and secondary page actions. At most two, primary last. */
  actions?: ReactNode
  /** The trail above the title. The final entry is drawn as the current page. */
  breadcrumbs?: readonly Breadcrumb[]
  /** Extra content under the description, such as a status badge or a range. */
  children?: ReactNode
  /**
   * The heading level. Leave it at 1: a page has one h1. It is 2 only where a
   * PageHeader is shown as an example inside a page that already has its own
   * title, such as the style guide.
   */
  headingLevel?: 1 | 2
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  children,
  headingLevel = 1,
  className,
}: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2"

  return (
    <header className={cn("border-b border-border pb-5", className)}>
      {breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-text-muted">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1

              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-border-strong">
                      /
                    </span>
                  ) : null}
                  {crumb.href === undefined || last ? (
                    <span aria-current={last ? "page" : undefined} className={last ? "text-foreground" : undefined}>
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="rounded-sm underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-ring"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading className="text-h1 text-foreground">{title}</Heading>
          {description === undefined ? null : (
            <p className="mt-1 max-w-reading text-body text-text-muted">{description}</p>
          )}
          {children === undefined ? null : <div className="mt-3">{children}</div>}
        </div>

        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  )
}
