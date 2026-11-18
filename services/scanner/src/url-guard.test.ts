import { describe, expect, it } from "vitest"

import { CALLBACK_PATH, checkCallbackUrl, checkDownloadUrl, isIpLiteralHost } from "#url-guard"

const SUFFIX = ".r2.cloudflarestorage.com"

const ORIGINS = ["https://app.affilova.test", "https://staging.affilova.test:8443"]

describe("checkDownloadUrl", () => {
  it("accepts a signed object URL on the storage host", () => {
    const result = checkDownloadUrl(
      "https://bucket.r2.cloudflarestorage.com/vendor/file.pdf?X-Amz-Signature=abc",
      SUFFIX,
    )

    expect(result.ok).toBe(true)
  })

  it("accepts an uppercase host and works on the normalised hostname", () => {
    const result = checkDownloadUrl("https://BUCKET.R2.CLOUDFLARESTORAGE.COM/file.pdf", SUFFIX)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.url.hostname).toBe("bucket.r2.cloudflarestorage.com")
    }
  })

  it.each([
    ["a userinfo trick", "https://a.r2.cloudflarestorage.com@evil.com/file.pdf"],
    ["userinfo with a password", "https://user:pass@a.r2.cloudflarestorage.com/file.pdf"],
    ["a plain http URL", "http://a.r2.cloudflarestorage.com/file.pdf"],
    ["an explicit port", "https://a.r2.cloudflarestorage.com:8443/file.pdf"],
    ["a trailing dot", "https://a.r2.cloudflarestorage.com./file.pdf"],
    ["an IPv4 literal", "https://127.0.0.1/file.pdf"],
    ["an IPv6 literal", "https://[::1]/file.pdf"],
    ["an integer host", "https://2130706433/file.pdf"],
    ["a hex host", "https://0x7f000001/file.pdf"],
    ["a look-alike suffix", "https://a.r2.cloudflarestorage.com.evil.com/file.pdf"],
    ["the suffix in the path", "https://evil.com/a.r2.cloudflarestorage.com/file.pdf"],
    ["the suffix in the query", "https://evil.com/?host=a.r2.cloudflarestorage.com"],
    ["the bare suffix without a bucket", "https://r2.cloudflarestorage.com/file.pdf"],
    ["a non https scheme", "ftp://a.r2.cloudflarestorage.com/file.pdf"],
    ["a protocol relative URL", "//a.r2.cloudflarestorage.com/file.pdf"],
    ["an empty string", ""],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, value) => {
    const result = checkDownloadUrl(value, SUFFIX)

    expect(result.ok).toBe(false)
  })

  it.each([[undefined], [null], [42], [{}], [["https://a.r2.cloudflarestorage.com/x"]]])(
    "rejects the non-string %s",
    (value) => {
      expect(checkDownloadUrl(value, SUFFIX).ok).toBe(false)
    },
  )

  it("accepts the default port spelled out, which the parser normalises away", () => {
    const result = checkDownloadUrl("https://a.r2.cloudflarestorage.com:443/file.pdf", SUFFIX)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.url.port).toBe("")
    }
  })

  it("rejects a host that only matches another suffix", () => {
    expect(checkDownloadUrl("https://a.example.com/file.pdf", SUFFIX).ok).toBe(false)
  })

  it("accepts a configured suffix without the leading dot", () => {
    expect(checkDownloadUrl("https://a.storage.affilova.test/f", ".storage.affilova.test").ok).toBe(true)
  })
})

describe("checkCallbackUrl", () => {
  it("accepts an allowlisted origin at the result path", () => {
    const result = checkCallbackUrl(`https://app.affilova.test${CALLBACK_PATH}`, ORIGINS)

    expect(result.ok).toBe(true)
  })

  it("accepts an allowlisted origin with a port", () => {
    expect(checkCallbackUrl(`https://staging.affilova.test:8443${CALLBACK_PATH}`, ORIGINS).ok).toBe(true)
  })

  it.each([
    ["an origin that is not allowlisted", `https://evil.test${CALLBACK_PATH}`],
    ["a look-alike origin", `https://app.affilova.test.evil.test${CALLBACK_PATH}`],
    ["an http origin", `http://app.affilova.test${CALLBACK_PATH}`],
    ["another path", "https://app.affilova.test/api/scan-result"],
    ["a trailing slash", `https://app.affilova.test${CALLBACK_PATH}/`],
    ["the root path", "https://app.affilova.test/"],
    ["a query string", `https://app.affilova.test${CALLBACK_PATH}?a=1`],
    ["a fragment", `https://app.affilova.test${CALLBACK_PATH}#x`],
    ["userinfo", `https://user:pass@app.affilova.test${CALLBACK_PATH}`],
    ["a non-default port", `https://app.affilova.test:9000${CALLBACK_PATH}`],
    ["an IP literal", `https://127.0.0.1${CALLBACK_PATH}`],
    ["a trailing dot", `https://app.affilova.test.${CALLBACK_PATH}`],
    ["an empty value", ""],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, value) => {
    const result = checkCallbackUrl(value, ORIGINS)

    expect(result.ok).toBe(false)
  })

  it("rejects a non-string", () => {
    expect(checkCallbackUrl(7, ORIGINS).ok).toBe(false)
  })

  it("rejects every origin when the allowlist is empty", () => {
    expect(checkCallbackUrl(`https://app.affilova.test${CALLBACK_PATH}`, []).ok).toBe(false)
  })
})

describe("isIpLiteralHost", () => {
  it.each(["127.0.0.1", "0.0.0.0", "255.255.255.255", "[::1]", "::1", "2130706433", "0x7f000001"])(
    "treats %s as an address",
    (host) => {
      expect(isIpLiteralHost(host)).toBe(true)
    },
  )

  it.each(["bucket.r2.cloudflarestorage.com", "localhost", "a-b.storage.test", "8.example.com"])(
    "treats %s as a name",
    (host) => {
      expect(isIpLiteralHost(host)).toBe(false)
    },
  )
})
