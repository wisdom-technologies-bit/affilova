import { describe, expect, it } from "vitest"

import { buildCookieOptions } from "./cookie-options"

describe("buildCookieOptions", () => {
  it("sets secure in production", () => {
    expect(buildCookieOptions({ appEnv: "production" }).secure).toBe(true)
  })

  it("does not set secure in preview", () => {
    expect(buildCookieOptions({ appEnv: "preview" }).secure).toBe(false)
  })

  it("does not set secure in development", () => {
    expect(buildCookieOptions({ appEnv: "development" }).secure).toBe(false)
  })

  it("omits the domain when it is an empty string", () => {
    expect(buildCookieOptions({ appEnv: "production", cookieDomain: "" })).not.toHaveProperty(
      "domain",
    )
  })

  it("omits the domain when it is undefined", () => {
    expect(buildCookieOptions({ appEnv: "production" })).not.toHaveProperty("domain")
  })

  it("includes the domain when it is set", () => {
    expect(buildCookieOptions({ appEnv: "production", cookieDomain: ".affilova.com" }).domain).toBe(
      ".affilova.com",
    )
  })

  it("always uses lax as the same site policy", () => {
    expect(buildCookieOptions({ appEnv: "production" }).sameSite).toBe("lax")
    expect(buildCookieOptions({ appEnv: "preview" }).sameSite).toBe("lax")
    expect(buildCookieOptions({ appEnv: "development", cookieDomain: ".affilova.com" }).sameSite).toBe(
      "lax",
    )
  })
})
