import { NextResponse } from "next/server"
import { z } from "zod"

import { getScannerEnv } from "@/lib/env"
import { enqueueJob } from "@/lib/jobs/queue"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { verifyCallback } from "@/lib/scanning/signature"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The scanner's answer comes here.
//
// This endpoint is unauthenticated in the cookie sense and is called by a
// machine, so it is protected by the signature instead: a hex HMAC-SHA256 of
// "<timestamp>.<raw body>" under SCANNER_CALLBACK_SECRET, inside a five minute
// window. A request that fails either check is answered 401 with an empty body:
// nothing is learned from a rejection, and nothing about the secret leaks.
//
// A valid callback is answered 200 {"ok":true} every time, including a repeat
// and a result for a scan that has been superseded: the scanner must not retry
// something the database has already decided.

export const dynamic = "force-dynamic"
export const maxDuration = 15

/** Anything larger than this is not a scan result. */
export const MAX_CALLBACK_BYTES = 16 * 1024

/** The scanner sends a handful of callbacks per minute per file at most. */
const RATE_LIMIT_PER_MINUTE = 600

const VERDICTS = ["clean", "infected", "rejected", "needs_review", "error"] as const

const callbackSchema = z
  .object({
    scanId: z.string().uuid(),
    fileId: z.string().uuid(),
    verdict: z.enum(VERDICTS),
    detail: z.string().max(300).nullish(),
    sha256: z.string().max(200).nullish(),
    detectedMime: z.string().max(200).nullish(),
    engine: z.string().max(100).nullish(),
    signatureVersion: z.string().max(100).nullish(),
    scannedAt: z.string().max(100).nullish(),
  })
  .strict()

type RouteResult = NextResponse

/** An empty body: no reason, no hint, no stack. */
function bare(status: number): RouteResult {
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } })
}

function ok(): RouteResult {
  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: Request): Promise<RouteResult> {
  // 1. The generous limit is applied first: a flood of junk should not make the
  //    app do HMAC work. A limiter failure allows the callback through, because
  //    a database hiccup must not silently drop a malware verdict.
  const limit = await rateLimit({
    key: rateLimitKey(["scan-result", "ip", clientIpFromHeaders(request.headers)]),
    limit: RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    onError: "allow",
  })

  if (!limit.allowed) {
    return bare(429)
  }

  // 2. Size, before the body is read into memory.
  const declaredLength = request.headers.get("content-length")

  if (declaredLength !== null) {
    const length = Number.parseInt(declaredLength, 10)

    if (Number.isFinite(length) && length > MAX_CALLBACK_BYTES) {
      return bare(413)
    }
  }

  let rawBody: string

  try {
    rawBody = await request.text()
  } catch {
    return bare(400)
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_CALLBACK_BYTES) {
    return bare(413)
  }

  // 3. The signature, over exactly those bytes.
  let callbackSecret: string

  try {
    callbackSecret = getScannerEnv().SCANNER_CALLBACK_SECRET
  } catch {
    // A scanner that is not configured cannot have sent a valid callback.
    logger.error("scan_callback_not_configured")

    return bare(401)
  }

  const verified = verifyCallback({
    secret: callbackSecret,
    timestamp: request.headers.get("x-scanner-timestamp"),
    signature: request.headers.get("x-scanner-signature"),
    rawBody,
    now: Math.floor(Date.now() / 1000),
  })

  if (!verified.ok) {
    logger.warn("scan_callback_rejected", { reason: verified.reason })

    return bare(401)
  }

  // 4. The body, now that it is known to come from the scanner.
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    return bare(400)
  }

  const parsed = callbackSchema.safeParse(parsedJson)

  if (!parsed.success) {
    logger.warn("scan_callback_invalid")

    return bare(400)
  }

  const callback = parsed.data

  // 5. The database decides what the verdict means: first delivery wins, a
  //    repeat is a duplicate, and a superseded scan id is ignored.
  let reply: unknown

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("record_scan_result", {
      p_scan: callback.scanId,
      p_file: callback.fileId,
      p_verdict: callback.verdict,
      p_detail: callback.detail ?? null,
      p_sha256: callback.sha256 ?? null,
      p_detected_mime: callback.detectedMime ?? null,
      p_engine: callback.engine ?? null,
      p_signature_version: callback.signatureVersion ?? null,
    })

    if (error) {
      // The scanner should try again: nothing was recorded.
      logger.error("scan_callback_record_failed")

      return bare(500)
    }

    reply = data
  } catch {
    logger.error("scan_callback_record_failed")

    return bare(500)
  }

  // 6. An infected file is moved out of the live prefix. The copy is a queued
  //    job, so a storage hiccup cannot fail the callback the scanner is waiting
  //    on; the job retries, and the file is already 'infected' either way.
  const needsQuarantine =
    typeof reply === "object" &&
    reply !== null &&
    (reply as { needs_quarantine?: unknown }).needs_quarantine === true

  const storageKey =
    typeof reply === "object" && reply !== null
      ? (reply as { storage_key?: unknown }).storage_key
      : null

  if (needsQuarantine && typeof storageKey === "string" && storageKey !== "") {
    try {
      await enqueueJob({
        type: "quarantine_file",
        payload: { storageKey },
        dedupeKey: `quarantine_file:${storageKey}`,
      })
    } catch {
      // The verdict stands. Someone will see the infection in the audit log and
      // in the review screen; a failed enqueue is reported, not hidden.
      logger.error("scan_callback_quarantine_enqueue_failed")
    }
  }

  // 7. Malware and rejections are operational events: log the file, the verdict
  //    and the detail code only. The Sentry alert is configured against these
  //    lines; no URL, hash or secret goes into one.
  if (callback.verdict === "infected" || callback.verdict === "rejected") {
    logger.error("scan_file_rejected", {
      fileId: callback.fileId,
      verdict: callback.verdict,
      detail: callback.detail ?? null,
    })
  }

  return ok()
}

/** Every other method is refused, with an empty body. */
export async function GET(): Promise<RouteResult> {
  return bare(405)
}
