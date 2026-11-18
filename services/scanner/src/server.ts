/**
 * The HTTP surface.
 *
 * Three routes: `POST /scan`, `POST /selftest` and `GET /healthz`. A request is
 * authenticated before its body is read, the body is capped at 8 KB, and every
 * field is validated against the scanning contract before a job is queued.
 * Responses never echo the reason a secret was refused.
 *
 * `/selftest` runs the same pipeline as `/scan` and answers with the verdict
 * instead of sending a callback. It takes one caller at a time.
 */

import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { isAuthorized } from "#auth"
import type { CallbackPayload } from "#callback"
import { createCallbackSender, defaultSleep } from "#callback"
import {
  CLAMD_SOCKET_PATH,
  CLAMAV_DB_DIR,
  PAYLOAD_ENGINE,
  createEngineInfoCache,
  createReadinessProbe,
  parseClamdVersion,
  pingClamd,
  readSignatureAgeHours,
  scanFile,
} from "#clamav"
import type { ClamavInfo, Readiness } from "#clamav"
import { loadConfig } from "#config"
import type { ScannerConfig } from "#config"
import { downloadToFile, nodeFetch } from "#download"
import { runCommand } from "#exec"
import { createLogger } from "#log"
import type { Logger } from "#log"
import { ARCHIVE_EXTENSIONS, ALLOWED_EXTENSIONS, isAllowedExtension } from "#mime-policy"
import { ScanQueue, prepareWorkDir } from "#queue"
import { runScan, runScanPipeline } from "#scan-runner"
import type { PipelineDeps, ScanJob, ScanRunnerDeps } from "#scan-runner"
import {
  SELFTEST_DEADLINE_MS,
  createSelftestJob,
  createSelftestLock,
  errorResult,
  timeoutResult,
  toSelftestResult,
  validateSelftestRequest,
} from "#selftest"
import type { SelftestLock, SelftestRunner } from "#selftest"
import { CALLBACK_PATH, checkCallbackUrl, checkDownloadUrl } from "#url-guard"

export const MAX_REQUEST_BODY_BYTES = 8192
export const RETRY_AFTER_SECONDS = 30
export const SHUTDOWN_GRACE_MS = 60_000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EXTENSION_PATTERN = /^[a-z0-9]+$/

export type Admission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "full" | "closed" }

/**
 * Everything `POST /selftest` needs. The runner is injected so the route can be
 * tested without a network, and so production can prove it uses the same
 * pipeline function as a queued scan.
 */
export type SelftestContext = {
  readonly pipeline: PipelineDeps
  readonly run: SelftestRunner
  readonly lock: SelftestLock
  readonly deadlineMs?: number
}

export type ServerContext = {
  readonly config: ScannerConfig
  readonly admission: (job: ScanJob) => Admission
  readonly readiness: () => Promise<Readiness>
  readonly log: Logger
  readonly selftest: SelftestContext
}

export type ValidationResult =
  | { readonly ok: true; readonly job: ScanJob }
  | { readonly ok: false; readonly field: string; readonly reason: string }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalid(field: string, reason: string): ValidationResult {
  return { ok: false, field, reason }
}

/**
 * Checks every field of a scan request. Nothing is coerced: a number must be a
 * number, an extension must already be lowercase and dot free.
 */
export function validateScanRequest(body: unknown, config: ScannerConfig): ValidationResult {
  if (!isRecord(body)) {
    return invalid("body", "must be a JSON object")
  }

  const scanId = body.scanId
  const fileId = body.fileId
  const downloadUrl = body.downloadUrl
  const expectedSizeBytes = body.expectedSizeBytes
  const extension = body.extension
  const callbackUrl = body.callbackUrl

  if (typeof scanId !== "string" || !UUID_PATTERN.test(scanId)) {
    return invalid("scanId", "must be a uuid")
  }

  if (typeof fileId !== "string" || !UUID_PATTERN.test(fileId)) {
    return invalid("fileId", "must be a uuid")
  }

  const downloadCheck = checkDownloadUrl(downloadUrl, config.allowedDownloadHostSuffix)

  if (!downloadCheck.ok) {
    return invalid("downloadUrl", downloadCheck.reason)
  }

  if (typeof expectedSizeBytes !== "number" || !Number.isInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    return invalid("expectedSizeBytes", "must be a non-negative integer")
  }

  if (typeof extension !== "string" || !EXTENSION_PATTERN.test(extension)) {
    return invalid("extension", "must be a lowercase extension without a dot")
  }

  if (!isAllowedExtension(extension)) {
    return invalid("extension", "is not an accepted file type")
  }

  const callbackCheck = checkCallbackUrl(callbackUrl, config.allowedCallbackOrigins)

  if (!callbackCheck.ok) {
    return invalid("callbackUrl", callbackCheck.reason)
  }

  return {
    ok: true,
    job: {
      scanId,
      fileId,
      downloadUrl: downloadCheck.url.toString(),
      expectedSizeBytes,
      extension,
      callbackUrl: callbackCheck.url.toString(),
    },
  }
}

type BodyResult =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "too_large" }
  | { readonly kind: "invalid_json" }
  | { readonly kind: "read_error" }

function readBody(request: IncomingMessage): Promise<BodyResult> {
  const declared = request.headers["content-length"]

  if (declared !== undefined) {
    const length = Number(declared)

    if (Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES) {
      return Promise.resolve({ kind: "too_large" })
    }
  }

  return new Promise<BodyResult>((resolveBody) => {
    const chunks: Buffer[] = []
    let total = 0
    let oversized = false

    request.on("data", (chunk: Buffer) => {
      if (oversized) {
        return
      }

      total += chunk.length

      if (total > MAX_REQUEST_BODY_BYTES) {
        oversized = true
        chunks.length = 0

        return
      }

      chunks.push(chunk)
    })

    request.on("end", () => {
      if (oversized) {
        resolveBody({ kind: "too_large" })

        return
      }

      const raw = Buffer.concat(chunks).toString("utf8")

      try {
        resolveBody({ kind: "ok", value: JSON.parse(raw) })
      } catch {
        resolveBody({ kind: "invalid_json" })
      }
    })

    request.on("error", () => {
      resolveBody({ kind: "read_error" })
    })
  })
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): void {
  const payload = JSON.stringify(body)

  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  })
  response.end(payload)
}

function requestPath(request: IncomingMessage): string | null {
  const raw = request.url

  if (raw === undefined) {
    return null
  }

  try {
    return new URL(raw, "http://scanner.invalid").pathname
  } catch {
    return null
  }
}

async function handleHealth(context: ServerContext, response: ServerResponse): Promise<void> {
  const readiness = await context.readiness()

  sendJson(response, readiness.ready ? 200 : 503, {
    ok: readiness.ready,
    clamd: readiness.clamd,
    signatureAgeHours: readiness.signatureAgeHours,
  })
}

async function handleScan(context: ServerContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isAuthorized(request.headers.authorization, context.config.sharedSecret)) {
    request.resume()
    context.log.lifecycle("scan.unauthorized")
    sendJson(response, 401, { error: "unauthorized" }, { connection: "close" })

    return
  }

  const body = await readBody(request)

  if (body.kind === "too_large") {
    context.log.lifecycle("scan.payload_too_large")
    sendJson(response, 413, { error: "payload_too_large" }, { connection: "close" })

    return
  }

  if (body.kind === "invalid_json") {
    sendJson(response, 400, { error: "invalid_json" })

    return
  }

  if (body.kind === "read_error") {
    sendJson(response, 400, { error: "invalid_request" })

    return
  }

  const validation = validateScanRequest(body.value, context.config)

  if (!validation.ok) {
    sendJson(response, 400, { error: "invalid_request", field: validation.field })

    return
  }

  const readiness = await context.readiness()

  if (!readiness.ready) {
    sendJson(response, 503, { error: "not_ready" })

    return
  }

  const admission = context.admission(validation.job)

  if (!admission.accepted) {
    if (admission.reason === "closed") {
      sendJson(response, 503, { error: "shutting_down" })

      return
    }

    sendJson(
      response,
      429,
      { error: "queue_full" },
      { "retry-after": String(RETRY_AFTER_SECONDS) },
    )

    return
  }

  sendJson(response, 202, { accepted: true })
}

/**
 * Answers the outcome of one self-test with a 200, whatever the verdict: the
 * caller asked what the chain does, and "it fails" is an answer, not an error.
 */
async function handleSelftest(
  context: ServerContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!isAuthorized(request.headers.authorization, context.config.sharedSecret)) {
    request.resume()
    context.log.lifecycle("selftest.unauthorized")
    sendJson(response, 401, { error: "unauthorized" }, { connection: "close" })

    return
  }

  const body = await readBody(request)

  if (body.kind === "too_large") {
    context.log.lifecycle("selftest.payload_too_large")
    sendJson(response, 413, { error: "payload_too_large" }, { connection: "close" })

    return
  }

  if (body.kind === "invalid_json") {
    sendJson(response, 400, { error: "invalid_json" })

    return
  }

  if (body.kind === "read_error") {
    sendJson(response, 400, { error: "invalid_request" })

    return
  }

  const validation = validateSelftestRequest(body.value, context.config)

  if (!validation.ok) {
    sendJson(response, 400, { error: "invalid_request", field: validation.field })

    return
  }

  const { selftest } = context

  if (!selftest.lock.tryAcquire()) {
    context.log.lifecycle("selftest.busy")
    sendJson(
      response,
      429,
      { error: "selftest_busy" },
      { "retry-after": String(RETRY_AFTER_SECONDS) },
    )

    return
  }

  const startedAt = Date.now()
  const deadlineMs = selftest.deadlineMs ?? SELFTEST_DEADLINE_MS
  const job = createSelftestJob(validation.request)

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const expired = new Promise<null>((resolveExpired) => {
      timer = setTimeout(() => {
        resolveExpired(null)
      }, deadlineMs)
    })

    // The pipeline enforces the same deadline itself, so this race is the
    // backstop that guarantees an answer even if a stage ignores its abort.
    const report = await Promise.race([selftest.run(job, selftest.pipeline), expired])

    const result =
      report === null
        ? timeoutResult(Date.now() - startedAt)
        : toSelftestResult(report.payload, report.durationMs)

    context.log.lifecycle("selftest.result", {
      verdict: result.verdict,
      durationMs: result.durationMs,
    })

    sendJson(response, 200, { ...result })

    return
  } catch {
    context.log.lifecycle("selftest.error")

    sendJson(response, 200, { ...errorResult("scanner_error", Date.now() - startedAt) })

    return
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }

    selftest.lock.release()
  }
}

async function handleRequest(
  context: ServerContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const path = requestPath(request)

    if (path === null) {
      sendJson(response, 404, { error: "not_found" })

      return
    }

    if (path === "/healthz" && request.method === "GET") {
      await handleHealth(context, response)

      return
    }

    if (path === "/scan" && request.method === "POST") {
      await handleScan(context, request, response)

      return
    }

    if (path === "/selftest" && request.method === "POST") {
      await handleSelftest(context, request, response)

      return
    }

    request.resume()
    sendJson(response, 404, { error: "not_found" })
  } catch {
    if (!response.headersSent) {
      sendJson(response, 500, { error: "internal_error" })
    }
  }
}

export function createScannerServer(context: ServerContext): Server {
  return createServer((request, response) => {
    void handleRequest(context, request, response)
  })
}

/**
 * Reads the engine and signature version once, then hourly through the cache.
 */
async function loadClamavInfo(): Promise<ClamavInfo> {
  const result = await runCommand("clamdscan", ["--version"], { timeoutMs: 10_000 })

  return parseClamdVersion(`${result.stdout}\n${result.stderr}`)
}

function main(): void {
  let config: ScannerConfig

  try {
    config = loadConfig(process.env)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid configuration"
    process.stderr.write(`${JSON.stringify({ level: "fatal", event: "config.invalid", message })}\n`)
    process.exitCode = 1
    process.exit(1)
  }

  const log = createLogger((line: string) => {
    process.stdout.write(line)
  })

  const runnerDeps = {
    workDir: config.workDir,
    maxFileBytes: config.maxFileBytes,
    fetch: nodeFetch,
    download: downloadToFile,
    runCommand,
    scanFile,
    readClamavInfo: createEngineInfoCache(loadClamavInfo, Date.now).get,
    now: Date.now,
    log,
  } satisfies PipelineDeps

  const queue = new ScanQueue<ScanJob>({
    concurrency: config.concurrency,
    limit: config.queueLimit,
    worker: async (job: ScanJob): Promise<void> => {
      const sender = createCallbackSender({
        callbackUrl: job.callbackUrl,
        secret: config.callbackSecret,
        fetch: nodeFetch,
        sleep: defaultSleep,
        now: Date.now,
      })

      await runScan(job, {
        ...runnerDeps,
        sendCallback: (payload: CallbackPayload) => sender.send(payload),
      })
    },
    onError: (job: ScanJob): void => {
      log.scan({ scanId: job.scanId, fileId: job.fileId, verdict: "error", durationMs: 0 })
    },
  })

  const readiness = createReadinessProbe({
    ping: () => pingClamd(CLAMD_SOCKET_PATH),
    signatureAge: () => readSignatureAgeHours(CLAMAV_DB_DIR, Date.now()),
    now: Date.now,
  })

  // The self-test runs the same pipeline function as a queued scan, with its
  // own tighter deadlines: a self-test must answer inside 25 seconds.
  const selftestPipeline: PipelineDeps = {
    ...runnerDeps,
    overallTimeoutMs: SELFTEST_DEADLINE_MS,
    downloadTimeoutMs: 10_000,
    commandTimeoutMs: 15_000,
    clamavTimeoutMs: 20_000,
  }

  const server = createScannerServer({
    config,
    admission: (job: ScanJob): Admission => {
      const outcome = queue.tryEnqueue(job)

      if (outcome.accepted) {
        return { accepted: true }
      }

      return { accepted: false, reason: outcome.reason }
    },
    readiness,
    log,
    selftest: {
      pipeline: selftestPipeline,
      run: runScanPipeline,
      lock: createSelftestLock(),
    },
  })

  void prepareWorkDir(config.workDir).then((removed: number) => {
    log.lifecycle("scanner.start", {
      port: config.port,
      concurrency: config.concurrency,
      queueLimit: config.queueLimit,
      extensions: ALLOWED_EXTENSIONS.length,
      archiveExtensions: ARCHIVE_EXTENSIONS.length,
      staleFilesRemoved: removed,
      engine: PAYLOAD_ENGINE,
      callbackPath: CALLBACK_PATH,
    })

    server.listen(config.port, () => {
      log.lifecycle("scanner.listening", { port: config.port })
    })
  })

  let stopping = false

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) {
      return
    }

    stopping = true
    log.lifecycle("scanner.shutdown", { signal })

    server.close()

    const result = await queue.shutdown(SHUTDOWN_GRACE_MS)
    const removed = await prepareWorkDir(config.workDir)

    log.lifecycle("scanner.stopped", { finished: result.finished, dropped: result.dropped, removed })
    process.exit(0)
  }

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM")
  })

  process.once("SIGINT", () => {
    void shutdown("SIGINT")
  })
}

const entry = process.argv[1]

if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
}
