/**
 * Structured logging for the scanner service.
 *
 * Every line is a single JSON object. Scan lines carry the scan identifiers, the
 * verdict and stage durations and nothing else. Lifecycle lines carry an event
 * name and simple scalar fields, with anything that could hold a URL, secret,
 * file name or file content dropped before it reaches the sink.
 */

export type StageDurations = Readonly<Record<string, number>>

export type ScanLogFields = {
  readonly scanId: string
  readonly fileId: string
  readonly verdict: string
  readonly durationMs: number
  readonly stages?: StageDurations
}

export type LifecycleFields = Readonly<Record<string, string | number | boolean>>

export type Logger = {
  readonly scan: (fields: ScanLogFields) => void
  readonly lifecycle: (event: string, fields?: LifecycleFields) => void
}

const STAGE_NAME = /^[a-z][a-zA-Z0-9]*$/

const UNSAFE_KEY = /url|uri|secret|token|password|key|path|dir|file|content|body|sig/i

const LOG_STAGE_LIMIT = 12

function roundDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.round(value)
}

/**
 * Formats one scan result line. Stage timings are kept only for well formed
 * stage names and finite numbers so an unexpected key cannot smuggle payload
 * data into the log.
 */
export function formatScanLog(fields: ScanLogFields): string {
  const line: Record<string, string | number | Record<string, number>> = {
    level: "info",
    event: "scan.result",
    scanId: fields.scanId,
    fileId: fields.fileId,
    verdict: fields.verdict,
    durationMs: roundDuration(fields.durationMs),
  }

  if (fields.stages !== undefined) {
    const stages: Record<string, number> = {}
    let kept = 0

    for (const [name, value] of Object.entries(fields.stages)) {
      if (kept >= LOG_STAGE_LIMIT || !STAGE_NAME.test(name) || !Number.isFinite(value)) {
        continue
      }

      stages[name] = roundDuration(value)
      kept += 1
    }

    line.stages = stages
  }

  return JSON.stringify(line)
}

/**
 * Formats one lifecycle line (startup, shutdown, rejected request). Keys that
 * could describe an object, credential or request body are dropped.
 */
export function formatLifecycleLog(event: string, fields: LifecycleFields = {}): string {
  const line: Record<string, string | number | boolean> = {
    level: "info",
    event,
  }

  for (const [name, value] of Object.entries(fields)) {
    if (UNSAFE_KEY.test(name)) {
      continue
    }

    if (typeof value === "string") {
      line[name] = value.length > 80 ? value.slice(0, 80) : value
      continue
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      line[name] = value
      continue
    }

    if (typeof value === "boolean") {
      line[name] = value
    }
  }

  return JSON.stringify(line)
}

/**
 * Builds a logger that writes whole lines through the supplied sink, which is
 * `process.stdout.write` in production and an array collector in tests.
 */
export function createLogger(sink: (line: string) => void): Logger {
  return {
    scan: (fields: ScanLogFields): void => {
      sink(`${formatScanLog(fields)}\n`)
    },
    lifecycle: (event: string, fields?: LifecycleFields): void => {
      sink(`${formatLifecycleLog(event, fields)}\n`)
    },
  }
}
