import { describe, expect, it } from "vitest"

import { buildTurnstileOptions, isValidTurnstileAction } from "./turnstile"

describe("isValidTurnstileAction", () => {
  it("accepts the three action names the auth pages use", () => {
    expect(isValidTurnstileAction("sign_in")).toBe(true)
    expect(isValidTurnstileAction("sign_up")).toBe(true)
    expect(isValidTurnstileAction("forgot_password")).toBe(true)
  })

  it("accepts letters, numbers, underscore and hyphen up to 32 characters", () => {
    expect(isValidTurnstileAction("a")).toBe(true)
    expect(isValidTurnstileAction("A_b-9")).toBe(true)
    expect(isValidTurnstileAction("A".repeat(32))).toBe(true)
  })

  it("rejects an empty action", () => {
    expect(isValidTurnstileAction("")).toBe(false)
  })

  it("rejects an action longer than 32 characters", () => {
    expect(isValidTurnstileAction("A".repeat(33))).toBe(false)
  })

  it("rejects spaces", () => {
    expect(isValidTurnstileAction("sign in")).toBe(false)
    expect(isValidTurnstileAction(" sign_in")).toBe(false)
    expect(isValidTurnstileAction("sign_in ")).toBe(false)
  })

  it("rejects a slash", () => {
    expect(isValidTurnstileAction("sign/in")).toBe(false)
    expect(isValidTurnstileAction("../sign_in")).toBe(false)
  })

  it("rejects unicode and other punctuation", () => {
    expect(isValidTurnstileAction("вход")).toBe(false)
    expect(isValidTurnstileAction("サインイン")).toBe(false)
    expect(isValidTurnstileAction("sign_in!")).toBe(false)
    expect(isValidTurnstileAction("sign.in")).toBe(false)
  })
})

describe("buildTurnstileOptions", () => {
  it("returns exactly the documented render options", () => {
    expect(buildTurnstileOptions("sign_in", "1x00000000000000000000AA")).toStrictEqual({
      sitekey: "1x00000000000000000000AA",
      action: "sign_in",
      theme: "light",
      size: "flexible",
      language: "auto",
      retry: "auto",
      "refresh-expired": "auto",
    })
  })

  it("keeps the action it was given", () => {
    expect(buildTurnstileOptions("forgot_password", "site-key").action).toBe("forgot_password")
  })

  it("trims the site key", () => {
    expect(buildTurnstileOptions("sign_up", "  site-key  ").sitekey).toBe("site-key")
  })

  it("throws on an invalid action", () => {
    expect(() => buildTurnstileOptions("sign in", "site-key")).toThrow(TypeError)
    expect(() => buildTurnstileOptions("", "site-key")).toThrow(TypeError)
    expect(() => buildTurnstileOptions("A".repeat(33), "site-key")).toThrow(TypeError)
  })

  it("throws on a missing site key", () => {
    expect(() => buildTurnstileOptions("sign_in", "")).toThrow(TypeError)
    expect(() => buildTurnstileOptions("sign_in", "   ")).toThrow(TypeError)
  })
})
