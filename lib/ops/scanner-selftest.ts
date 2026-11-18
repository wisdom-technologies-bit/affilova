import "server-only"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "node:crypto"

import { getR2Env, getScannerEnv } from "@/lib/env"
import { logger } from "@/lib/logger"
import { buildSelfTestSamples, matchesExpectation } from "@/lib/ops/selftest-samples"
import type { SelfTestSample, SelfTestVerdict } from "@/lib/ops/selftest-samples"

// The one-click proof that the whole chain works: this app, the bucket, the
// scanner service, ClamAV and the scan policies.
//
// It writes four known files to the bucket under selftest/<uuid>/, gives the
// scanner a five minute signed URL for each, calls POST /selftest and compares
// the answer to the answer each sample must produce. Nothing is recorded in the
// database: no product, no file row, no scan row. That is the point. If this
// passes, an upload's scan will behave the same way, because the scanner runs
// the same pipeline for both.
//
// Two rules hold everywhere here:
//   * a signed URL is a credential. It is never logged, never returned to the
//     browser and never put in an error message. Only the sample name and the
//     verdict appear in a log line.
//   * every object this module writes is deleted in a finally block, whatever
//     happened, so a failing run leaves no selftest/ objects behind.

/** The scanner is given ten seconds per sample to answer. */
export const SELF_TEST_CALL_TIMEOUT_MS = 10_000

/** /healthz is a small answer; five seconds is generous. */
export const SELF_TEST_HEALTH_TIMEOUT_MS = 5_000

/** The signed URL lasts five minutes: long enough for four calls, short enough to be useless later. */
export const SELF_TEST_URL_TTL_SECONDS = 300

/** Where the self-test objects live in the bucket. */
export const SELF_TEST_PREFIX = "selftest"

/** One line of the results table. */
export interface SelfTestRow {
  name: string
  /** What the sample must produce, in words a person can read. */
  expected: string
  /** What the scanner said, in the same form, or why there is no answer. */
  actual: string
  passed: boolean
  durationMs: number
}

/** The scanner's own health block, as /healthz reports it. */
export interface ScannerHealth {
  /** `unreachable` when the service did not answer at all. */
  state: "ok" | "degraded" | "unreachable"
  clamd: boolean
  signatureAgeHours: number | null
}

export interface ScannerSelfTestResult {
  rows: readonly SelfTestRow[]
  health: ScannerHealth
  passedCount: number
  failedCount: number
}

/** What the runner needs from storage. Injected so tests need no bucket. */
export interface SelfTestStorage {
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
  /** A presigned GET URL. Never logged. */
  presignGet: (key: string) => Promise<string>
  remove: (key: string) => Promise<void>
}

export interface ScannerSelfTestDependencies {
  storage: SelfTestStorage
  scannerBaseUrl: string
  sharedSecret: string
  /** Injected so tests need no network. */
  fetch: typeof fetch
  /** Injected so the duration column is deterministic in tests. */
  now: () => number
  /** Injected so the object keys are deterministic in tests. */
  newId: () => string
  samples?: readonly SelfTestSample[]
  callTimeoutMs?: number
  healthTimeoutMs?: number
}

/** What the scanner's /selftest answers with, as far as this module trusts it. */
interface SelfTestAnswer {
  verdict: SelfTestVerdict
  detail: string | null
}

const VERDICTS: readonly string[] = ["clean", "infected", "rejected", "needs_review", "error"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Reads the scanner's answer without trusting it. Anything unrecognised is
 * reported as no answer rather than guessed at: a self-test that invents a
 * verdict is worse than one that fails.
 */
function readAnswer(body: unknown): SelfTestAnswer | null {
  if (!isRecord(body)) {
    return null
  }

  const verdict = body.verdict

  if (typeof verdict !== "string" || !VERDICTS.includes(verdict)) {
    return null
  }

  const detail = body.detail

  return {
    verdict: verdict as SelfTestVerdict,
    detail: typeof detail === "string" ? detail : null,
  }
}

/** "clean", or "rejected (executable_type)": one cell, no jargon. */
function describe(verdict: string, detail: string | null): string {
  return detail === null || detail === "" ? verdict : `${verdict} (${detail})`
}

function describeExpected(sample: SelfTestSample): string {
  const { verdict, detail, detailPrefix } = sample.expected

  if (detail !== null) {
    return describe(verdict, detail)
  }

  return detailPrefix === null ? verdict : `${verdict} (${detailPrefix}…)`
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

/** One POST /selftest, with its own timeout. The URL never leaves this function. */
async function callSelfTest(
  deps: ScannerSelfTestDependencies,
  downloadUrl: string,
  sample: SelfTestSample,
): Promise<{ answer: SelfTestAnswer | null; failure: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.callTimeoutMs ?? SELF_TEST_CALL_TIMEOUT_MS)

  try {
    const response = await deps.fetch(endpoint(deps.scannerBaseUrl, "/selftest"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.sharedSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        downloadUrl,
        expectedSizeBytes: sample.bytes.length,
        extension: sample.extension,
      }),
      signal: controller.signal,
      cache: "no-store",
    })

    if (!response.ok) {
      // The status is safe to report; the body and the request are not.
      return { answer: null, failure: `the scanner answered ${response.status}` }
    }

    const body: unknown = await response.json()

    return { answer: readAnswer(body), failure: null }
  } catch (error) {
    // A timeout, a refused connection or DNS. The error is not logged because it
    // can quote the URL.
    if (error instanceof Error && error.name === "AbortError") {
      return { answer: null, failure: "no answer before the ten second limit" }
    }

    return { answer: null, failure: "the scanner could not be reached" }
  } finally {
    clearTimeout(timer)
  }
}

/** What reading /healthz needs. Narrower than the whole runner, so it can be
 * called on its own. */
export interface ScannerHealthDependencies {
  scannerBaseUrl: string
  fetch: typeof fetch
  healthTimeoutMs?: number
}

/** GET /healthz, five second limit. Never throws. */
export async function fetchScannerHealth(deps: ScannerHealthDependencies): Promise<ScannerHealth> {
  const unreachable: ScannerHealth = { state: "unreachable", clamd: false, signatureAgeHours: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.healthTimeoutMs ?? SELF_TEST_HEALTH_TIMEOUT_MS)

  try {
    const response = await deps.fetch(endpoint(deps.scannerBaseUrl, "/healthz"), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })

    const body: unknown = await response.json()

    if (!isRecord(body)) {
      return unreachable
    }

    const clamd = body.clamd === true
    const age = body.signatureAgeHours
    const signatureAgeHours = typeof age === "number" && Number.isFinite(age) ? age : null
    const ok = body.ok === true && response.ok

    return {
      state: ok ? "ok" : "degraded",
      clamd,
      signatureAgeHours,
    }
  } catch {
    return unreachable
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run the self-test: upload, call, compare, delete, and report the scanner's
 * health alongside. Never throws for a sample failure: a failure is a row.
 */
export async function runScannerSelfTestWith(
  deps: ScannerSelfTestDependencies,
): Promise<ScannerSelfTestResult> {
  const runId = deps.newId()
  const samples = deps.samples ?? buildSelfTestSamples()
  const rows: SelfTestRow[] = []

  for (const sample of samples) {
    const key = `${SELF_TEST_PREFIX}/${runId}/${sample.name}`
    const startedAt = deps.now()

    try {
      await deps.storage.put(key, sample.bytes, sample.contentType)

      const downloadUrl = await deps.storage.presignGet(key)
      const { answer, failure } = await callSelfTest(deps, downloadUrl, sample)
      const durationMs = Math.max(0, Math.round(deps.now() - startedAt))

      if (answer === null) {
        rows.push({
          name: sample.name,
          expected: describeExpected(sample),
          actual: failure ?? "no usable answer",
          passed: false,
          durationMs,
        })
      } else {
        rows.push({
          name: sample.name,
          expected: describeExpected(sample),
          actual: describe(answer.verdict, answer.detail),
          passed: matchesExpectation(sample.expected, answer),
          durationMs,
        })
      }
    } catch (error) {
      // A put or a presign failed. The row says so, and the finally block below
      // still tries to delete whatever may have been written.
      logger.error("scanner_selftest_storage_failed", {
        sample: sample.name,
        reason: error instanceof Error ? error.name : "unknown",
      })

      rows.push({
        name: sample.name,
        expected: describeExpected(sample),
        actual: "the file could not be written to the bucket",
        passed: false,
        durationMs: Math.max(0, Math.round(deps.now() - startedAt)),
      })
    } finally {
      try {
        await deps.storage.remove(key)
      } catch (error) {
        // Leaving an object behind is not worth failing the run over, but it is
        // worth a log line: the key is the only thing recorded, never the URL.
        logger.error("scanner_selftest_cleanup_failed", {
          sample: sample.name,
          reason: error instanceof Error ? error.name : "unknown",
        })
      }
    }
  }

  const health = await fetchScannerHealth(deps)
  const passedCount = rows.filter((row) => row.passed).length

  logger.info("scanner_selftest_finished", {
    passed: passedCount,
    failed: rows.length - passedCount,
    health: health.state,
  })

  return {
    rows,
    health,
    passedCount,
    failedCount: rows.length - passedCount,
  }
}

/** The real storage: one S3 client, built from the environment on first use. */
function createStorage(): SelfTestStorage {
  const env = getR2Env()
  const bucket = env.R2_BUCKET_FILES
  const client = new S3Client({
    // R2 ignores the region but the SDK requires one.
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })

  return {
    put: async (key, bytes, contentType) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.length,
        }),
      )
    },

    presignGet: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: SELF_TEST_URL_TTL_SECONDS,
      }),

    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

/**
 * The scanner's health block on its own, for the page that shows it without
 * running a self-test. Never throws: an unreachable service is a state.
 */
export async function getScannerHealth(): Promise<ScannerHealth> {
  const scanner = getScannerEnv()

  return fetchScannerHealth({
    scannerBaseUrl: scanner.SCANNER_URL.toString(),
    fetch: (url, init) => fetch(url, init),
  })
}

/**
 * The production entry point: real bucket, real scanner, real clock.
 *
 * Storage is built here rather than shared with lib/storage/r2.ts because this
 * is the only place in the app that writes an object with PutObject instead of a
 * presigned upload: a self-test file is 300 bytes, so a browser round trip would
 * be more moving parts for no gain.
 */
export async function runScannerSelfTest(): Promise<ScannerSelfTestResult> {
  const scanner = getScannerEnv()

  return runScannerSelfTestWith({
    storage: createStorage(),
    scannerBaseUrl: scanner.SCANNER_URL.toString(),
    sharedSecret: scanner.SCANNER_SHARED_SECRET,
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    newId: () => randomUUID(),
  })
}
