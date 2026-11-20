// Lagos days, and the ranges the affiliate screens ask for.
//
// A "day" everywhere in the affiliate screens is a calendar day in
// Africa/Lagos, because that is the clock the people reading the numbers work
// to. Nigeria is UTC+1 all year, but the offset is read from the runtime's time
// zone data rather than assumed, so a change in that rule cannot silently shift
// a report by an hour.
//
// Everything here is pure: it takes a Date and returns strings. Nothing reads
// the clock, the environment or the database, so every branch is table-tested.
//
// The two boundary helpers exist because the database functions take whole Lagos
// days (a date) while the overview takes instants (timestamptz). fromUtc is
// 00:00:00.000 on the first day and toUtc is 23:59:59.999 on the last day, both
// expressed as the Lagos wall clock, so a range never leaks into the next day.

const LAGOS = "Africa/Lagos"

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

/** The longest range the screens accept, inclusive. */
export const MAX_RANGE_DAYS = 366

export type RangePreset = "today" | "last7" | "last30" | "thisMonth" | "custom"

export const RANGE_PRESETS: readonly { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "custom", label: "Custom" },
]

export interface LagosRange {
  preset: RangePreset
  /** First Lagos day, "YYYY-MM-DD", inclusive. */
  from: string
  /** Last Lagos day, "YYYY-MM-DD", inclusive. */
  to: string
  /** The instant the first day starts, as an ISO timestamp. */
  fromUtc: string
  /** The instant the last day ends (23:59:59.999 Lagos), as an ISO timestamp. */
  toUtc: string
}

export type RangeResult = { ok: true; range: LagosRange } | { ok: false; error: string }

export const RANGE_ERRORS = {
  customIncomplete: "Choose a start date and an end date.",
  invalidDay: "Enter both dates as calendar dates.",
  backwards: "The start date must be on or before the end date.",
  tooLong: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
} as const

type DayParts = { year: number; month: number; day: number }

function pad(value: number): string {
  return value.toString().padStart(2, "0")
}

function formatDay(parts: DayParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`
}

/** The calendar date of an instant in Lagos, as "YYYY-MM-DD". */
export function lagosDayOf(instant: Date): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(instant)
  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type)

    return found === undefined ? 0 : Number(found.value)
  }

  return formatDay({ year: read("year"), month: read("month"), day: read("day") })
}

function parseDay(day: string): DayParts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null
  }

  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))

  if (month < 1 || month > 12 || date < 1 || date > 31) {
    return null
  }

  // Round-trip through UTC so 31 February and 29 February in a common year are
  // refused instead of silently rolling into the next month.
  const probe = new Date(Date.UTC(year, month - 1, date))

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== date
  ) {
    return null
  }

  return { year, month, day: date }
}

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isLagosDay(value: string): boolean {
  return parseDay(value) !== null
}

function utcDayNumber(parts: DayParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS
}

/** The day n days after `day` (n may be negative). Calendar arithmetic, no zone. */
export function addDays(day: string, days: number): string {
  const parts = parseDay(day)

  if (parts === null) {
    throw new Error(`addDays: not a calendar date: ${day}`)
  }

  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))

  return formatDay({
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  })
}

/** How many days the inclusive range covers: the same day is 1. */
export function daysInclusive(from: string, to: string): number {
  const start = parseDay(from)
  const end = parseDay(to)

  if (start === null || end === null) {
    throw new Error("daysInclusive: not a calendar date")
  }

  return utcDayNumber(end) - utcDayNumber(start) + 1
}

function lagosOffsetMinutes(instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(instant)
  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type)

    return found === undefined ? 0 : Number(found.value)
  }

  const wall = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  )

  return Math.round((wall - instant.getTime()) / MINUTE_MS)
}

/**
 * The instant 00:00:00.000 Lagos begins on `day`.
 *
 * The offset is looked up twice: once at the UTC guess and once at the answer,
 * so the result stays right even on a day the zone rule changes.
 */
export function lagosDayStartUtc(day: string): Date {
  const parts = parseDay(day)

  if (parts === null) {
    throw new Error(`lagosDayStartUtc: not a calendar date: ${day}`)
  }

  const guess = Date.UTC(parts.year, parts.month - 1, parts.day)
  const firstOffset = lagosOffsetMinutes(new Date(guess))
  const firstAnswer = guess - firstOffset * MINUTE_MS
  const secondOffset = lagosOffsetMinutes(new Date(firstAnswer))

  return new Date(secondOffset === firstOffset ? firstAnswer : guess - secondOffset * MINUTE_MS)
}

/** The last instant of `day` in Lagos: 23:59:59.999. */
export function lagosDayEndUtc(day: string): Date {
  return new Date(lagosDayStartUtc(addDays(day, 1)).getTime() - 1)
}

function makeRange(preset: RangePreset, from: string, to: string): LagosRange {
  return {
    preset,
    from,
    to,
    fromUtc: lagosDayStartUtc(from).toISOString(),
    toUtc: lagosDayEndUtc(to).toISOString(),
  }
}

/**
 * Turn what the page was asked for into a range of Lagos days.
 *
 * A missing or unknown preset is the default (the last 30 days), so a stale
 * bookmark cannot break a screen. A custom range is checked strictly: both
 * dates must be real calendar dates, in order, and no longer than
 * {@link MAX_RANGE_DAYS} days.
 */
export function resolveRange(
  input: { preset?: string | undefined; from?: string | undefined; to?: string | undefined },
  now: Date,
): RangeResult {
  const requested = input.preset
  const today = lagosDayOf(now)

  switch (requested) {
    case "today":
      return { ok: true, range: makeRange("today", today, today) }
    case "last7":
      return { ok: true, range: makeRange("last7", addDays(today, -6), today) }
    case "thisMonth": {
      const parts = parseDay(today)

      if (parts === null) {
        return { ok: false, error: RANGE_ERRORS.invalidDay }
      }

      return {
        ok: true,
        range: makeRange("thisMonth", formatDay({ ...parts, day: 1 }), today),
      }
    }
    case "custom": {
      const from = (input.from ?? "").trim()
      const to = (input.to ?? "").trim()

      if (from === "" || to === "") {
        return { ok: false, error: RANGE_ERRORS.customIncomplete }
      }

      if (!isLagosDay(from) || !isLagosDay(to)) {
        return { ok: false, error: RANGE_ERRORS.invalidDay }
      }

      if (from > to) {
        return { ok: false, error: RANGE_ERRORS.backwards }
      }

      if (daysInclusive(from, to) > MAX_RANGE_DAYS) {
        return { ok: false, error: RANGE_ERRORS.tooLong }
      }

      return { ok: true, range: makeRange("custom", from, to) }
    }
    default:
      return { ok: true, range: makeRange("last30", addDays(today, -29), today) }
  }
}
