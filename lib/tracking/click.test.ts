import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CLICK_RATE_LIMIT,
  attributionSetCookie,
  cookieValueFromHeader,
  handleClick,
  referrerHost,
  type ClickDeps,
  type ClickRequest,
  type RecordClickInput,
  type RecordClickResult,
} from "./click"

// /r/<code>, without a Next.js runtime.
//
// The rules worth proving: a person's click is written before the cookie is set,
// a bot is redirected without either, anything unknown goes home with no cookie
// and no error, and every answer carries the same three headers.

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_PRODUCT = "22222222-2222-4222-8222-222222222222"
const CLICK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OLD_CLICK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const BOT_UA = "WhatsApp/2.23.20.0 A"

interface Fakes {
  deps: ClickDeps
  recorded: RecordClickInput[]
  targets: string[]
  limitCalls: { key: string; limit: number; windowSeconds: number; onError?: string }[]
}

function makeFakes(
  options: {
    allowed?: boolean
    record?: (input: RecordClickInput) => Promise<RecordClickResult>
    target?: string | null
    recordHangs?: boolean
  } = {},
): Fakes {
  const recorded: RecordClickInput[] = []
  const targets: string[] = []
  const limitCalls: { key: string; limit: number; windowSeconds: number; onError?: string }[] = []

  const deps: ClickDeps = {
    rateLimit: async (input) => {
      limitCalls.push({
        key: input.key,
        limit: input.limit,
        windowSeconds: input.windowSeconds,
        ...(input.onError === undefined ? {} : { onError: input.onError }),
      })

      return {
        allowed: options.allowed ?? true,
        remaining: 1,
        resetAt: new Date("2026-11-20T12:00:00.000Z"),
      }
    },
    // A stand-in digest: the real one is in hash.test.ts, and keeping the raw
    // address out of the fake is what makes the "nothing raw is stored"
    // assertions below mean something.
    hashIp: (ip, now) => `ip-hash:${ip.length}:${now.toISOString().slice(0, 10)}`,
    hashUa: (ua, now) => `ua-hash:${ua.length}:${now.toISOString().slice(0, 10)}`,
    recordClick: async (input) => {
      recorded.push(input)

      if (options.recordHangs === true) {
        return new Promise<RecordClickResult>(() => {
          // Never settles: the deadline has to give up on it.
        })
      }

      if (options.record !== undefined) {
        return options.record(input)
      }

      return { ok: true, productSlug: "open-product", productId: PRODUCT_ID }
    },
    getLinkTarget: async (code) => {
      targets.push(code)

      return options.target === undefined ? "open-product" : options.target
    },
    newClickId: () => CLICK_ID,
    now: () => new Date("2026-11-20T10:00:00.000Z"),
    rateLimitKey: (parts) => `key:${parts.join("|")}`,
  }

  return { deps, recorded, targets, limitCalls }
}

function makeRequest(overrides: Partial<ClickRequest> = {}): ClickRequest {
  return {
    code: "abcdefgh",
    searchParams: new URLSearchParams(),
    headers: new Headers({ "user-agent": HUMAN_UA }),
    cookieValue: null,
    production: true,
    clientIp: "203.0.113.7",
    ...overrides,
  }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe("a human click", () => {
  it("records the click, sets the cookie and sends the visitor to the product", async () => {
    const fakes = makeFakes()

    const response = await handleClick(makeRequest(), fakes.deps)

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/p/open-product")

    const cookie = response.headers.get("set-cookie")
    expect(cookie).toContain(`afv_ref=${PRODUCT_ID}:${CLICK_ID}`)
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain("Max-Age=2592000")
    expect(cookie).toContain("Secure")

    expect(fakes.recorded).toHaveLength(1)
    expect(fakes.recorded[0]?.clickId).toBe(CLICK_ID)
    expect(fakes.recorded[0]?.code).toBe("abcdefgh")
    expect(fakes.recorded[0]?.device).toBe("desktop")
  })

  it("does not mark the cookie Secure outside production", async () => {
    const fakes = makeFakes()

    const response = await handleClick(makeRequest({ production: false }), fakes.deps)

    expect(response.headers.get("set-cookie")).not.toContain("Secure")
  })

  it("keeps the entries already in the cookie", async () => {
    const fakes = makeFakes()

    const response = await handleClick(
      makeRequest({ cookieValue: `${OTHER_PRODUCT}:${OLD_CLICK}` }),
      fakes.deps,
    )

    const cookie = response.headers.get("set-cookie") ?? ""

    expect(cookie).toContain(`${OTHER_PRODUCT}:${OLD_CLICK}`)
    expect(cookie).toContain(`${PRODUCT_ID}:${CLICK_ID}`)
    expect(cookie.indexOf(OTHER_PRODUCT)).toBeLessThan(cookie.indexOf(PRODUCT_ID))
  })

  it("replaces an earlier click for the same product", async () => {
    const fakes = makeFakes()

    const response = await handleClick(makeRequest({ cookieValue: `${PRODUCT_ID}:${OLD_CLICK}` }), fakes.deps)

    const cookie = response.headers.get("set-cookie") ?? ""

    expect(cookie).toContain(`${PRODUCT_ID}:${CLICK_ID}`)
    expect(cookie).not.toContain(OLD_CLICK)
  })

  it("passes the campaign parameters through, sanitised", async () => {
    const fakes = makeFakes()

    await handleClick(
      makeRequest({
        searchParams: new URLSearchParams({
          s1: "instagram",
          s2: "<script>",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "launch-week",
        }),
      }),
      fakes.deps,
    )

    const call = fakes.recorded[0]

    expect(call?.sub1).toBe("instagram")
    expect(call?.sub2).toBeNull()
    expect(call?.utmSource).toBe("newsletter")
    expect(call?.utmMedium).toBe("email")
    expect(call?.utmCampaign).toBe("launch-week")
  })

  it("reads the country from the Vercel header", async () => {
    const fakes = makeFakes()

    await handleClick(
      makeRequest({ headers: new Headers({ "user-agent": HUMAN_UA, "x-vercel-ip-country": "NG" }) }),
      fakes.deps,
    )

    expect(fakes.recorded[0]?.country).toBe("NG")
  })

  it("stores the referrer host and never the full URL", async () => {
    const fakes = makeFakes()

    await handleClick(
      makeRequest({
        headers: new Headers({
          "user-agent": HUMAN_UA,
          referer: "https://www.instagram.com/stories/ada/12345?utm=secret#fragment",
        }),
      }),
      fakes.deps,
    )

    expect(fakes.recorded[0]?.referrerHost).toBe("www.instagram.com")
    expect(JSON.stringify(fakes.recorded[0])).not.toContain("stories")
    expect(JSON.stringify(fakes.recorded[0])).not.toContain("secret")
  })

  it("hashes the address and the agent and never passes either through", async () => {
    const fakes = makeFakes()

    await handleClick(makeRequest(), fakes.deps)

    expect(fakes.recorded[0]?.ipHash).toBe("ip-hash:11:2026-11-20")
    expect(fakes.recorded[0]?.uaHash).toBe(`ua-hash:${HUMAN_UA.length}:2026-11-20`)
    expect(JSON.stringify(fakes.recorded[0])).not.toContain("Mozilla")
    expect(JSON.stringify(fakes.recorded[0])).not.toContain("203.0.113.7")
  })
})

describe("a bot or a link preview", () => {
  it("is sent to the product without a click and without a cookie", async () => {
    const fakes = makeFakes()

    const response = await handleClick(
      makeRequest({ headers: new Headers({ "user-agent": BOT_UA }) }),
      fakes.deps,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/p/open-product")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(fakes.recorded).toHaveLength(0)
    expect(fakes.targets).toEqual(["abcdefgh"])
  })

  it("goes home when the link is not active", async () => {
    const fakes = makeFakes({ target: null })

    const response = await handleClick(
      makeRequest({ headers: new Headers({ "user-agent": BOT_UA }) }),
      fakes.deps,
    )

    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(fakes.recorded).toHaveLength(0)
  })
})

describe("what goes home", () => {
  it("sends an invalid code home without touching the database", async () => {
    const fakes = makeFakes()

    const response = await handleClick(makeRequest({ code: "../../etc/passwd" }), fakes.deps)

    expect(response.headers.get("location")).toBe("/")
    expect(fakes.recorded).toHaveLength(0)
    expect(fakes.targets).toHaveLength(0)
    expect(fakes.limitCalls).toHaveLength(0)
  })

  it("sends an unknown code home with no cookie and no message", async () => {
    const fakes = makeFakes({ record: async () => ({ ok: false, productSlug: null, productId: null }) })

    const response = await handleClick(makeRequest(), fakes.deps)

    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).toBe("")
  })

  it("sends an archived link home", async () => {
    const fakes = makeFakes({ record: async () => ({ ok: false, productSlug: null, productId: null }) })

    const response = await handleClick(makeRequest(), fakes.deps)

    expect(response.headers.get("location")).toBe("/")
  })

  it("goes home when the rate limit is exhausted, without recording", async () => {
    const fakes = makeFakes({ allowed: false })

    const response = await handleClick(makeRequest(), fakes.deps)

    expect(response.headers.get("location")).toBe("/")
    expect(fakes.recorded).toHaveLength(0)
  })

  it("uses the documented limit and lets a broken counter through", async () => {
    const fakes = makeFakes()

    await handleClick(makeRequest(), fakes.deps)

    expect(fakes.limitCalls[0]?.limit).toBe(CLICK_RATE_LIMIT)
    expect(fakes.limitCalls[0]?.limit).toBe(120)
    expect(fakes.limitCalls[0]?.windowSeconds).toBe(60)
    expect(fakes.limitCalls[0]?.onError).toBe("allow")
    // The key is built through rateLimitKey, which hashes its parts: the raw
    // address never reaches the counter table.
    expect(fakes.limitCalls[0]?.key).toContain("click")
  })

  it("goes home when the database throws", async () => {
    const fakes = makeFakes({
      record: async () => {
        throw new Error("record_click_failed")
      },
    })

    const response = await handleClick(makeRequest(), fakes.deps)

    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("gives up on a database call that hangs past the deadline", async () => {
    vi.useFakeTimers()

    const fakes = makeFakes({ recordHangs: true })
    const pending = handleClick(makeRequest(), fakes.deps)

    await vi.advanceTimersByTimeAsync(1300)

    const response = await pending

    expect(response.headers.get("location")).toBe("/")

    vi.useRealTimers()
  })
})

describe("every answer carries the same headers", () => {
  it("sets no-store, noindex and no-referrer on a success and on a failure", async () => {
    const success = await handleClick(makeRequest(), makeFakes().deps)
    const failure = await handleClick(makeRequest({ code: "x" }), makeFakes().deps)

    for (const response of [success, failure]) {
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("x-robots-tag")).toBe("noindex")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    }
  })
})

describe("the small helpers", () => {
  it("reads only our cookie out of a Cookie header", () => {
    expect(cookieValueFromHeader("a=1; afv_ref=x:y; b=2")).toBe("x:y")
    expect(cookieValueFromHeader("afv_ref=x:y")).toBe("x:y")
    expect(cookieValueFromHeader("other=1")).toBeNull()
    expect(cookieValueFromHeader(null)).toBeNull()
    expect(cookieValueFromHeader("afv_ref=")).toBe("")
  })

  it("takes the host from a referrer and nothing else", () => {
    expect(referrerHost("https://news.example.com/a/b?c=d")).toBe("news.example.com")
    expect(referrerHost("https://NEWS.Example.com")).toBe("news.example.com")
    expect(referrerHost("not a url")).toBeNull()
    expect(referrerHost("")).toBeNull()
    expect(referrerHost(null)).toBeNull()
  })

  it("writes a cookie string with every option it was asked for", () => {
    expect(attributionSetCookie("v", true)).toBe(
      "afv_ref=v; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure",
    )
    expect(attributionSetCookie("v", false)).toBe(
      "afv_ref=v; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
    )
  })
})
