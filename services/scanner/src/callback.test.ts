import { describe, expect, it } from "vitest"

import { CALLBACK_RETRY_DELAYS_MS, MAX_DETAIL_LENGTH, createCallbackSender, sanitiseDetail } from "#callback"
import type { CallbackPayload } from "#callback"
import type { FetchInit, FetchLike, FetchResponse } from "#download"
import { verifyCallbackSignature } from "#signature"

const SECRET = "callback-secret-0123456789abcdef0123"

const CALLBACK_URL = "https://app.affilova.test/api/internal/scan-result"

const PAYLOAD: CallbackPayload = {
  scanId: "6af469de-05d7-4ae1-9d69-b68600000001",
  fileId: "6af469de-05d7-4ae1-9d69-b68600000002",
  verdict: "clean",
  detail: "clean",
  sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  detectedMime: "application/pdf",
  engine: "bouncer",
  signatureVersion: null,
  scannedAt: "2026-11-18T05:00:00.000Z",
}

type SentRequest = {
  readonly url: string
  readonly init: FetchInit
}

function statusResponse(status: number): FetchResponse {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, body: null }
}

function sender(fetchImpl: FetchLike, sleeps: number[] = [], now = 1_763_000_000_000) {
  return createCallbackSender({
    callbackUrl: CALLBACK_URL,
    secret: SECRET,
    fetch: fetchImpl,
    sleep: async (delayMs: number) => {
      sleeps.push(delayMs)
    },
    now: () => now,
  })
}

describe("sanitiseDetail", () => {
  it("keeps a signature name", () => {
    expect(sanitiseDetail("Eicar-Test-Signature")).toBe("Eicar-Test-Signature")
  })

  it("keeps a policy code", () => {
    expect(sanitiseDetail("archive_contains_executable")).toBe("archive_contains_executable")
  })

  it("removes a URL", () => {
    expect(sanitiseDetail("failed to fetch https://bucket.r2.cloudflarestorage.com/x.pdf now")).toBe(
      "failed to fetch now",
    )
  })

  it("removes a URL with a query string", () => {
    expect(sanitiseDetail("see https://example.test/a?b=c&d=e")).toBe("see")
  })

  it("falls back when the detail is only a URL", () => {
    expect(sanitiseDetail("https://example.test/a.pdf")).toBe("unspecified")
  })

  it("truncates to 300 characters", () => {
    expect(sanitiseDetail("a".repeat(500))).toHaveLength(MAX_DETAIL_LENGTH)
  })

  it("collapses whitespace", () => {
    expect(sanitiseDetail("  two   words  ")).toBe("two words")
  })
})

describe("createCallbackSender", () => {
  it("posts the signed body once and stops on success", async () => {
    const sent: SentRequest[] = []
    const sleeps: number[] = []

    const result = await sender(async (url, init) => {
      sent.push({ url, init })

      return statusResponse(200)
    }, sleeps).send(PAYLOAD)

    expect(result).toEqual({ delivered: true, attempts: 1 })
    expect(sleeps).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe(CALLBACK_URL)
    expect(sent[0].init.method).toBe("POST")
    expect(sent[0].init.headers?.["content-type"]).toBe("application/json")
  })

  it("actually sends the JSON body", async () => {
    const sent: SentRequest[] = []

    await sender(async (url, init) => {
      sent.push({ url, init })

      return statusResponse(200)
    }).send(PAYLOAD)

    expect(sent[0].init.body).toBe(JSON.stringify(PAYLOAD))
  })

  it("signs exactly the body it sends", async () => {
    const sent: SentRequest[] = []

    await sender(async (url, init) => {
      sent.push({ url, init })

      return statusResponse(200)
    }).send(PAYLOAD)

    const request = sent[0]
    const body = request.init.body ?? ""
    const timestamp = Number(request.init.headers?.["x-scanner-timestamp"])
    const signature = request.init.headers?.["x-scanner-signature"] ?? ""

    expect(JSON.parse(body)).toEqual(PAYLOAD)
    expect(verifyCallbackSignature(SECRET, timestamp, body, signature)).toBe(true)
  })

  it("sends the timestamp as whole unix seconds", async () => {
    let seen = ""

    await sender(async (_url, init) => {
      seen = init.headers?.["x-scanner-timestamp"] ?? ""

      return statusResponse(200)
    }, [], 1_763_000_000_999).send(PAYLOAD)

    expect(seen).toBe("1763000000")
  })

  it("retries on the contract schedule after a non 2xx answer", async () => {
    const sleeps: number[] = []
    let attempts = 0

    const result = await sender(async () => {
      attempts += 1

      return attempts < 3 ? statusResponse(500) : statusResponse(200)
    }, sleeps).send(PAYLOAD)

    expect(result).toEqual({ delivered: true, attempts: 3 })
    expect(sleeps).toEqual([10_000, 30_000])
  })

  it("retries after a network error", async () => {
    const sleeps: number[] = []
    let attempts = 0

    const result = await sender(async () => {
      attempts += 1

      if (attempts === 1) {
        throw new Error("ECONNREFUSED")
      }

      return statusResponse(200)
    }, sleeps).send(PAYLOAD)

    expect(result).toEqual({ delivered: true, attempts: 2 })
    expect(sleeps).toEqual([10_000])
  })

  it("gives up after the last delay", async () => {
    const sleeps: number[] = []
    let attempts = 0

    const result = await sender(async () => {
      attempts += 1

      return statusResponse(503)
    }, sleeps).send(PAYLOAD)

    expect(result).toEqual({ delivered: false, attempts: CALLBACK_RETRY_DELAYS_MS.length + 1 })
    expect(attempts).toBe(CALLBACK_RETRY_DELAYS_MS.length + 1)
    expect(sleeps).toEqual([...CALLBACK_RETRY_DELAYS_MS])
  })

  it("uses the contract's retry schedule", () => {
    expect([...CALLBACK_RETRY_DELAYS_MS]).toEqual([10_000, 30_000, 120_000, 600_000, 1_800_000, 7_200_000])
  })

  it("treats 204 as delivered", async () => {
    expect((await sender(async () => statusResponse(204)).send(PAYLOAD)).delivered).toBe(true)
  })

  it("treats a 400 as a failure worth retrying, because the sweeper re-sends", async () => {
    const sleeps: number[] = []

    const result = await sender(async () => statusResponse(400), sleeps).send(PAYLOAD)

    expect(result.delivered).toBe(false)
    expect(sleeps).toHaveLength(CALLBACK_RETRY_DELAYS_MS.length)
  })

  it("sends the same raw body on every attempt so the retry is byte identical", async () => {
    const bodies: string[] = []
    let attempts = 0

    await sender(async (_url, init) => {
      bodies.push(init.body ?? "")
      attempts += 1

      return attempts < 3 ? statusResponse(500) : statusResponse(200)
    }).send(PAYLOAD)

    expect(bodies).toHaveLength(3)
    expect(new Set(bodies).size).toBe(1)
  })

  it("re-signs each attempt with the current timestamp", async () => {
    const timestamps: string[] = []
    const signatures: string[] = []
    let attempts = 0
    let clock = 1_763_000_000_000

    const senderWithClock = createCallbackSender({
      callbackUrl: CALLBACK_URL,
      secret: SECRET,
      fetch: async (_url, init) => {
        attempts += 1
        timestamps.push(init.headers?.["x-scanner-timestamp"] ?? "")
        signatures.push(init.headers?.["x-scanner-signature"] ?? "")
        clock += 10_000

        return attempts < 2 ? statusResponse(500) : statusResponse(200)
      },
      sleep: async () => undefined,
      now: () => clock,
    })

    await senderWithClock.send(PAYLOAD)

    expect(timestamps).toEqual(["1763000000", "1763000010"])
    expect(new Set(signatures).size).toBe(2)
  })

  it("keeps the payload detail inside the contract", async () => {
    let body = ""

    await sender(async (_url, init) => {
      body = init.body ?? ""

      return statusResponse(200)
    }).send({ ...PAYLOAD, detail: sanitiseDetail("x".repeat(500)) })

    const parsed = JSON.parse(body) as CallbackPayload

    expect(parsed.detail.length).toBeLessThanOrEqual(MAX_DETAIL_LENGTH)
  })
})
