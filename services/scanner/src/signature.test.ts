import { describe, expect, it } from "vitest"

import { signCallbackBody, verifyCallbackSignature } from "#signature"

/**
 * This service's own vector, pinned so a change to the signed string (an extra
 * separator, a different encoding) fails here rather than in production.
 */
export const CALLBACK_VECTOR_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

export const CALLBACK_VECTOR_TIMESTAMP = 1763000000

export const CALLBACK_VECTOR_BODY =
  '{"scanId":"6af469de-05d7-4ae1-9d69-b68600000001","fileId":"6af469de-05d7-4ae1-9d69-b68600000002","verdict":"clean","detail":"clean","sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","detectedMime":"application/pdf","engine":"bouncer","signatureVersion":null,"scannedAt":"2026-11-18T05:00:00.000Z"}'

export const CALLBACK_VECTOR_SIGNATURE =
  "5b741292c123770fe4eef48a838f64e37e2f7cc16f7748e3790935a57588c4b5"

describe("signCallbackBody", () => {
  it("matches the shared test vector", () => {
    expect(signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY)).toBe(
      CALLBACK_VECTOR_SIGNATURE,
    )
  })

  // The vector the app verifies with, taken from lib/scanning/signature.ts. If
  // either side ever changes what it signs, this test and the app's own test
  // vector disagree, which is exactly the failure we want to catch here instead
  // of as silent 401s on every callback.
  it("reproduces the vector the app verifies with", () => {
    expect(signCallbackBody("test-secret-for-callbacks-000000", 1700000000, '{"a":1}')).toBe(
      "f8446e06993cf830411284cf17c710a29131a488602af8ea6a991e11540c8e1d",
    )
  })

  it("is 64 lowercase hex characters", () => {
    const signature = signCallbackBody("secret", 1, "{}")

    expect(signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when the timestamp changes", () => {
    const first = signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY)
    const second = signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP + 1, CALLBACK_VECTOR_BODY)

    expect(first).not.toBe(second)
  })

  it("changes when the body changes", () => {
    const first = signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, "{}")
    const second = signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, "{ }")

    expect(first).not.toBe(second)
  })

  it("changes when the secret changes", () => {
    const first = signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY)
    const second = signCallbackBody(`${CALLBACK_VECTOR_SECRET}x`, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY)

    expect(first).not.toBe(second)
  })

  it("is not confused by a body that starts with a timestamp", () => {
    const nested = signCallbackBody(CALLBACK_VECTOR_SECRET, 1, "2.{}")
    const flat = signCallbackBody(CALLBACK_VECTOR_SECRET, 12, "{}")

    expect(nested).not.toBe(flat)
  })
})

describe("verifyCallbackSignature", () => {
  it("accepts the shared test vector", () => {
    expect(
      verifyCallbackSignature(
        CALLBACK_VECTOR_SECRET,
        CALLBACK_VECTOR_TIMESTAMP,
        CALLBACK_VECTOR_BODY,
        CALLBACK_VECTOR_SIGNATURE,
      ),
    ).toBe(true)
  })

  it("rejects a tampered body", () => {
    expect(
      verifyCallbackSignature(
        CALLBACK_VECTOR_SECRET,
        CALLBACK_VECTOR_TIMESTAMP,
        CALLBACK_VECTOR_BODY.replace("clean", "infected"),
        CALLBACK_VECTOR_SIGNATURE,
      ),
    ).toBe(false)
  })

  it("rejects a replayed signature under a new timestamp", () => {
    expect(
      verifyCallbackSignature(
        CALLBACK_VECTOR_SECRET,
        CALLBACK_VECTOR_TIMESTAMP + 60,
        CALLBACK_VECTOR_BODY,
        CALLBACK_VECTOR_SIGNATURE,
      ),
    ).toBe(false)
  })

  it("rejects a signature of the wrong length", () => {
    expect(verifyCallbackSignature(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY, "abc")).toBe(
      false,
    )
  })

  it("rejects an empty signature", () => {
    expect(verifyCallbackSignature(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY, "")).toBe(
      false,
    )
  })

  it("accepts an uppercase signature", () => {
    expect(
      verifyCallbackSignature(
        CALLBACK_VECTOR_SECRET,
        CALLBACK_VECTOR_TIMESTAMP,
        CALLBACK_VECTOR_BODY,
        CALLBACK_VECTOR_SIGNATURE.toUpperCase(),
      ),
    ).toBe(true)
  })
})
