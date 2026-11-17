import * as Sentry from "@sentry/nextjs"

import { maskEmail } from "@/lib/observability/scrub"

// Structured logging: one JSON line per call, nothing else.
//
//   {"level":"warn","event":"csp_report_violation","time":"2026-11-14T09:00:00.000Z",...fields}
//
// The rules are the same in every runtime, because they are decided here and
// nowhere else. A field whose key looks like a credential is replaced by
// "[redacted]" before the line is written, an email address is masked, an Error
// becomes { name, message } (plus stack outside production), and any string
// longer than 500 characters is cut.
//
// logger.error also reports the Error values among its fields to Sentry, but
// only when NEXT_PUBLIC_SENTRY_DSN is set: with no DSN every Sentry call is a
// no-op.

export type LogLevel = "info" | "warn" | "error"

export type LogFields = Record<string, unknown>

export interface Logger {
  info: (event: string, fields?: LogFields) => void
  warn: (event: string, fields?: LogFields) => void
  error: (event: string, fields?: LogFields) => void
}

const REDACTED = "[redacted]"
const CIRCULAR = "[circular]"
const MAX_DEPTH = 6
const MAX_LENGTH = 500
const UNSERIALISABLE = "[unserialisable]"

// pass, password, token, secret, authorization, cookie, api key / api_key,
// otp, and any key ending in "code" (status_code, otp_code, csp code, ...).
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|otp|code$/i

function isProduction(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === "production"
}

function cut(value: string): string {
  return value.length > MAX_LENGTH ? value.slice(0, MAX_LENGTH) : value
}

// A string is masked, then cut.
function cleanString(value: string): string {
  return cut(maskEmail(value))
}

function errorToData(error: Error): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: error.name,
    message: cleanString(error.message),
  }

  // A stack trace names files and line numbers, which is exactly what should
  // not be in a production log line.
  if (!isProduction() && typeof error.stack === "string") {
    data.stack = cut(error.stack)
  }

  return data
}

function sanitise(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null) {
    return null
  }

  if (typeof value === "string") {
    return cleanString(value)
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (value === undefined) {
    return null
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return UNSERIALISABLE
  }

  if (value instanceof Error) {
    return errorToData(value)
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (typeof value !== "object") {
    return UNSERIALISABLE
  }

  if (seen.has(value)) {
    return CIRCULAR
  }

  if (depth >= MAX_DEPTH) {
    return UNSERIALISABLE
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => sanitise(entry, seen, depth + 1))
  }

  const copy: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitise(entry, seen, depth + 1)
  }

  return copy
}

function buildLine(level: LogLevel, event: string, fields?: LogFields): string {
  const line: Record<string, unknown> = {
    level,
    event: cleanString(event),
    time: new Date().toISOString(),
  }

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      line[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitise(value, new WeakSet<object>(), 0)
    }
  }

  return JSON.stringify(line)
}

function write(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line)
    return
  }

  if (level === "warn") {
    console.warn(line)
    return
  }

  console.log(line)
}

// Reported only for the Errors the caller passed as a top-level field, and only
// when there is somewhere to send them.
function reportErrorsToSentry(fields?: LogFields): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN || !fields) {
    return
  }

  for (const value of Object.values(fields)) {
    if (value instanceof Error) {
      Sentry.captureException(value)
    }
  }
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  // Two independent blocks: a failure in the log line must not stop the report,
  // and a failure in the report must not stop the log line. Neither may throw.
  try {
    write(level, buildLine(level, event, fields))
  } catch {
    // A logger that throws is worse than a lost line.
  }

  if (level === "error") {
    try {
      reportErrorsToSentry(fields)
    } catch {
      // Same reason.
    }
  }
}

export const logger: Logger = {
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
}
