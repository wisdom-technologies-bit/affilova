import { describe, expect, it } from "vitest"

import {
  addDays,
  daysInclusive,
  isLagosDay,
  lagosDayEndUtc,
  lagosDayOf,
  lagosDayStartUtc,
  MAX_RANGE_DAYS,
  RANGE_ERRORS,
  resolveRange,
} from "./lagos"

// The Lagos calendar, tested as a table.
//
// The interesting cases are the boundaries: the instant just before and just
// after midnight in Lagos (23:00 UTC), the first and last day of a month, and
// New Year's Eve, where a range computed in UTC would be a day out.

describe("lagosDayOf", () => {
  it("puts 23:30 UTC on the next Lagos day", () => {
    expect(lagosDayOf(new Date("2026-11-18T23:30:00.000Z"))).toBe("2026-11-19")
  })

  it("puts 22:59:59.999 UTC on the same Lagos day", () => {
    expect(lagosDayOf(new Date("2026-11-18T22:59:59.999Z"))).toBe("2026-11-18")
  })

  it("puts 00:30 UTC on the Lagos day that has already started", () => {
    expect(lagosDayOf(new Date("2026-11-19T00:30:00.000Z"))).toBe("2026-11-19")
  })

  it("rolls the year at Lagos midnight, not UTC midnight", () => {
    expect(lagosDayOf(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01")
    expect(lagosDayOf(new Date("2026-12-31T22:30:00.000Z"))).toBe("2026-12-31")
  })
})

describe("day arithmetic", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01")
    expect(addDays("2026-12-01", -1)).toBe("2026-11-30")
  })

  it("crosses a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01")
  })

  it("counts the same day as one day", () => {
    expect(daysInclusive("2026-11-19", "2026-11-19")).toBe(1)
    expect(daysInclusive("2026-11-01", "2026-11-30")).toBe(30)
  })

  it("refuses a date that does not exist", () => {
    expect(isLagosDay("2026-02-30")).toBe(false)
    expect(isLagosDay("2026-13-01")).toBe(false)
    expect(isLagosDay("19-11-2026")).toBe(false)
    expect(isLagosDay("2026-11-19")).toBe(true)
  })
})

describe("Lagos day boundaries", () => {
  it("starts a day at 23:00 UTC the evening before", () => {
    expect(lagosDayStartUtc("2026-11-19").toISOString()).toBe("2026-11-18T23:00:00.000Z")
  })

  it("ends a day at 22:59:59.999 UTC", () => {
    expect(lagosDayEndUtc("2026-11-19").toISOString()).toBe("2026-11-19T22:59:59.999Z")
  })

  it("keeps a whole day inside its own boundaries", () => {
    const start = lagosDayStartUtc("2026-03-01")
    const end = lagosDayEndUtc("2026-03-01")

    expect(lagosDayOf(new Date(start.getTime() + 1))).toBe("2026-03-01")
    expect(lagosDayOf(new Date(end.getTime() - 1))).toBe("2026-03-01")
    expect(lagosDayOf(end)).toBe("2026-03-01")
  })
})

describe("resolveRange presets", () => {
  const now = new Date("2026-11-20T15:23:00.000Z")

  it("today is one Lagos day", () => {
    const result = resolveRange({ preset: "today" }, now)

    expect(result).toEqual({
      ok: true,
      range: {
        preset: "today",
        from: "2026-11-20",
        to: "2026-11-20",
        fromUtc: "2026-11-19T23:00:00.000Z",
        toUtc: "2026-11-20T22:59:59.999Z",
      },
    })
  })

  it("last 7 days includes today and the six before it", () => {
    const result = resolveRange({ preset: "last7" }, now)

    expect(result.ok && result.range.from).toBe("2026-11-14")
    expect(result.ok && result.range.to).toBe("2026-11-20")
    expect(result.ok && daysInclusive(result.range.from, result.range.to)).toBe(7)
  })

  it("last 30 days includes today and the twenty-nine before it", () => {
    const result = resolveRange({ preset: "last30" }, now)

    expect(result.ok && result.range.from).toBe("2026-10-22")
    expect(result.ok && result.range.to).toBe("2026-11-20")
  })

  it("this month starts on the first", () => {
    const result = resolveRange({ preset: "thisMonth" }, now)

    expect(result.ok && result.range.from).toBe("2026-11-01")
    expect(result.ok && result.range.to).toBe("2026-11-20")
  })

  it("this month on the first is a single day", () => {
    const result = resolveRange({ preset: "thisMonth" }, new Date("2026-03-01T09:00:00.000Z"))

    expect(result.ok && result.range.from).toBe("2026-03-01")
    expect(result.ok && result.range.to).toBe("2026-03-01")
  })

  it("this month crosses a year in January", () => {
    const result = resolveRange({ preset: "thisMonth" }, new Date("2027-01-02T09:00:00.000Z"))

    expect(result.ok && result.range.from).toBe("2027-01-01")
    expect(result.ok && result.range.to).toBe("2027-01-02")
  })

  it("last 7 days on 1 January reaches back into December", () => {
    const result = resolveRange({ preset: "last7" }, new Date("2027-01-01T09:00:00.000Z"))

    expect(result.ok && result.range.from).toBe("2026-12-26")
    expect(result.ok && result.range.to).toBe("2027-01-01")
  })

  it("uses the Lagos day at 23:30 UTC, not the UTC day", () => {
    const result = resolveRange({ preset: "today" }, new Date("2026-11-18T23:30:00.000Z"))

    expect(result.ok && result.range.from).toBe("2026-11-19")
  })

  it("falls back to last 30 days for a missing or unknown preset", () => {
    const missing = resolveRange({}, now)
    const unknown = resolveRange({ preset: "lastYear" }, now)

    expect(missing.ok && missing.range.preset).toBe("last30")
    expect(unknown.ok && unknown.range.preset).toBe("last30")
    expect(missing.ok && missing.range.from).toBe("2026-10-22")
  })
})

describe("resolveRange custom", () => {
  const now = new Date("2026-11-20T15:23:00.000Z")

  it("takes the days it is given", () => {
    const result = resolveRange({ preset: "custom", from: "2026-11-01", to: "2026-11-20" }, now)

    expect(result).toEqual({
      ok: true,
      range: {
        preset: "custom",
        from: "2026-11-01",
        to: "2026-11-20",
        fromUtc: "2026-10-31T23:00:00.000Z",
        toUtc: "2026-11-20T22:59:59.999Z",
      },
    })
  })

  it("allows a range of exactly 366 days", () => {
    const result = resolveRange(
      { preset: "custom", from: "2025-01-01", to: addDays("2025-01-01", MAX_RANGE_DAYS - 1) },
      now,
    )

    expect(result.ok).toBe(true)
  })

  it("refuses a range one day longer", () => {
    const result = resolveRange(
      { preset: "custom", from: "2025-01-01", to: addDays("2025-01-01", MAX_RANGE_DAYS) },
      now,
    )

    expect(result).toEqual({ ok: false, error: RANGE_ERRORS.tooLong })
  })

  it("refuses a missing date", () => {
    expect(resolveRange({ preset: "custom", from: "2026-11-01" }, now)).toEqual({
      ok: false,
      error: RANGE_ERRORS.customIncomplete,
    })
    expect(resolveRange({ preset: "custom", to: "2026-11-01" }, now)).toEqual({
      ok: false,
      error: RANGE_ERRORS.customIncomplete,
    })
  })

  it("refuses a date that does not exist", () => {
    expect(resolveRange({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, now)).toEqual({
      ok: false,
      error: RANGE_ERRORS.invalidDay,
    })
  })

  it("refuses a backwards range", () => {
    expect(resolveRange({ preset: "custom", from: "2026-11-20", to: "2026-11-01" }, now)).toEqual({
      ok: false,
      error: RANGE_ERRORS.backwards,
    })
  })

  it("accepts the same day at both ends", () => {
    const result = resolveRange({ preset: "custom", from: "2026-11-20", to: "2026-11-20" }, now)

    expect(result.ok && daysInclusive(result.range.from, result.range.to)).toBe(1)
  })
})
