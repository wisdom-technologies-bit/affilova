import { describe, expect, it, vi } from "vitest"

import { HIBP_TIMEOUT_MS, isPasswordBreached, parseHibpRangeResponse } from "./password"

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
// k-anonymity sends the first five characters and matches the rest locally.
const PREFIX = "5BAA6"
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } })
}

describe("parseHibpRangeResponse", () => {
  it("finds the suffix in the range response", () => {
    const body = [
      "0018A45C4D1DEF81644B54AB7F969B88D65:1",
      `${SUFFIX}:3861493`,
      "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2",
    ].join("\r\n")

    expect(parseHibpRangeResponse(body, SUFFIX)).toBe(true)
  })

  it("ignores entries with a count of zero (Add-Padding filler)", () => {
    const body = [`${SUFFIX}:0`, "0018A45C4D1DEF81644B54AB7F969B88D65:0"].join("\n")

    expect(parseHibpRangeResponse(body, SUFFIX)).toBe(false)
  })

  it("ignores a different hash in the same range", () => {
    expect(parseHibpRangeResponse("0018A45C4D1DEF81644B54AB7F969B88D65:5\n", SUFFIX)).toBe(false)
  })

  it("matches case-insensitively", () => {
    expect(parseHibpRangeResponse(`${SUFFIX.toLowerCase()}:7\n`, SUFFIX.toLowerCase())).toBe(true)
  })

  it("handles lines without a count and blank lines", () => {
    const body = ["", "not-a-hash", "0018A45C4D1DEF81644B54AB7F969B88D65", "", `${SUFFIX}:2`, ""].join(
      "\n",
    )

    expect(parseHibpRangeResponse(body, SUFFIX)).toBe(true)
  })

  it("returns false for an empty body", () => {
    expect(parseHibpRangeResponse("", SUFFIX)).toBe(false)
    expect(parseHibpRangeResponse("\r\n\r\n", SUFFIX)).toBe(false)
  })

  it("returns false for an empty suffix", () => {
    expect(parseHibpRangeResponse(`${SUFFIX}:3`, "")).toBe(false)
    expect(parseHibpRangeResponse(`${SUFFIX}:3`, "   ")).toBe(false)
  })

  it("returns false when the count is not a number", () => {
    expect(parseHibpRangeResponse(`${SUFFIX}:abc`, SUFFIX)).toBe(false)
  })
})

describe("isPasswordBreached", () => {
  it("asks the range API for the hash prefix only and reports a match", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([`${SUFFIX}:3861493`, "0018A45C4D1DEF81644B54AB7F969B88D65:0"].join("\r\n")),
    )

    const breached = await isPasswordBreached("password", fetchImpl as unknown as typeof fetch)

    expect(breached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined]

    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    expect(url).not.toContain(SUFFIX)
    expect(init?.headers).toMatchObject({ "Add-Padding": "true" })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("reports a password that is not in the range", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("0018A45C4D1DEF81644B54AB7F969B88D65:1\n"))

    await expect(
      isPasswordBreached("password", fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false)
  })

  it("hashes the password with SHA-1 and uppercases the prefix", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(""))

    await isPasswordBreached("password", fetchImpl as unknown as typeof fetch)

    const [url] = fetchImpl.mock.calls[0] as unknown as [string]

    expect(url.endsWith(PREFIX)).toBe(true)
  })

  it("fails open on a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })

    await expect(
      isPasswordBreached("password", fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false)
  })

  it("fails open on a 500 response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("upstream error", 500))

    await expect(
      isPasswordBreached("password", fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false)
  })

  it("fails open on a 429 response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("rate limited", 429))

    await expect(
      isPasswordBreached("password", fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false)
  })

  it("fails open when the request times out", async () => {
    let aborted = false

    const hangingFetch = vi.fn((_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true
          reject(new Error("aborted"))
        })
      })
    })

    const startedAt = Date.now()
    const breached = await isPasswordBreached(
      "password",
      hangingFetch as unknown as typeof fetch,
    )
    const elapsed = Date.now() - startedAt

    expect(breached).toBe(false)
    expect(aborted).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(HIBP_TIMEOUT_MS - 250)
  })

  it("fails open when the body cannot be read", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        text: async () => {
          throw new Error("body stream failed")
        },
      } as unknown as Response
    })

    await expect(
      isPasswordBreached("password", fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false)
  })
})
