import type { DailyPoint } from "@/lib/affiliate/read-types"
import { formatCount } from "@/lib/affiliate/definitions"

// Clicks per day, drawn with divs.
//
// No chart library: each day is one column whose height is its share of the
// busiest day. The figure carries a text alternative that states the range, the
// total and the busiest day, and the daily table underneath holds every number,
// so nothing here is only visible.

export function ClicksChart({
  points,
  title,
}: {
  points: readonly DailyPoint[]
  title: string
}) {
  if (points.length === 0) {
    return (
      <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
        No days to draw yet.
      </p>
    )
  }

  const total = points.reduce((sum, point) => sum + point.clicks, 0)
  const busiest = points.reduce(
    (best, point) => (point.clicks > best.clicks ? point : best),
    points[0],
  )
  const max = Math.max(1, busiest.clicks)

  return (
    <figure className="rounded-md border border-border px-4 py-4">
      <figcaption className="text-sm font-medium text-brand-ink">{title}</figcaption>

      <div
        role="img"
        aria-label={`${title}: ${formatCount(total)} clicks over ${points.length} ${
          points.length === 1 ? "day" : "days"
        }. The busiest day was ${busiest.day} with ${formatCount(busiest.clicks)} clicks. The daily table below lists every day.`}
        className="mt-3 flex h-32 items-end gap-1 overflow-x-auto"
      >
        {points.map((point) => {
          const height = Math.round((point.clicks / max) * 100)

          return (
            <div
              key={point.day}
              aria-hidden="true"
              title={`${point.day}: ${formatCount(point.clicks)} clicks`}
              className="flex h-full min-w-[6px] flex-1 items-end"
            >
              <div
                className="w-full rounded-t-sm bg-brand-500"
                style={{ height: `${Math.max(height, point.clicks > 0 ? 4 : 1)}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{points[0].day}</span>
        <span>{points[points.length - 1].day}</span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Each bar is one day. The busiest day had {formatCount(busiest.clicks)} clicks.
      </p>
    </figure>
  )
}
