import { describe, expect, it } from "vitest"

import { safeNextPath } from "./safe-next"

describe("safeNextPath", () => {
  it("returns a relative path unchanged", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard")
    expect(safeNextPath("/dashboard/vendor?tab=orders")).toBe("/dashboard/vendor?tab=orders")
    expect(safeNextPath("/auth/reset-password")).toBe("/auth/reset-password")
  })

  it("accepts the root path", () => {
    expect(safeNextPath("/")).toBe("/")
  })

  it("falls back to / for a protocol-relative path", () => {
    expect(safeNextPath("//evil.com")).toBe("/")
    expect(safeNextPath("//evil.com/path")).toBe("/")
  })

  it("falls back to / for an absolute URL", () => {
    expect(safeNextPath("https://evil.com")).toBe("/")
    expect(safeNextPath("http://evil.com/path")).toBe("/")
  })

  it("falls back to / for a backslash path", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/")
    expect(safeNextPath("\\evil.com")).toBe("/")
    expect(safeNextPath("/dashboard\\..\\evil")).toBe("/")
  })

  it("falls back to / for a javascript URL", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/")
    expect(safeNextPath("javascript:alert(1)//")).toBe("/")
  })

  it("falls back to / for an empty, null or undefined value", () => {
    expect(safeNextPath("")).toBe("/")
    expect(safeNextPath(null)).toBe("/")
    expect(safeNextPath(undefined)).toBe("/")
  })

  it("falls back to / for a path without a leading slash", () => {
    expect(safeNextPath("dashboard")).toBe("/")
    expect(safeNextPath("?next=/dashboard")).toBe("/")
    expect(safeNextPath(" /dashboard")).toBe("/")
  })

  it("falls back to / for a path containing control characters", () => {
    expect(safeNextPath("/dashboard\nSet-Cookie: x=y")).toBe("/")
    expect(safeNextPath("/dashboard\r\n")).toBe("/")
    expect(safeNextPath("/dash\u0000board")).toBe("/")
    expect(safeNextPath("/dash\u007fboard")).toBe("/")
    expect(safeNextPath("/dash\tboard")).toBe("/")
  })

  it("falls back to / for a path with a scheme and no leading slash", () => {
    expect(safeNextPath("/redirect?to=https://evil.com")).toBe("/")
  })

  it("does not turn an encoded protocol-relative path into one after decoding", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/")
    expect(safeNextPath("/%2f%2fevil.com")).toBe("/")
    expect(safeNextPath("/%5Cevil.com")).toBe("/")
    expect(safeNextPath("/%5c%5cevil.com")).toBe("/")
    // "/..//evil.com" is not protocol-relative, so it is allowed, but it must
    // still resolve to the same origin when the redirect URL is built.
    const traversal = safeNextPath("/%2e%2e%2f%2fevil.com")
    expect(new URL(traversal, "https://affilova.test").origin).toBe("https://affilova.test")
  })

  it("keeps an encoded path that stays relative after decoding", () => {
    expect(safeNextPath("/dashboard%2Fsettings")).toBe("/dashboard%2Fsettings")
    expect(safeNextPath("/search?q=hello%20world")).toBe("/search?q=hello%20world")
  })

  it("falls back to / for malformed percent-encoding", () => {
    expect(safeNextPath("/%zz")).toBe("/")
    expect(safeNextPath("/%")).toBe("/")
  })

  it("uses the given fallback instead of /", () => {
    expect(safeNextPath("//evil.com", "/auth/login")).toBe("/auth/login")
    expect(safeNextPath(null, "/auth/login")).toBe("/auth/login")
    expect(safeNextPath("/dashboard", "/auth/login")).toBe("/dashboard")
  })
})
