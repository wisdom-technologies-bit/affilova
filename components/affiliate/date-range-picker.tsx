import Link from "next/link"

import { RANGE_PRESETS, type RangePreset } from "@/lib/dates/lagos"

// The date range control: four presets as links and a custom form.
//
// It is plain HTML on purpose. A preset is an ordinary link, so the range is in
// the URL and the page can be bookmarked or shared; the custom form is a GET
// form, so it works before any JavaScript loads. The current preset is marked
// with aria-current and a border, not only with a background colour.
//
// Every control is 44px tall, which is the touch minimum: this row is used on a
// phone as often as on a desktop, and two date inputs side by side are easy to
// miss.

function buildHref(
  basePath: string,
  params: Readonly<Record<string, string | undefined>>,
  preset: RangePreset,
): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value)
    }
  }

  search.set("preset", preset)

  return `${basePath}?${search.toString()}`
}

const DATE_INPUT =
  "focus-ring mt-1 h-control-md rounded-md border border-border-control bg-background px-3 text-dense text-foreground"

export function DateRangePicker({
  value,
  basePath,
  params = {},
  today,
}: {
  value: { preset: RangePreset; from: string; to: string }
  basePath: string
  params?: Readonly<Record<string, string | undefined>>
  today: string
}) {
  return (
    <div className="space-y-3">
      <nav aria-label="Date range">
        <ul className="flex flex-wrap gap-1">
          {RANGE_PRESETS.filter((preset) => preset.value !== "custom").map((preset) => {
            const current = preset.value === value.preset

            return (
              <li key={preset.value}>
                <Link
                  href={buildHref(basePath, params, preset.value)}
                  aria-current={current ? "page" : undefined}
                  className={`focus-ring inline-flex h-control-md items-center rounded-md border px-3 text-small transition-colors duration-150 ${
                    current
                      ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                      : "border-border text-text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="preset" value="custom" />
        {Object.entries(params).map(([key, value]) =>
          value === undefined || value === "" ? null : (
            <input key={key} type="hidden" name={key} value={value} />
          ),
        )}

        <div>
          <label htmlFor="range-from" className="block text-small font-medium text-text-muted">
            From
          </label>
          <input
            id="range-from"
            name="from"
            type="date"
            defaultValue={value.from}
            max={today}
            className={DATE_INPUT}
          />
        </div>

        <div>
          <label htmlFor="range-to" className="block text-small font-medium text-text-muted">
            To
          </label>
          <input
            id="range-to"
            name="to"
            type="date"
            defaultValue={value.to}
            max={today}
            className={DATE_INPUT}
          />
        </div>

        <button
          type="submit"
          className="focus-ring inline-flex h-control-md items-center rounded-md border border-border-control bg-background px-4 text-small font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
        >
          Apply range
        </button>
      </form>
    </div>
  )
}
