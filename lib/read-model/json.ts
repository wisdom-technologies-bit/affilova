// Reading the database's JSON without trusting it.
//
// The read models answer jsonb, which arrives as unknown on this side of the
// wire. Nothing is cast and nothing is assumed: a field that is not the shape it
// should be becomes a default, and a row that has no id is dropped, so a changed
// database function cannot crash a page.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A whole number of kobo or a count, from a number or a numeric string. */
export function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value)

    return Number.isSafeInteger(parsed) ? parsed : fallback
  }

  return fallback
}

export function toText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function toTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

export function toBoolean(value: unknown): boolean {
  return value === true
}
