// Page cursors, encoded for the browser.
//
// A database read model answers with an opaque JSON object (the sort value and
// the id of the last row of the page). The screens hand that object back exactly
// as they received it, so it travels base64url encoded: a cursor is a token, not
// something a person edits, and a value that does not decode is refused rather
// than silently starting again from the first page.

/** The cursor a page answers with, or null when there is no next page. */
export function encodeCursor(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

export type DecodedCursor = { ok: true; value: unknown } | { ok: false }

/**
 * The JSON behind a cursor string.
 *
 * An absent or empty cursor means "the first page" and decodes to null. Anything
 * that is not valid base64url JSON is refused.
 */
export function decodeCursor(cursor: string | undefined): DecodedCursor {
  if (cursor === undefined || cursor === "") {
    return { ok: true, value: null }
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) }
  } catch {
    return { ok: false }
  }
}
