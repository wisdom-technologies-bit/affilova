import { describe, expect, it } from "vitest"

import { deviceFromUserAgent, parseClickParams, sanitiseCode, sanitiseLabel } from "./params"

// Everything here arrives in a URL, which means it was written by whoever sent
// the link. The rule for each function is the same: a value is either plainly
// what it claims to be, or it is dropped.

function params(entries: Record<string, string>): { get: (name: string) => string | null } {
  const map = new Map(Object.entries(entries))

  return { get: (name) => map.get(name) ?? null }
}

describe("sanitiseCode", () => {
  it("accepts a generated code and an alias", () => {
    expect(sanitiseCode("abcdefgh")).toBe("abcdefgh")
    expect(sanitiseCode("ada-deals")).toBe("ada-deals")
    expect(sanitiseCode("23456789")).toBe("23456789")
  })

  it("lower-cases and trims, because links are shared by hand", () => {
    expect(sanitiseCode("  Ada-Deals ")).toBe("ada-deals")
  })

  it("refuses anything that is not a code", () => {
    expect(sanitiseCode("")).toBeNull()
    expect(sanitiseCode(null)).toBeNull()
    expect(sanitiseCode(undefined)).toBeNull()
    expect(sanitiseCode("ab")).toBeNull()
    expect(sanitiseCode("a".repeat(41))).toBeNull()
    expect(sanitiseCode("ada_deals")).toBeNull()
    expect(sanitiseCode("ada deals")).toBeNull()
  })

  it("refuses path traversal and injection attempts", () => {
    expect(sanitiseCode("../../etc/passwd")).toBeNull()
    expect(sanitiseCode("<script>alert(1)</script>")).toBeNull()
    expect(sanitiseCode("abc' OR 1=1--")).toBeNull()
    expect(sanitiseCode("abc;DROP TABLE affiliate_links")).toBeNull()
    expect(sanitiseCode("abc%00def")).toBeNull()
    expect(sanitiseCode("abc\nxyz")).toBeNull()
  })

  it("refuses a code with a leading or trailing hyphen", () => {
    expect(sanitiseCode("-abcdefg")).toBeNull()
    expect(sanitiseCode("abcdefg-")).toBeNull()
  })

  it("refuses unicode, however it is written", () => {
    expect(sanitiseCode("adá-deals")).toBeNull()
    expect(sanitiseCode("αdα-deals")).toBeNull()
    expect(sanitiseCode("ada-deals-😀")).toBeNull()
    expect(sanitiseCode("ａｄａ-ｄｅａｌｓ")).toBeNull()
  })
})

describe("sanitiseLabel", () => {
  it("accepts a plain word", () => {
    expect(sanitiseLabel("newsletter")).toBe("newsletter")
    expect(sanitiseLabel("instagram_bio-2")).toBe("instagram_bio-2")
  })

  it("lower-cases and trims", () => {
    expect(sanitiseLabel("  Instagram-Bio ")).toBe("instagram-bio")
  })

  it("refuses an empty value, a long one, or anything not a word", () => {
    expect(sanitiseLabel("")).toBeNull()
    expect(sanitiseLabel(null)).toBeNull()
    expect(sanitiseLabel("a".repeat(61))).toBeNull()
    expect(sanitiseLabel("two words")).toBeNull()
    expect(sanitiseLabel("<b>bold</b>")).toBeNull()
    expect(sanitiseLabel("a'b")).toBeNull()
    expect(sanitiseLabel("emoji😀")).toBeNull()
    expect(sanitiseLabel("café")).toBeNull()
  })

  it("keeps exactly 60 characters and drops 61", () => {
    expect(sanitiseLabel("a".repeat(60))).toBe("a".repeat(60))
    expect(sanitiseLabel("a".repeat(61))).toBeNull()
  })
})

describe("parseClickParams", () => {
  it("reads the three sub ids and the three utm values", () => {
    const parsed = parseClickParams(
      params({
        s1: "instagram",
        s2: "bio",
        s3: "story-2",
        utm_source: "newsletter",
        utm_medium: "email",
        utm_campaign: "launch-week",
      }),
    )

    expect(parsed).toEqual({
      sub1: "instagram",
      sub2: "bio",
      sub3: "story-2",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch-week",
    })
  })

  it("answers null for every missing value", () => {
    expect(parseClickParams(params({}))).toEqual({
      sub1: null,
      sub2: null,
      sub3: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    })
  })

  it("drops a value that is not a plain word instead of cleaning it up", () => {
    const parsed = parseClickParams(
      params({
        s1: "<script>alert(1)</script>",
        s2: "a".repeat(200),
        s3: "instagram bio",
        utm_source: "'; DROP TABLE affiliate_clicks; --",
        utm_medium: "café",
        utm_campaign: "ok-1",
      }),
    )

    expect(parsed.sub1).toBeNull()
    expect(parsed.sub2).toBeNull()
    expect(parsed.sub3).toBeNull()
    expect(parsed.utmSource).toBeNull()
    expect(parsed.utmMedium).toBeNull()
    expect(parsed.utmCampaign).toBe("ok-1")
  })
})

describe("deviceFromUserAgent", () => {
  it("recognises a phone", () => {
    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("mobile")

    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("mobile")
  })

  it("recognises a tablet, including an Android one that omits Mobile", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe(
      "tablet",
    )
    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
      ),
    ).toBe("tablet")
  })

  it("recognises a desktop", () => {
    expect(
      deviceFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("desktop")
  })

  it("answers other for anything it cannot place", () => {
    expect(deviceFromUserAgent("")).toBe("other")
    expect(deviceFromUserAgent(null)).toBe("other")
    expect(deviceFromUserAgent("curl/8.4.0")).toBe("other")
  })
})
