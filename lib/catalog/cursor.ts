// Opaque page cursors. The value is a small JSON object, base64url encoded, and
// is never trusted: it is parsed and checked on the way back in.

import { z } from "zod"

const cursorPayloadSchema = z
  .object({
    // The value the list is ordered by, and the id that breaks a tie.
    at: z.string().min(1).max(40),
    id: z.string().uuid(),
  })
  .strict()

export type CursorPayload = z.infer<typeof cursorPayloadSchema>

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

/** The decoded cursor, or null when it is missing or malformed. */
export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (cursor === undefined || cursor === "") {
    return null
  }

  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    const result = cursorPayloadSchema.safeParse(json)

    return result.success ? result.data : null
  } catch {
    return null
  }
}
