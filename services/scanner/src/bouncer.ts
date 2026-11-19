import { openAsBlob } from "node:fs"
import { stat } from "node:fs/promises"
import { basename } from "node:path"

export const BOUNCER_ENGINE = "bouncer"
export const BOUNCER_API_BASE = "https://api.usebouncer.dev"
export const BOUNCER_MAX_FILE_BYTES = 25 * 1024 * 1024
export const BOUNCER_V1_MAX_BYTES = 4_500_000
export const BOUNCER_POLL_INTERVAL_MS = 2_000
export const BOUNCER_DEFAULT_TIMEOUT_MS = 300_000

export type BouncerOutcome =
  | { readonly kind: "clean" }
  | { readonly kind: "infected"; readonly detail: string }
  | { readonly kind: "needs_review"; readonly detail: string }
  | { readonly kind: "rejected"; readonly detail: "provider_file_too_large" }
  | { readonly kind: "error"; readonly detail: "scanner_error" | "timeout" }

type JsonRecord = Record<string, unknown>

type BouncerScanData = {
  readonly scan_id: string
  readonly status: string
  readonly verdict?: string
  readonly poll_url?: string
  readonly upload?: {
    readonly url: string
    readonly fields: Record<string, string>
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readScanData(value: unknown): BouncerScanData {
  if (!isRecord(value) || value.status !== "success" || !isRecord(value.data)) {
    throw new Error("Invalid Bouncer response")
  }

  const data = value.data

  if (typeof data.scan_id !== "string" || typeof data.status !== "string") {
    throw new Error("Invalid Bouncer scan response")
  }

  return data as BouncerScanData
}

function sanitiseThreat(value: unknown): string {
  if (!isRecord(value)) return "Malware detected"

  const candidate =
    typeof value.name === "string"
      ? value.name
      : typeof value.rule === "string"
        ? value.rule
        : typeof value.engine === "string"
          ? value.engine
          : "Malware detected"

  return candidate.replace(/https?:\/\/\S+/gi, "").slice(0, 250) || "Malware detected"
}

function mapVerdict(data: JsonRecord): BouncerOutcome {
  if (data.status === "failed") {
    return { kind: "error", detail: "scanner_error" }
  }

  if (data.status !== "completed") {
    return { kind: "error", detail: "scanner_error" }
  }

  if (data.verdict === "clean") {
    return { kind: "clean" }
  }

  if (data.verdict === "malicious") {
    const threats = Array.isArray(data.threats) ? data.threats : []
    const detail = threats.length > 0
      ? threats.slice(0, 5).map(sanitiseThreat).join("; ")
      : "Malware detected"

    return { kind: "infected", detail }
  }

  if (data.verdict === "suspicious") {
    const threats = Array.isArray(data.threats) ? data.threats : []
    const detail = threats.length > 0
      ? threats.slice(0, 5).map(sanitiseThreat).join("; ")
      : "Bouncer classified this file as suspicious"

    return { kind: "needs_review", detail }
  }

  // Unknown verdicts must never be interpreted as clean.
  return { kind: "error", detail: "scanner_error" }
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    })

    if (!response.ok) {
      throw new Error(`Bouncer returned HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Bouncer request timed out")
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

function validatePollUrl(path: string | undefined, scanId: string, version: 1 | 2): string {
  const fallback = `/${version === 1 ? "v1" : "v2"}/scan/${encodeURIComponent(scanId)}`
  const url = new URL(path ?? fallback, BOUNCER_API_BASE)

  if (url.origin !== BOUNCER_API_BASE) {
    throw new Error("Invalid Bouncer polling URL")
  }

  return url.toString()
}

async function createV1Scan(
  filePath: string,
  apiKey: string,
  timeoutMs: number,
): Promise<BouncerScanData> {
  const blob = await openAsBlob(filePath)
  const form = new FormData()
  form.append("file", blob, basename(filePath))

  const response = await requestJson(
    `${BOUNCER_API_BASE}/v1/scan`,
    {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
    },
    timeoutMs,
  )

  return readScanData(response)
}

async function createV2Scan(
  filePath: string,
  apiKey: string,
  mimeType: string,
  timeoutMs: number,
): Promise<BouncerScanData> {
  const targetResponse = await requestJson(
    `${BOUNCER_API_BASE}/v2/scan`,
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_name: basename(filePath),
        mime_type: mimeType,
      }),
    },
    timeoutMs,
  )

  const scan = readScanData(targetResponse)

  if (
    scan.upload === undefined ||
    typeof scan.upload.url !== "string" ||
    !isRecord(scan.upload.fields)
  ) {
    throw new Error("Bouncer did not return an upload target")
  }

  const uploadUrl = new URL(scan.upload.url)

  // The upload target is expected to be an HTTPS S3 URL.
  if (uploadUrl.protocol !== "https:" || !uploadUrl.hostname.endsWith("amazonaws.com")) {
    throw new Error("Bouncer returned an invalid upload host")
  }

  const form = new FormData()

  for (const [key, value] of Object.entries(scan.upload.fields)) {
    if (typeof value !== "string") {
      throw new Error("Invalid Bouncer upload fields")
    }

    form.append(key, value)
  }

  const blob = await openAsBlob(filePath)
  form.append("file", blob, basename(filePath))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: form,
      signal: controller.signal,
      redirect: "error",
    })

    if (!uploadResponse.ok) {
      throw new Error(`Bouncer storage upload failed: ${uploadResponse.status}`)
    }
  } finally {
    clearTimeout(timer)
  }

  return scan
}

async function pollScan(
  scan: BouncerScanData,
  version: 1 | 2,
  apiKey: string,
  timeoutMs: number,
): Promise<BouncerOutcome> {
  const pollUrl = validatePollUrl(scan.poll_url, scan.scan_id, version)
  const deadline = Date.now() + timeoutMs

  // Some responses may already contain a completed result.
  if (scan.status === "completed" || scan.status === "failed") {
    return mapVerdict(scan as unknown as JsonRecord)
  }

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, BOUNCER_POLL_INTERVAL_MS))

    if (Date.now() >= deadline) {
      break
    }

    const response = await requestJson(
      pollUrl,
      {
        method: "GET",
        headers: { "X-API-Key": apiKey },
      },
      Math.min(15_000, Math.max(1_000, deadline - Date.now())),
    )

    const data = readScanData(response)

    if (data.status === "completed" || data.status === "failed") {
      return mapVerdict(data as unknown as JsonRecord)
    }
  }

  return { kind: "error", detail: "timeout" }
}

/**
 * Scans a local file through Bouncer.
 *
 * Files are uploaded from disk using Node's file-backed Blob support rather
 * than readFile(), avoiding a second full-file copy in the scanner's RAM.
 */
export async function scanFile(
  filePath: string,
  apiKey: string,
  mimeType: string,
  timeoutMs: number = BOUNCER_DEFAULT_TIMEOUT_MS,
): Promise<BouncerOutcome> {
  try {
    const fileInfo = await stat(filePath)

    if (fileInfo.size > BOUNCER_MAX_FILE_BYTES) {
      return { kind: "rejected", detail: "provider_file_too_large" }
    }

    if (fileInfo.size < 1) {
      return { kind: "error", detail: "scanner_error" }
    }

    const version = fileInfo.size <= BOUNCER_V1_MAX_BYTES ? 1 : 2

    const scan = version === 1
      ? await createV1Scan(filePath, apiKey, timeoutMs)
      : await createV2Scan(filePath, apiKey, mimeType, timeoutMs)

    return await pollScan(scan, version, apiKey, timeoutMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""

    if (message.toLowerCase().includes("timed out")) {
      return { kind: "error", detail: "timeout" }
    }

    return { kind: "error", detail: "scanner_error" }
  }
}
