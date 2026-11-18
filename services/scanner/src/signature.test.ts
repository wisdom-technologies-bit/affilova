import { describe, expect, it } from "vitest"

import { signCallbackBody, verifyCallbackSignature } from "#signature"

/**
 * Shared test vector. The app side of the integration uses the same secret,
 * timestamp, body and expected signature, so a change on either side shows up as
 * a failing test rather than as silent 401s in production.
 */
export const CALLBACK_VECTOR_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

export const CALLBACK_VECTOR_TIMESTAMP = 1763000000

export const CALLBACK_VECTOR_BODY =
  '{"scanId":"6af469de-05d7-4ae1-9d69-b68600000001","fileId":"6af469de-05d7-4ae1-9d69-b68600000002","verdict":"clean","detail":"clean","sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","detectedMime":"application/pdf","engine":"clamav","signatureVersion":"28186","scannedAt":"2026-11-18T05:00:00.000Z"}'

export const CALLBACK_VECTOR_SIGNATURE =
  "731104f6dda6976ce558fc83e2a1238b50b89b06e2c36972671208d2f89a5ef2"

describe("signCallbackBody", () => {
  it("matches the shared test vector", () => {
    expect(signCallbackBody(CALLBACK_VECTOR_SECRET, CALLBACK_VECTOR_TIMESTAMP, CALLBACK_VECTOR_BODY)).toBe(
      CALLBACK_VECTOR_SIGNATURE,
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
