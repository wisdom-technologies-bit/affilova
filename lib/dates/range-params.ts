// Reading the range out of a page's query string.
//
// A page never trusts its own URL: an unknown preset, a missing date or a range
// of five years becomes the default last 30 days plus one sentence explaining
// why, instead of an error page or an empty screen.

import { resolveRange, type LagosRange } from "@/lib/dates/lagos"

export type SearchParams = Record<string, string | string[] | undefined>

/** The first value for a query key, or undefined. */
export function firstParam(params: SearchParams, key: string): string | undefined {
  const value = params[key]

  return Array.isArray(value) ? value[0] : value
}

function defaultRange(now: Date): LagosRange {
  const result = resolveRange({ preset: "last30" }, now)

  if (!result.ok) {
    // Unreachable: the default preset needs no input.
    throw new Error("default affiliate range is invalid")
  }

  return result.range
}

export function readRange(
  params: SearchParams,
  now: Date,
): { range: LagosRange; error: string | null } {
  const result = resolveRange(
    {
      preset: firstParam(params, "preset"),
      from: firstParam(params, "from"),
      to: firstParam(params, "to"),
    },
    now,
  )

  if (result.ok) {
    return { range: result.range, error: null }
  }

  return { range: defaultRange(now), error: result.error }
}
