import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from "@/lib/logger"
import {
  SELF_TEST_PREFIX,
  runScannerSelfTestWith,
} from "@/lib/ops/scanner-selftest"
import type { SelfTestStorage } from "@/lib/ops/scanner-selftest"
import { buildSelfTestSamples } from "@/lib/ops/selftest-samples"

// The self-test runner: upload four known files, ask the scanner about each one,
// compare the answer, and always delete what was written.
//
// Every test here runs with fakes. Nothing reaches the network or the bucket, so
// a green run means the logic is right, not that a service happened to be up.

const SAMPLES = buildSelfTestSamples()

const SECRET = "shared-secret-for-the-selftest-tests"

const ANSWER_BY_NAME: Record<string, { verdict: string; detail: string | null }> = {
  "hello.txt": { verdict: "clean", detail: "clean" },
  "eicar.txt": { verdict: "infected", detail: "Eicar-Test-Signature" },
  "not-a-pdf.pdf": { verdict: "rejected", detail: "executable_type" },
  "archive.zip": { verdict: "needs_review", detail: "archive_contains_executable" },
}

interface StorageRecorder extends SelfTestStorage {
  puts: { key: string; size: number; contentType: string }[]
  removes: string[]
  presigns: string[]
}

function createStorage(options: { failPutFor?: string; failRemove?: boolean } = {}): StorageRecorder {
  const puts: StorageRecorder["puts"] = []
  const removes: string[] = []
  const presigns: string[] = []

  return {
    puts,
    removes,
    presigns,
    put: async (key, bytes, contentType) => {
      if (options.failPutFor !== undefined && key.endsWith(options.failPutFor)) {
        throw new Error("put failed")
      }

      puts.push({ key, size: bytes.length, contentType })
    },
    presignGet: async (key) => {
      presigns.push(key)

      return `https://bucket.r2.cloudflarestorage.com/${key}?X-Amz-Signature=abc`
    },
    remove: async (key) => {
      removes.push(key)

      if (options.failRemove === true) {
        throw new Error("remove failed")
      }
    },
  }
}

type AnswerOverride = (sampleName: string) => Response | Error

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** A fetch that answers /healthz and /selftest from the tables above. */
function createFetch(
  options: {
    answer?: AnswerOverride
    health?: () => Response | Error
  } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url.endsWith("/healthz")) {
      if (options.health !== undefined) {
        const answer = options.health()

        if (answer instanceof Error) {
          throw answer
        }

        return answer
      }

      return jsonResponse({ ok: true, clamd: true, signatureAgeHours: 7 })
    }

    if (url.endsWith("/selftest")) {
      const body = JSON.parse(String(init?.body)) as { downloadUrl: string }
      const name = body.downloadUrl.split("/").pop()?.split("?")[0] ?? ""

      if (options.answer !== undefined) {
        const answer = options.answer(name)

        if (answer instanceof Error) {
          throw answer
        }

        return answer
      }

      const verdict = ANSWER_BY_NAME[name]

      return jsonResponse({
        verdict: verdict.verdict,
        detail: verdict.detail,
        sha256: "0".repeat(64),
        detectedMime: "text/plain",
        engine: "clamav",
        signatureVersion: "28186",
        durationMs: 12,
      })
    }

    throw new Error(`unexpected request ${url}`)
  }) as typeof fetch
}

function run(
  overrides: {
    storage?: StorageRecorder
    fetch?: typeof fetch
    callTimeoutMs?: number
  } = {},
) {
  const storage = overrides.storage ?? createStorage()
  let clock = 0

  return {
    storage,
    result: runScannerSelfTestWith({
      storage,
      scannerBaseUrl: "https://scanner.example",
      sharedSecret: SECRET,
      fetch: overrides.fetch ?? createFetch(),
      now: () => {
        clock += 5

        return clock
      },
      newId: () => "run-id",
      samples: SAMPLES,
      callTimeoutMs: overrides.callTimeoutMs,
    }),
  }
}

describe("runScannerSelfTestWith", () => {
  it("passes when the scanner answers exactly what each sample expects", async () => {
    const { result } = run()
    const outcome = await result

    expect(outcome.failedCount).toBe(0)
    expect(outcome.passedCount).toBe(4)
    expect(outcome.rows.map((row) => row.name)).toEqual([
      "hello.txt",
      "eicar.txt",
      "not-a-pdf.pdf",
      "archive.zip",
    ])
    expect(outcome.rows.every((row) => row.passed)).toBe(true)
  })

  it("reports the verdict in the same words the expectation uses", async () => {
    const { result } = run()
    const outcome = await result

    expect(outcome.rows[0]).toMatchObject({
      expected: "clean (clean)",
      actual: "clean (clean)",
      passed: true,
    })
    expect(outcome.rows[2]).toMatchObject({
      expected: "rejected (executable_type)",
      actual: "rejected (executable_type)",
    })
  })

  it("writes each sample under selftest/<id>/ and presigns exactly that key", async () => {
    const { result, storage } = run()

    await result

    expect(storage.puts.map((entry) => entry.key)).toEqual([
      `${SELF_TEST_PREFIX}/run-id/hello.txt`,
      `${SELF_TEST_PREFIX}/run-id/eicar.txt`,
      `${SELF_TEST_PREFIX}/run-id/not-a-pdf.pdf`,
      `${SELF_TEST_PREFIX}/run-id/archive.zip`,
    ])
    expect(storage.presigns).toEqual(storage.puts.map((entry) => entry.key))
  })

  it("uploads the real sample bytes with their content type", async () => {
    const { result, storage } = run()

    await result

    expect(storage.puts.map((entry) => entry.size)).toEqual(SAMPLES.map((sample) => sample.bytes.length))
    expect(storage.puts.map((entry) => entry.contentType)).toEqual([
      "text/plain",
      "text/plain",
      "application/pdf",
      "application/zip",
    ])
  })

  it("fails one row, and only one row, when the scanner disagrees", async () => {
    const { result } = run({
      fetch: createFetch({
        answer: (name) =>
          jsonResponse({
            verdict: name === "eicar.txt" ? "clean" : ANSWER_BY_NAME[name].verdict,
            detail: name === "eicar.txt" ? "clean" : ANSWER_BY_NAME[name].detail,
          }),
      }),
    })

    const outcome = await result
    const failed = outcome.rows.filter((row) => !row.passed)

    expect(outcome.passedCount).toBe(3)
    expect(outcome.failedCount).toBe(1)
    expect(failed[0]).toMatchObject({
      name: "eicar.txt",
      expected: "infected (Eicar…)",
      actual: "clean (clean)",
      passed: false,
    })
  })

  it("fails a row when the detail code is the wrong one", async () => {
    const { result } = run({
      fetch: createFetch({
        answer: (name) =>
          jsonResponse({
            verdict: "rejected",
            detail: name === "not-a-pdf.pdf" ? "type_mismatch" : ANSWER_BY_NAME[name].detail,
          }),
      }),
    })

    const outcome = await result

    expect(outcome.rows[2].passed).toBe(false)
    expect(outcome.rows[2].actual).toBe("rejected (type_mismatch)")
  })

  it("reports every row as failed, with a readable reason, when the scanner is unreachable", async () => {
    const { result, storage } = run({
      fetch: createFetch({
        answer: () => new TypeError("fetch failed"),
        health: () => new TypeError("fetch failed"),
      }),
    })

    const outcome = await result

    expect(outcome.passedCount).toBe(0)
    expect(outcome.failedCount).toBe(4)
    expect(outcome.rows.every((row) => row.actual === "the scanner could not be reached")).toBe(true)
    expect(outcome.health).toEqual({ state: "unreachable", clamd: false, signatureAgeHours: null })
    // Nothing was written that was not deleted.
    expect(storage.removes).toHaveLength(4)
  })

  it("says so when the scanner answers with an error status", async () => {
    const { result } = run({
      fetch: createFetch({ answer: () => jsonResponse({ error: "selftest_busy" }, 429) }),
    })

    const outcome = await result

    expect(outcome.rows[0].actual).toBe("the scanner answered 429")
    expect(outcome.rows[0].passed).toBe(false)
  })

  it("says so when the answer is not a verdict", async () => {
    const { result } = run({
      fetch: createFetch({ answer: () => jsonResponse({ verdict: "probably-fine" }) }),
    })

    const outcome = await result

    expect(outcome.rows[0].actual).toBe("no usable answer")
  })

  it("reports a timeout as a timeout, not as a wrong verdict", async () => {
    const abortError = new Error("aborted")

    abortError.name = "AbortError"

    const { result } = run({ fetch: createFetch({ answer: () => abortError }) })

    const outcome = await result

    expect(outcome.rows[0].actual).toBe("no answer before the ten second limit")
    expect(outcome.rows[0].passed).toBe(false)
  })

  it("keeps going after one sample fails, so the table is always complete", async () => {
    const { result } = run({
      fetch: createFetch({
        answer: (name) => {
          if (name === "eicar.txt") {
            throw new TypeError("fetch failed")
          }

          return jsonResponse({
            verdict: ANSWER_BY_NAME[name].verdict,
            detail: ANSWER_BY_NAME[name].detail,
          })
        },
      }),
    })

    const outcome = await result

    expect(outcome.rows).toHaveLength(4)
    expect(outcome.rows.map((row) => row.passed)).toEqual([true, false, true, true])
  })

  it("fails the row and still deletes the object when the bucket refuses the write", async () => {
    const storage = createStorage({ failPutFor: "eicar.txt" })
    const { result } = run({ storage })

    const outcome = await result

    expect(outcome.rows[1]).toMatchObject({
      name: "eicar.txt",
      actual: "the file could not be written to the bucket",
      passed: false,
    })
    // The delete is attempted for every sample, including the one that never
    // landed: a delete of a missing key is a success on S3 and R2.
    expect(storage.removes).toEqual([
      `${SELF_TEST_PREFIX}/run-id/hello.txt`,
      `${SELF_TEST_PREFIX}/run-id/eicar.txt`,
      `${SELF_TEST_PREFIX}/run-id/not-a-pdf.pdf`,
      `${SELF_TEST_PREFIX}/run-id/archive.zip`,
    ])
  })

  it("deletes every object even when the scanner never answers", async () => {
    const { result, storage } = run({
      fetch: createFetch({ answer: () => new TypeError("fetch failed") }),
    })

    await result

    expect(storage.removes).toHaveLength(SAMPLES.length)
  })

  it("does not fail the run when a delete fails, but logs it", async () => {
    const storage = createStorage({ failRemove: true })
    const { result } = run({ storage })

    const outcome = await result

    expect(outcome.passedCount).toBe(4)
    expect(logger.error).toHaveBeenCalledWith("scanner_selftest_cleanup_failed", expect.anything())
  })

  it("reports the scanner health block", async () => {
    const { result } = run({
      fetch: createFetch({ health: () => jsonResponse({ ok: true, clamd: true, signatureAgeHours: 7 }) }),
    })

    expect((await result).health).toEqual({ state: "ok", clamd: true, signatureAgeHours: 7 })
  })

  it("reports degraded when the service answers but is not ready", async () => {
    const { result } = run({
      fetch: createFetch({
        health: () => jsonResponse({ ok: false, clamd: false, signatureAgeHours: null }, 503),
      }),
    })

    expect((await result).health).toEqual({ state: "degraded", clamd: false, signatureAgeHours: null })
  })

  it("reports unreachable when /healthz does not answer", async () => {
    const { result } = run({ fetch: createFetch({ health: () => new TypeError("fetch failed") }) })

    expect((await result).health.state).toBe("unreachable")
  })

  it("never logs a signed URL or the shared secret", async () => {
    const { result } = run({
      fetch: createFetch({ answer: () => new TypeError("fetch failed") }),
    })

    await result

    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls) + JSON.stringify(vi.mocked(logger.info).mock.calls)

    expect(logged).not.toContain("X-Amz-Signature")
    expect(logged).not.toContain("cloudflarestorage")
    expect(logged).not.toContain(SECRET)
  })

  it("counts the duration of each row from the injected clock", async () => {
    const { result } = run()

    const outcome = await result

    // The fake clock advances five milliseconds per read: one at the start of the
    // row and one after the answer.
    expect(outcome.rows.map((row) => row.durationMs)).toEqual([5, 5, 5, 5])
  })
})
