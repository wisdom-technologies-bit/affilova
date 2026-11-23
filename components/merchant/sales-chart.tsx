import type { VendorDailyPoint } from "@/lib/merchant/types"
import { formatNaira } from "@/lib/catalog/money"
import { formatLagosDate } from "@/lib/catalog/format"

// Gross sales per day, drawn with divs.
//
// No chart library: each day is one column whose height is its share of the
// busiest day. The figure carries a text alternative that states the range, the
// total and the busiest day, and the daily table underneath holds every number,
// so nothing here is only visible.

export function VendorSalesChart({
  points,
  title,
}: {
  points: readonly VendorDailyPoint[]
  title: string
}) {
  if (points.length === 0) {
    return (
      <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
        No days to draw yet.
      </p>
    )
  }

  const total = points.reduce((sum, point) => sum + point.grossKobo, 0)
  const busiest = points.reduce(
    (best, point) => (point.grossKobo > best.grossKobo ? point : best),
    points[0],
  )
  const max = Math.max(1, busiest.grossKobo)

  return (
    <figure className="rounded-md border border-border px-4 py-4">
      <figcaption className="text-sm font-medium text-brand-ink">{title}</figcaption>

      <div
        role="img"
        aria-label={`${title}: ${formatNaira(total)} over ${points.length} ${
          points.length === 1 ? "day" : "days"
        }. The busiest day was ${busiest.day} with ${formatNaira(busiest.grossKobo)}. The daily table below lists every day.`}
        className="mt-3 flex h-32 items-end gap-1 overflow-x-auto"
      >
        {points.map((point) => {
          const height = Math.round((point.grossKobo / max) * 100)

          return (
            <div
              key={point.day}
              aria-hidden="true"
              title={`${point.day}: ${formatNaira(point.grossKobo)}`}
              className="flex h-full min-w-[6px] flex-1 items-end"
            >
              <div
                className="w-full rounded-t-sm bg-brand-500"
                style={{ height: `${Math.max(height, point.grossKobo > 0 ? 4 : 1)}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatLagosDate(`${points[0].day}T12:00:00Z`)}</span>
        <span>{formatLagosDate(`${points[points.length - 1].day}T12:00:00Z`)}</span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Each bar is one day of gross sales. The busiest day was{" "}
        {formatLagosDate(`${busiest.day}T12:00:00Z`)} at {formatNaira(busiest.grossKobo)}.
      </p>
    </figure>
  )
}
