import Link from "next/link"

import { RANGE_PRESETS, type RangePreset } from "@/lib/dates/lagos"

// The date range control: four presets as links and a custom form.
//
// It is plain HTML on purpose. A preset is an ordinary link, so the range is in
// the URL and the page can be bookmarked or shared; the custom form is a GET
// form, so it works before any JavaScript loads. The current preset is marked
// with aria-current, not only with a background colour.

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
                  className={`inline-flex min-h-[44px] items-center rounded-md border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                    current
                      ? "border-brand-600 bg-brand-50 font-medium text-brand-800"
                      : "border-border text-brand-ink hover:bg-accent"
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
          <label htmlFor="range-from" className="block text-xs font-medium text-muted-foreground">
            From
          </label>
          <input
            id="range-from"
            name="from"
            type="date"
            defaultValue={value.from}
            max={today}
            className="mt-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </div>

        <div>
          <label htmlFor="range-to" className="block text-xs font-medium text-muted-foreground">
            To
          </label>
          <input
            id="range-to"
            name="to"
            type="date"
            defaultValue={value.to}
            max={today}
            className="mt-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </div>

        <button
          type="submit"
          className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Apply range
        </button>
      </form>
    </div>
  )
}
