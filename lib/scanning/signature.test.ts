import { describe, expect, it } from "vitest"

import { signCallback, verifyCallback } from "./signature"

// The fixed vector: this exact hex is what HMAC-SHA256 over
// "1700000000.{"a":1}" under the test secret produces. It is written out here so
// a change to the signed string (an extra separator, a different encoding)
// fails this test instead of silently breaking every callback.
const SECRET = "test-secret-for-callbacks-000000"
const OTHER_SECRET = "another-test-secret-0000000000"
const TIMESTAMP = "1700000000"
const BODY = '{"a":1}'
const VECTOR = "f8446e06993cf830411284cf17c710a29131a488602af8ea6a991e11540c8e1d"

const NOW = Number.parseInt(TIMESTAMP, 10)

describe("signCallback", () => {
  it("matches the fixed vector", () => {
    expect(signCallback(SECRET, TIMESTAMP, BODY)).toBe(VECTOR)
  })

  it("signs the timestamp together with the body", () => {
    expect(signCallback(SECRET, TIMESTAMP, BODY)).not.toBe(
      signCallback(SECRET, "1700000001", BODY),
    )
  })

  it("changes with the secret", () => {
    expect(signCallback(SECRET, TIMESTAMP, BODY)).not.toBe(
      signCallback(OTHER_SECRET, TIMESTAMP, BODY),
    )
  })
})

describe("verifyCallback", () => {
  const good = {
    secret: SECRET,
    timestamp: TIMESTAMP,
    signature: VECTOR,
    rawBody: BODY,
    now: NOW,
  }

  it("accepts a correct, recent signature", () => {
    expect(verifyCallback(good)).toEqual({ ok: true })
  })

  it("accepts an uppercase signature, because hex has two spellings", () => {
    expect(verifyCallback({ ...good, signature: VECTOR.toUpperCase() })).toEqual({ ok: true })
  })

  it("rejects a tampered body", () => {
    expect(verifyCallback({ ...good, rawBody: '{"a":2}' })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    })
  })

  it("rejects the wrong secret", () => {
    expect(verifyCallback({ ...good, secret: OTHER_SECRET })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    })
  })

  it("rejects a timestamp older than the window", () => {
    expect(verifyCallback({ ...good, now: NOW + 301 })).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    })
  })

  it("rejects a timestamp newer than the window", () => {
    expect(verifyCallback({ ...good, now: NOW - 301 })).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    })
  })

  it("accepts the far edge of the window on both sides", () => {
    expect(verifyCallback({ ...good, now: NOW + 300 })).toEqual({ ok: true })
    expect(verifyCallback({ ...good, now: NOW - 300 })).toEqual({ ok: true })
  })

  it("honours a caller-supplied tolerance", () => {
    expect(verifyCallback({ ...good, now: NOW + 60, toleranceSeconds: 30 })).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    })
  })

  it("rejects a malformed signature", () => {
    for (const signature of ["not-hex", "zz".repeat(32), VECTOR.slice(0, 62), `${VECTOR}00`]) {
      expect(verifyCallback({ ...good, signature })).toEqual({
        ok: false,
        reason: "malformed_signature",
      })
    }
  })

  it("reads an empty signature as a missing header, not a malformed one", () => {
    expect(verifyCallback({ ...good, signature: "" })).toEqual({
      ok: false,
      reason: "missing_headers",
    })
  })

  it("rejects missing headers", () => {
    expect(verifyCallback({ ...good, timestamp: null })).toEqual({
      ok: false,
      reason: "missing_headers",
    })
    expect(verifyCallback({ ...good, signature: null })).toEqual({
      ok: false,
      reason: "missing_headers",
    })
  })

  it("rejects a non-numeric timestamp once the signature matches", () => {
    const timestamp = "1700000000x"

    expect(
      verifyCallback({
        ...good,
        timestamp,
        signature: signCallback(SECRET, timestamp, BODY),
      }),
    ).toEqual({ ok: false, reason: "malformed_timestamp" })
  })
})
