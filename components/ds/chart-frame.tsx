import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { CHART_PALETTE } from "@/lib/design/tokens"

// The frame around a chart: the title, the legend, and a text alternative that
// says what the chart shows in words.
//
// A chart is a picture of a table. Everyone who cannot see it is owed the same
// fact, so the frame requires:
//   * a title, drawn as the section's h3 and used as the figure's accessible
//     name;
//   * a text alternative: one or two sentences with the actual numbers, not "a
//     chart of clicks". It is read by a screen reader and visible to everyone in
//     a disclosure, because a sighted reader on a phone often wants it too;
//   * a legend in words, drawn from the same series names as the chart, with the
//     marker shape and dash pattern each series uses. Hue is never the only
//     difference between two lines.
//
// The chart itself is passed as children and owns its own markup.

export interface ChartFrameProps {
  /** What the chart is: "Clicks per day". Rendered as the h3. */
  title: string
  /** The numbers in words. Required: a chart without one is a decoration. */
  textAlternative: string
  /** The series names, in the order the chart draws them. */
  series?: readonly string[]
  /** The action for the chart, such as "Download the data". */
  actions?: ReactNode
  /** How many series the chart draws. Used for the legend colours. */
  children: ReactNode
  className?: string
}

export function ChartFrame({
  title,
  textAlternative,
  series = [],
  actions,
  children,
  className,
}: ChartFrameProps) {
  return (
    <figure className={cn("rounded-md border border-border bg-background p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-h3 text-foreground">{title}</h3>
        {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {series.length === 0 ? null : (
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((name, index) => {
            const palette = CHART_PALETTE[index % CHART_PALETTE.length]

            return (
              <li key={name} className="flex items-center gap-1.5 text-caption text-text-muted">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 8"
                  className="h-2 w-4 shrink-0"
                  style={{ color: palette.hex }}
                >
                  <line
                    x1="0"
                    y1="4"
                    x2="16"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={palette.dash === "none" ? undefined : palette.dash}
                  />
                  <circle cx="8" cy="4" r="2.5" fill="currentColor" />
                </svg>
                {name}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3">{children}</div>

      <figcaption className="mt-3 border-t border-border pt-2">
        <details>
          <summary className="focus-ring inline-flex min-h-control-sm cursor-pointer items-center rounded-sm text-small font-medium text-text-muted">
            The numbers in words
          </summary>
          <p className="mt-1 max-w-reading text-dense text-text-muted">{textAlternative}</p>
        </details>
      </figcaption>
    </figure>
  )
}
