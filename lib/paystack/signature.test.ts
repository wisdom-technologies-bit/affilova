import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

// Webhook signatures, checked byte for byte.
//
// Two headers are documented and both are covered: the legacy
// x-paystack-signature (HMAC-SHA512 of the body, keyed with the secret key) and
// the newer Paystack-Signature (a timestamped v1 entry keyed with the webhook
// signing secret).

import {
  isPaystackSourceIp,
  PAYSTACK_WEBHOOK_IPS,
  sourceIpFromHeaders,
  verifyWebhookSignature,
} from "./signature"

const SECRET_KEY = "sk_test_0123456789abcdef0123456789abcdef"
const WEBHOOK_SECRET = "whsec_0123456789abcdef0123456789abcdef"

const BODY = new TextEncoder().encode(
  JSON.stringify({ event: "charge.success", data: { reference: "afv_abc123", amount: 40333 } }),
)

function legacySignature(body: Uint8Array = BODY, key = SECRET_KEY): string {
  return createHmac("sha512", key).update(body).digest("hex")
}

function v1Header(timestamp: number, key = WEBHOOK_SECRET, body: Uint8Array = BODY): string {
  const signed = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), Buffer.from(body)])
  const signature = createHmac("sha512", key).update(signed).digest("hex")

  return `t=${timestamp},v1=whk_3f9a1c2e:${signature}`
}

function check(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    rawBody: BODY,
    legacySignature: legacySignature(),
    v1Signature: null,
    secretKey: SECRET_KEY,
    nowSeconds: 1_760_270_400,
    ...overrides,
  })
}

describe("x-paystack-signature", () => {
  it("accepts the signature Paystack sends", () => {
    expect(check()).toEqual({ ok: true, scheme: "legacy" })
  })

  it("rejects a body with one byte changed", () => {
    const tampered = new Uint8Array(BODY)
    tampered[10] = (tampered[10] ?? 0) ^ 0x01

    expect(check({ rawBody: tampered })).toEqual({ ok: false, reason: "mismatch" })
  })

  it("rejects a signature made with a different key", () => {
    expect(check({ legacySignature: legacySignature(BODY, "sk_test_other") })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects a missing header", () => {
    expect(check({ legacySignature: null })).toEqual({ ok: false, reason: "missing" })
  })

  it("rejects an empty header", () => {
    expect(check({ legacySignature: "   " })).toEqual({ ok: false, reason: "missing" })
  })

  it("rejects an uppercase hex signature, because Paystack sends lowercase", () => {
    expect(check({ legacySignature: legacySignature().toUpperCase() })).toEqual({
      ok: false,
      reason: "malformed",
    })
  })

  it("rejects a signature of the wrong length", () => {
    expect(check({ legacySignature: "abcdef" })).toEqual({ ok: false, reason: "malformed" })
  })

  it("rejects a truncated signature", () => {
    expect(check({ legacySignature: legacySignature().slice(0, 127) })).toEqual({
      ok: false,
      reason: "malformed",
    })
  })
})

describe("Paystack-Signature (v1)", () => {
  const now = 1_760_270_400

  it("accepts a fresh v1 signature", () => {
    expect(
      check({ legacySignature: null, v1Signature: v1Header(now), webhookSecret: WEBHOOK_SECRET }),
    ).toEqual({ ok: true, scheme: "v1" })
  })

  it("accepts it alongside a legacy header that does not match", () => {
    expect(check({ legacySignature: "0".repeat(128), v1Signature: v1Header(now), webhookSecret: WEBHOOK_SECRET })).toEqual({
      ok: true,
      scheme: "v1",
    })
  })

  it("rejects a timestamp more than 300 seconds old", () => {
    expect(
      check({
        legacySignature: null,
        v1Signature: v1Header(now - 301),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toEqual({ ok: false, reason: "expired" })
  })

  it("rejects a timestamp more than 300 seconds in the future", () => {
    expect(
      check({
        legacySignature: null,
        v1Signature: v1Header(now + 301),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toEqual({ ok: false, reason: "expired" })
  })

  it("accepts the boundary exactly 300 seconds old", () => {
    expect(
      check({
        legacySignature: null,
        v1Signature: v1Header(now - 300),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toEqual({ ok: true, scheme: "v1" })
  })

  it("rejects a v1 signature made with another secret", () => {
    expect(
      check({
        legacySignature: null,
        v1Signature: v1Header(now, "whsec_other"),
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("accepts a header carrying two keys when the second matches", () => {
    const header = `t=${now},v1=whk_old:${"0".repeat(128)},${v1Header(now).split(",")[1]}`

    expect(check({ legacySignature: null, v1Signature: header, webhookSecret: WEBHOOK_SECRET })).toEqual({
      ok: true,
      scheme: "v1",
    })
  })

  it("rejects a v1 header when this deployment holds no signing secret", () => {
    expect(check({ legacySignature: null, v1Signature: v1Header(now) })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects a v1 header with no timestamp", () => {
    expect(
      check({ legacySignature: null, v1Signature: "v1=whk_abc:" + "0".repeat(128), webhookSecret: WEBHOOK_SECRET }),
    ).toEqual({ ok: false, reason: "malformed" })
  })
})

describe("source addresses", () => {
  it("lists exactly the three documented addresses", () => {
    expect([...PAYSTACK_WEBHOOK_IPS]).toEqual(["52.31.139.75", "52.49.173.169", "52.214.14.220"])
  })

  it("accepts a documented address and rejects another", () => {
    expect(isPaystackSourceIp("52.31.139.75")).toBe(true)
    expect(isPaystackSourceIp("203.0.113.9")).toBe(false)
  })

  it("accepts an IPv4-mapped IPv6 form", () => {
    expect(isPaystackSourceIp("::ffff:52.49.173.169")).toBe(true)
  })

  it("reads only the first entry of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "52.31.139.75, 10.0.0.1" })

    expect(sourceIpFromHeaders(headers)).toBe("52.31.139.75")
  })

  it("falls back to x-real-ip and then to unknown", () => {
    expect(sourceIpFromHeaders(new Headers({ "x-real-ip": "52.214.14.220" }))).toBe("52.214.14.220")
    expect(sourceIpFromHeaders(new Headers())).toBe("unknown")
  })
})
