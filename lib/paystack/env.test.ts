import { describe, expect, it } from "vitest"

// The Paystack environment.
//
// Two things are worth more than the parsing: the mode is derived from the key
// (so a live key in a test deployment is visible rather than guessed), and the
// whole thing is lazy, so a deployment with no Paystack key still builds.

import { parsePaystackEnv } from "@/lib/env"

const TEST_KEY = "sk_test_0123456789abcdef0123456789abcdef"

describe("parsePaystackEnv", () => {
  it("reads a test key and reports test mode", () => {
    const env = parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY })

    expect(env.PAYSTACK_SECRET_KEY).toBe(TEST_KEY)
    expect(env.mode).toBe("test")
  })

  it("reads a live key and reports live mode", () => {
    const env = parsePaystackEnv({ PAYSTACK_SECRET_KEY: "sk_live_abcdef0123456789" })

    expect(env.mode).toBe("live")
  })

  it("reports anything else as invalid rather than guessing", () => {
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: "pk_test_123" }).mode).toBe("invalid")
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: "abc" }).mode).toBe("invalid")
  })

  it("requires the secret key, and names it when it is missing", () => {
    expect(() => parsePaystackEnv({})).toThrow(/PAYSTACK_SECRET_KEY/)
  })

  it("treats a blank key as missing", () => {
    expect(() => parsePaystackEnv({ PAYSTACK_SECRET_KEY: "   " })).toThrow(/PAYSTACK_SECRET_KEY/)
  })

  it("keeps the public key optional", () => {
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY }).NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY).toBeUndefined()
    expect(
      parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_test_123" })
        .NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
    ).toBe("pk_test_123")
  })

  it("leaves the IP allowlist off unless it is asked for", () => {
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY }).enforceWebhookIps).toBe(false)
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY, PAYSTACK_WEBHOOK_ENFORCE_IPS: "" }).enforceWebhookIps).toBe(
      false,
    )
    expect(
      parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY, PAYSTACK_WEBHOOK_ENFORCE_IPS: "false" }).enforceWebhookIps,
    ).toBe(false)
  })

  it("turns the allowlist on for true, 1 or yes, in any case", () => {
    for (const value of ["true", "TRUE", "1", "yes", " Yes "]) {
      expect(
        parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY, PAYSTACK_WEBHOOK_ENFORCE_IPS: value }).enforceWebhookIps,
      ).toBe(true)
    }
  })

  it("keeps the webhook signing secret optional", () => {
    expect(parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY }).PAYSTACK_WEBHOOK_SECRET).toBeUndefined()
    expect(
      parsePaystackEnv({ PAYSTACK_SECRET_KEY: TEST_KEY, PAYSTACK_WEBHOOK_SECRET: "whsec_abc" }).PAYSTACK_WEBHOOK_SECRET,
    ).toBe("whsec_abc")
  })
})
