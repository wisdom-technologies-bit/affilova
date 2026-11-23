import { describe, expect, it } from "vitest"

// The cursor a page hands back and forth.
//
// A cursor is a token: it encodes the JSON object the read model answered with,
// and a value that does not decode is refused rather than silently starting the
// list again from the top.

import { decodeCursor, encodeCursor } from "./cursor"

describe("encodeCursor", () => {
  it("rounds trips an object", () => {
    const cursor = encodeCursor({ v: "1763000000.000000", id: "abc" })

    expect(cursor).not.toBeNull()
    expect(decodeCursor(cursor ?? "")).toEqual({
      ok: true,
      value: { v: "1763000000.000000", id: "abc" },
    })
  })

  it("is url safe", () => {
    const cursor = encodeCursor({ id: "a/b+c=", v: "x" }) ?? ""

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("answers null when there is no next page", () => {
    expect(encodeCursor(null)).toBeNull()
    expect(encodeCursor("text")).toBeNull()
    expect(encodeCursor([1, 2])).toBeNull()
    expect(encodeCursor(undefined)).toBeNull()
  })
})

describe("decodeCursor", () => {
  it("reads an absent cursor as the first page", () => {
    expect(decodeCursor(undefined)).toEqual({ ok: true, value: null })
    expect(decodeCursor("")).toEqual({ ok: true, value: null })
  })

  it("refuses a value that is not a cursor", () => {
    expect(decodeCursor("not-a-cursor")).toEqual({ ok: false })
    expect(decodeCursor(Buffer.from("{oops", "utf8").toString("base64url"))).toEqual({ ok: false })
  })

  it("refuses a cursor that is not JSON", () => {
    expect(decodeCursor(Buffer.from("nope", "utf8").toString("base64url"))).toEqual({ ok: false })
  })
})
