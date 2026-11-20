import { describe, expect, it } from "vitest"

import {
  AFFILIATE_COOKIE_DAYS,
  AFFILIATE_COOKIE_NAME,
  MAX_COOKIE_ENTRIES,
  MAX_COOKIE_LENGTH,
  attributionCookieOptions,
  mergeAttribution,
  parseAttributionCookie,
  readClickId,
  serialiseAttributionCookie,
} from "./cookie"

// The attribution cookie.
//
// It is written by this app and read from a request, and between those two
// moments a browser, a proxy or a person can do anything to it. So the parser is
// the part that matters: a malformed value has to come back empty, never as a
// half-understood entry.

const P1 = "11111111-1111-4111-8111-111111111111"
const P2 = "22222222-2222-4222-8222-222222222222"
const P3 = "33333333-3333-4333-8333-333333333333"
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function uuid(index: number, prefix: string): string {
  const tail = String(index).padStart(12, "0")

  return `${prefix}-0000-4000-8000-${tail}`
}

describe("parseAttributionCookie", () => {
  it("reads a single entry", () => {
    expect(parseAttributionCookie(`${P1}:${C1}`)).toEqual([{ productId: P1, clickId: C1 }])
  })

  it("reads several entries, oldest first", () => {
    expect(parseAttributionCookie(`${P1}:${C1}|${P2}:${C2}`)).toEqual([
      { productId: P1, clickId: C1 },
      { productId: P2, clickId: C2 },
    ])
  })

  it("answers an empty list for a missing, empty or oversized value", () => {
    expect(parseAttributionCookie(null)).toEqual([])
    expect(parseAttributionCookie(undefined)).toEqual([])
    expect(parseAttributionCookie("")).toEqual([])
    expect(parseAttributionCookie("   ")).toEqual([])
    expect(parseAttributionCookie("a".repeat(MAX_COOKIE_LENGTH + 1))).toEqual([])
  })

  it("skips malformed pairs instead of guessing", () => {
    expect(parseAttributionCookie("garbage")).toEqual([])
    expect(parseAttributionCookie("notauuid:notauuid")).toEqual([])
    expect(parseAttributionCookie(`${P1}`)).toEqual([])
    expect(parseAttributionCookie(`:${C1}`)).toEqual([])
    expect(parseAttributionCookie(`${P1}:`)).toEqual([])
    expect(parseAttributionCookie(`${P1}:${C1}|||`)).toEqual([{ productId: P1, clickId: C1 }])
    expect(parseAttributionCookie(`nonsense|${P1}:${C1}|also nonsense`)).toEqual([
      { productId: P1, clickId: C1 },
    ])
  })

  it("rejects a click id that is not a uuid, even with a valid product", () => {
    expect(parseAttributionCookie(`${P1}:not-a-click`)).toEqual([])
    expect(parseAttributionCookie(`${P1}:${C1}extra`)).toEqual([])
  })

  it("keeps the last click for a repeated product", () => {
    expect(parseAttributionCookie(`${P1}:${C1}|${P2}:${C2}|${P1}:${C3}`)).toEqual([
      { productId: P2, clickId: C2 },
      { productId: P1, clickId: C3 },
    ])
  })

  it("keeps at most twenty entries, dropping the oldest", () => {
    const entries = Array.from({ length: 21 }, (_, index) => ({
      productId: uuid(index + 1, "11111111"),
      clickId: uuid(index + 1, "22222222"),
    }))

    const parsed = parseAttributionCookie(serialiseAttributionCookie(entries))

    expect(parsed).toHaveLength(MAX_COOKIE_ENTRIES)
    expect(parsed[0]?.productId).toBe(uuid(2, "11111111"))
    expect(parsed[19]?.productId).toBe(uuid(21, "11111111"))
  })

  it("survives a value that was truncated in the middle of an entry", () => {
    expect(parseAttributionCookie(`${P1}:${C1}|${P2}:${C2.slice(0, 10)}`)).toEqual([
      { productId: P1, clickId: C1 },
    ])
  })
})

describe("serialiseAttributionCookie", () => {
  it("joins with a pipe", () => {
    expect(
      serialiseAttributionCookie([
        { productId: P1, clickId: C1 },
        { productId: P2, clickId: C2 },
      ]),
    ).toBe(`${P1}:${C1}|${P2}:${C2}`)
  })

  it("is empty for no entries", () => {
    expect(serialiseAttributionCookie([])).toBe("")
  })
})

describe("mergeAttribution", () => {
  it("replaces the entry for the same product and moves it last", () => {
    const merged = mergeAttribution(
      [
        { productId: P1, clickId: C1 },
        { productId: P2, clickId: C2 },
      ],
      { productId: P1, clickId: C3 },
    )

    expect(merged).toEqual([
      { productId: P2, clickId: C2 },
      { productId: P1, clickId: C3 },
    ])
  })

  it("adds a new product at the end", () => {
    const merged = mergeAttribution([{ productId: P1, clickId: C1 }], { productId: P2, clickId: C2 })

    expect(merged).toEqual([
      { productId: P1, clickId: C1 },
      { productId: P2, clickId: C2 },
    ])
  })

  it("drops the oldest entry past twenty", () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({
      productId: uuid(index + 1, "11111111"),
      clickId: uuid(index + 1, "22222222"),
    }))

    const merged = mergeAttribution(existing, { productId: P3, clickId: C3 })

    expect(merged).toHaveLength(20)
    expect(merged[0]?.productId).toBe(uuid(2, "11111111"))
    expect(merged[19]?.productId).toBe(P3)
  })

  it("does not grow when the same product is clicked again at twenty entries", () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({
      productId: uuid(index + 1, "11111111"),
      clickId: uuid(index + 1, "22222222"),
    }))

    const merged = mergeAttribution(existing, { productId: uuid(1, "11111111"), clickId: C3 })

    expect(merged).toHaveLength(20)
    expect(merged[19]?.clickId).toBe(C3)
  })
})

describe("readClickId", () => {
  it("finds the click for one product", () => {
    const value = `${P1}:${C1}|${P2}:${C2}`

    expect(readClickId(value, P1)).toBe(C1)
    expect(readClickId(value, P2)).toBe(C2)
  })

  it("answers null for a product that is not there", () => {
    expect(readClickId(`${P1}:${C1}`, P3)).toBeNull()
    expect(readClickId(null, P1)).toBeNull()
    expect(readClickId("nonsense", P1)).toBeNull()
  })

  it("uses the last entry when a product appears twice in a hand-edited value", () => {
    expect(readClickId(`${P1}:${C1}|${P1}:${C2}`, P1)).toBe(C2)
  })
})

describe("attributionCookieOptions", () => {
  it("is HttpOnly, Lax, path-wide and lasts thirty days", () => {
    const options = attributionCookieOptions({ production: true })

    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.path).toBe("/")
    expect(options.maxAge).toBe(AFFILIATE_COOKIE_DAYS * 24 * 60 * 60)
    expect(options.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it("is Secure in production and not on a development server", () => {
    expect(attributionCookieOptions({ production: true }).secure).toBe(true)
    expect(attributionCookieOptions({ production: false }).secure).toBe(false)
  })

  it("uses the documented name", () => {
    expect(AFFILIATE_COOKIE_NAME).toBe("afv_ref")
  })
})
