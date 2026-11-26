import { createHash } from "node:crypto"

import { z } from "zod"

import * as db from "@/lib/commerce/db"
import type { WebhookOutcome } from "@/lib/commerce/db"
import { getPaystackEnv } from "@/lib/env"
import { enqueueJob } from "@/lib/jobs/queue"
import { REFUND_NOTICE_JOB, refundNoticeDedupeKey } from "@/lib/jobs/order-email"
import { logger } from "@/lib/logger"
import * as payoutDb from "@/lib/payouts/db"
import { enqueueWithdrawalNotice } from "@/lib/payouts/notices"
import { PaystackError, verifyTransaction, type VerifiedTransaction } from "@/lib/paystack/client"
import {
  isPaystackSourceIp,
  sourceIpFromHeaders,
  verifyWebhookSignature,
} from "@/lib/paystack/signature"

// POST /api/paystack/webhook
//
// Paystack's delivery endpoint. The order of the checks is the whole design:
//
//   1. the body is at most 64 KB, or it is refused before it is read into a
//      string;
//   2. the signature matches the raw bytes, in constant time, or the answer is
//      401 with an empty body;
//   3. the source address is one Paystack documents (enforced only when
//      PAYSTACK_WEBHOOK_ENFORCE_IPS is true, otherwise logged);
//   4. the body's SHA-256 is recorded, and a body we have already seen answers
//      200 immediately: Paystack retries, and a retry must not post twice;
//   5. only then is the envelope read and handled.
//
// A 200 means "I have this": handled, deliberately ignored, or a duplicate. A
// 500 means "try again": the database or Paystack was unreachable. A 4xx means
// the delivery itself was wrong and Paystack stops.

export const dynamic = "force-dynamic"

/** Paystack's events are a few kilobytes; 64 KB is far above any of them. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

const PROVIDER = "paystack"

const envelopeSchema = z.object({
  event: z.string().min(1),
  data: z.unknown(),
})

const chargeDataSchema = z.object({
  reference: z.string().min(1),
})

// A transfer event. Only the identity and the fee are read: the amount in the
// body is never used for money, because our own row holds what we sent. The
// recipient object is deliberately not parsed, so its full account number is
// never even looked at.
const transferDataSchema = z.object({
  reference: z.string().min(1),
  transfer_code: z.string().min(1).nullish(),
  fee_charged: z.number().int().nonnegative().nullish(),
})

export interface WebhookDeps {
  secretKey: string
  webhookSecret?: string | undefined
  enforceIps: boolean
  verifyTransaction: (reference: string) => Promise<VerifiedTransaction>
  insertEvent: typeof db.insertWebhookEvent
  finishEvent: typeof db.finishWebhookEvent
  processPaidOrder: typeof db.processPaidOrder
  findOpenRefund: typeof db.findOpenRefund
  processRefund: typeof db.processRefund
  enqueueJob: typeof enqueueJob
  markRefundFailed: typeof db.markRefundFailed
  getOrderByReference: typeof db.getOrderByReference
  openDispute: typeof db.openDispute
  /**
   * Records what Paystack decided about a dispute. It moves no money: the
   * decision itself is a person's, taken in the admin app through
   * resolve_dispute.
   */
  recordDisputeProviderOutcome: typeof db.recordDisputeProviderOutcome
  /**
   * The payout result writer. Optional so every existing caller and test keeps
   * compiling; without it a transfer event is logged and ignored rather than
   * retried forever.
   */
  recordTransferResult?: (call: {
    reference: string
    event: "success" | "failed" | "reversed"
    transferCode: string | null
    reason: string | null
    feeKobo: bigint | null
  }) => Promise<{ status: string; applied: boolean }>
  log: {
    info: (event: string, fields?: Record<string, unknown>) => void
    warn: (event: string, fields?: Record<string, unknown>) => void
    error: (event: string, fields?: Record<string, unknown>) => void
  }
}

type Outcome = {
  /** What Paystack should be told. */
  http: 200 | 500
  /** What is recorded against the delivery. */
  status: Exclude<WebhookOutcome, "received">
  /** A short reason, never a payload. */
  error?: string
}

const OK: Outcome = { http: 200, status: "processed" }

function ignored(error?: string): Outcome {
  return { http: 200, status: "ignored", ...(error === undefined ? {} : { error }) }
}

function failed(error: string): Outcome {
  return { http: 200, status: "failed", error }
}

function transient(error: string): Outcome {
  return { http: 500, status: "failed", error }
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } })
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex")
}

/** Best effort, for the delivery record: the strict read happens after it. */
function readEnvelopeLoose(body: Uint8Array): { eventType: string | null; reference: string | null } {
  try {
    const text = new TextDecoder().decode(body)
    const parsed: unknown = JSON.parse(text)

    if (typeof parsed !== "object" || parsed === null) {
      return { eventType: null, reference: null }
    }

    const record = parsed as Record<string, unknown>
    const eventType = typeof record.event === "string" && record.event !== "" ? record.event : null

    return { eventType, reference: extractReference(record.data) }
  } catch {
    return { eventType: null, reference: null }
  }
}

/**
 * The order reference in a webhook body.
 *
 * charge.success carries data.reference. Refunds and disputes carry the whole
 * transaction object, so the reference is one level down; the flattened fields
 * are read too, because the dispute object has carried both shapes.
 */
export function extractReference(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null
  }

  const record = data as Record<string, unknown>

  if (typeof record.reference === "string" && record.reference !== "") {
    return record.reference
  }

  const transaction = record.transaction

  if (typeof transaction === "object" && transaction !== null) {
    const reference = (transaction as Record<string, unknown>).reference

    if (typeof reference === "string" && reference !== "") {
      return reference
    }
  }

  for (const key of ["transaction_reference", "merchant_transaction_reference"]) {
    const value = record[key]

    if (typeof value === "string" && value !== "") {
      return value
    }
  }

  return null
}

/** The provider reference to record for a refund: its reference, else its id. */
function refundProviderReference(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null
  }

  const record = data as Record<string, unknown>

  if (typeof record.reference === "string" && record.reference !== "") {
    return record.reference
  }

  if (typeof record.id === "number" && Number.isInteger(record.id)) {
    return String(record.id)
  }

  return null
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * A successful charge.
 *
 * The body is never trusted for money. It only says which reference to ask
 * about; the amounts, currency, fee, channel, transaction id and paid_at all
 * come from the verify response.
 */
async function handleChargeSuccess(data: unknown, deps: WebhookDeps): Promise<Outcome> {
  const parsed = chargeDataSchema.safeParse(data)

  if (!parsed.success) {
    return failed("missing_reference")
  }

  const reference = parsed.data.reference

  let verified: VerifiedTransaction

  try {
    verified = await deps.verifyTransaction(reference)
  } catch (error) {
    if (error instanceof PaystackError && error.retryable) {
      // Paystack could not be asked. Let Paystack deliver the event again.
      return transient("verify_unavailable")
    }

    const code = error instanceof PaystackError ? error.code : "unknown"

    deps.log.warn("paystack_verify_failed", { reference, code })

    return failed(`verify_${code}`)
  }

  if (verified.status !== "success") {
    deps.log.warn("paystack_charge_not_successful", { reference, status: verified.status })

    return ignored(`charge_${verified.status}`)
  }

  try {
    const result = await deps.processPaidOrder({
      reference: verified.reference,
      paystackTransactionId: verified.id,
      amountKobo: verified.amountKobo,
      currency: verified.currency,
      feesKobo: verified.feesKobo ?? 0,
      channel: verified.channel,
      paidAt: verified.paidAt,
    })

    if (result.status === "mismatch") {
      // Money arrived that does not match the order. Never post it; a person
      // has to look.
      deps.log.error("paystack_amount_mismatch", {
        reference: verified.reference,
        order: result.orderId,
      })

      return failed("amount_mismatch")
    }

    if (result.status === "not_found") {
      deps.log.warn("paystack_order_not_found", { reference: verified.reference })

      return ignored("order_not_found")
    }

    return OK
  } catch (error) {
    // The Error is passed as a field on purpose: lib/logger reports Error values
    // to Sentry, which is where a payment that could not be posted should be.
    deps.log.error("paystack_paid_order_failed", { reference: verified.reference, error })

    return transient("database_unavailable")
  }
}

/** refund.pending, refund.processing and refund.needs-attention: no action. */
function handleRefundWaiting(data: unknown, event: string, deps: WebhookDeps): Outcome {
  deps.log.info("paystack_refund_waiting", {
    event,
    reference: extractReference(data),
  })

  return ignored("refund_in_progress")
}

/**
 * refund.processed: the money has moved, so the ledger is reversed.
 *
 * The amount is the order total from the database, never the webhook body: a
 * partial refund is not supported, and process_refund refuses anything else.
 */
async function handleRefundProcessed(data: unknown, deps: WebhookDeps): Promise<Outcome> {
  const reference = extractReference(data)

  if (reference === null) {
    return failed("missing_reference")
  }

  try {
    const open = await deps.findOpenRefund(reference)

    if (open === null) {
      // Either we never asked for this refund, or it was already processed.
      deps.log.warn("paystack_refund_no_open_request", { reference })

      return ignored("no_open_request")
    }

    const processed = await deps.processRefund({
      requestId: open.requestId,
      providerReference: refundProviderReference(data),
      amountKobo: open.amountKobo,
    })

    // The reversal is posted. Tell the buyer, once: the job's dedupe key is the
    // order, so a second delivery (or a retry after this one) cannot queue a
    // second notice, and the email_log claim behind it is the second guard.
    // A queue failure is logged and not turned into a retry: the delivery record
    // has already marked this body as seen, so Paystack's retry would be answered
    // as a duplicate and the notice would never be queued anyway.
    if (processed.status === "processed") {
      try {
        await deps.enqueueJob({
          type: REFUND_NOTICE_JOB,
          payload: { order_id: processed.orderId },
          dedupeKey: refundNoticeDedupeKey(processed.orderId),
        })
      } catch {
        deps.log.error("paystack_refund_notice_enqueue_failed", {})
      }
    }

    return OK
  } catch (error) {
    deps.log.error("paystack_refund_process_failed", { reference, error })

    return transient("database_unavailable")
  }
}

/** refund.failed: Paystack gave up and credited the account back. */
async function handleRefundFailed(data: unknown, deps: WebhookDeps): Promise<Outcome> {
  const reference = extractReference(data)

  if (reference === null) {
    return failed("missing_reference")
  }

  try {
    const open = await deps.findOpenRefund(reference)

    if (open === null) {
      deps.log.warn("paystack_refund_no_open_request", { reference })

      return ignored("no_open_request")
    }

    await deps.markRefundFailed(open.requestId, "paystack_refund_failed")

    return OK
  } catch (error) {
    deps.log.error("paystack_refund_failed_handler", { reference, error })

    return transient("database_unavailable")
  }
}

/** charge.dispute.create: freeze the order and revoke the downloads. */
async function handleDisputeCreate(data: unknown, deps: WebhookDeps): Promise<Outcome> {
  const reference = extractReference(data)

  if (reference === null) {
    return failed("missing_reference")
  }

  const id = typeof data === "object" && data !== null ? (data as Record<string, unknown>).id : undefined
  const note = typeof id === "number" ? `Paystack dispute ${id}` : "Paystack dispute"

  try {
    await deps.openDispute(reference, note)

    return OK
  } catch (error) {
    const code = error instanceof Error ? error.message : ""

    if (code === "dispute_exists") {
      return ignored("dispute_exists")
    }

    if (code === "not_found" || code === "bad_state") {
      // An order we do not have, or one that is not paid: nothing to freeze.
      deps.log.warn("paystack_dispute_unmatched", { reference, code })

      return ignored(`dispute_${code}`)
    }

    deps.log.error("paystack_dispute_failed", { reference, error })

    return transient("database_unavailable")
  }
}

/**
 * charge.dispute.resolve: Paystack has decided the dispute.
 *
 * The resolution is stored on the dispute and the row is flagged as needing a
 * decision. Nothing else moves: not the order, not the buyer's access, not the
 * ledger. A chargeback is money, and money is moved by a person, in the admin
 * app, after reading both sides. The webhook only reports what the provider said.
 *
 * The documented resolutions are merchant-accepted and declined. Anything else is
 * not guessed at: it is logged and ignored, because guessing would either reverse
 * a sale that stands or keep money that went back.
 */
async function handleDisputeResolve(data: unknown, deps: WebhookDeps): Promise<Outcome> {
  const reference = extractReference(data)

  if (reference === null) {
    return failed("missing_reference")
  }

  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const resolution = typeof record.resolution === "string" ? record.resolution : null

  if (resolution !== "merchant-accepted" && resolution !== "declined") {
    deps.log.warn("paystack_dispute_resolution_unknown", { reference, resolution: resolution ?? "missing" })

    return ignored("resolution_unknown")
  }

  const id = record.id
  const note = typeof id === "number" ? `Paystack dispute ${id}` : "Paystack dispute"

  try {
    await deps.recordDisputeProviderOutcome(reference, resolution, note)

    return OK
  } catch (error) {
    const code = error instanceof Error ? error.message : ""

    if (code === "no_open_dispute") {
      return ignored("no_open_dispute")
    }

    if (code === "not_found") {
      deps.log.warn("paystack_dispute_order_not_found", { reference })

      return ignored("order_not_found")
    }

    deps.log.error("paystack_dispute_resolve_failed", { reference, error })

    return transient("database_unavailable")
  }
}

/**
 * transfer.success, transfer.failed and transfer.reversed.
 *
 * The body says which reference to settle and what Paystack charged. It is never
 * trusted for the amount: record_transfer_result compares the reference and the
 * transfer code with the withdrawal we wrote, and posts from our own numbers. The
 * recipient block carries a full account number, so it is not read, not logged
 * and not stored.
 */
async function handleTransferEvent(
  event: string,
  data: unknown,
  deps: WebhookDeps,
): Promise<Outcome> {
  const parsed = transferDataSchema.safeParse(data)

  if (!parsed.success) {
    return failed("missing_reference")
  }

  const reference = parsed.data.reference
  const outcome =
    event === "transfer.success" ? "success" : event === "transfer.failed" ? "failed" : "reversed"

  if (deps.recordTransferResult === undefined) {
    // No payout writer in this deployment: the event is not handled here, and
    // saying so keeps it in the same bucket as any other event we do not act on.
    deps.log.error("paystack_transfer_handler_missing", { reference, event })

    return ignored("unhandled_event")
  }

  const fee = parsed.data.fee_charged

  try {
    const result = await deps.recordTransferResult({
      reference,
      event: outcome,
      transferCode: parsed.data.transfer_code ?? null,
      reason: outcome === "success" ? null : `paystack_${event.split(".")[1] ?? outcome}`,
      // fee_charged is the real fee. Zero or missing falls back to the bands.
      feeKobo: typeof fee === "number" && fee > 0 ? BigInt(fee) : null,
    })

    if (result.status === "not_found") {
      deps.log.warn("paystack_transfer_withdrawal_not_found", { reference, event })

      return ignored("withdrawal_not_found")
    }

    if (result.status === "mismatch") {
      // Our row holds a different transfer code for this reference. Never post.
      deps.log.error("paystack_transfer_mismatch", { reference, event })

      return ignored("transfer_mismatch")
    }

    if (result.applied) {
      // Tell the user. A queue failure is logged inside and never retried here:
      // the result is already posted, and a retry would be answered as a duplicate.
      await enqueueWithdrawalNotice(deps.enqueueJob, { reference }, result.status, deps.log)
    }

    return OK
  } catch (error) {
    deps.log.error("paystack_transfer_result_failed", { reference, event, error })

    return transient("database_unavailable")
  }
}

async function dispatch(event: string, data: unknown, deps: WebhookDeps): Promise<Outcome> {
  switch (event) {
    case "charge.success":
      return handleChargeSuccess(data, deps)

    case "refund.pending":
    case "refund.processing":
    case "refund.needs-attention":
      return handleRefundWaiting(data, event, deps)

    case "refund.processed":
      return handleRefundProcessed(data, deps)

    case "refund.failed":
      return handleRefundFailed(data, deps)

    case "charge.dispute.create":
      return handleDisputeCreate(data, deps)

    case "charge.dispute.resolve":
      return handleDisputeResolve(data, deps)

    case "transfer.success":
    case "transfer.failed":
    case "transfer.reversed":
      return handleTransferEvent(event, data, deps)

    default:
      // charge.dispute.remind and everything else: recorded, nothing done.
      return ignored("unhandled_event")
  }
}

/**
 * The whole endpoint, with every dependency passed in, so the tests can drive
 * each event and each failure without a database or a network.
 */
export async function handlePaystackWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  // 1. Size, before the body is read into memory.
  const declared = Number(request.headers.get("content-length") ?? "0")

  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }

  let rawBody: Uint8Array

  try {
    rawBody = new Uint8Array(await request.arrayBuffer())
  } catch {
    return json({ error: "unreadable_body" }, 400)
  }

  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }

  // 2. The signature, over exactly these bytes.
  const signature = verifyWebhookSignature({
    rawBody,
    legacySignature: request.headers.get("x-paystack-signature"),
    v1Signature: request.headers.get("paystack-signature"),
    secretKey: deps.secretKey,
    webhookSecret: deps.webhookSecret,
  })

  if (!signature.ok) {
    // Empty body, as the brief requires: a bad signature learns nothing.
    deps.log.warn("paystack_webhook_signature_invalid", { reason: signature.reason })

    return empty(401)
  }

  // 3. The source address. Enforced only when the deployment asks for it.
  const sourceIp = sourceIpFromHeaders(request.headers)
  const fromPaystack = isPaystackSourceIp(sourceIp)

  if (!fromPaystack) {
    if (deps.enforceIps) {
      deps.log.warn("paystack_webhook_ip_rejected", { source: sourceIp })

      return empty(401)
    }

    deps.log.warn("paystack_webhook_ip_unexpected", { source: sourceIp })
  }

  // 4. The delivery record. A body we have already seen is a retry.
  const digest = sha256Hex(rawBody)
  const loose = readEnvelopeLoose(rawBody)

  let recorded: { id: string; duplicate: boolean }

  try {
    recorded = await deps.insertEvent({
      provider: PROVIDER,
      sha256: digest,
      eventType: loose.eventType,
      reference: loose.reference,
    })
  } catch {
    deps.log.error("paystack_webhook_record_failed", {})

    return json({ error: "unavailable" }, 500)
  }

  if (recorded.duplicate) {
    return json({ ok: true, duplicate: true }, 200)
  }

  // 5. The envelope, read strictly now that it is ours to trust.
  const envelope = envelopeSchema.safeParse(safeJson(rawBody))

  if (!envelope.success) {
    await finish(deps, recorded.id, failed("unreadable_envelope"))

    return json({ ok: false }, 200)
  }

  const outcome = await dispatch(envelope.data.event, envelope.data.data, deps)

  await finish(deps, recorded.id, outcome)

  if (outcome.http === 500) {
    return json({ error: "unavailable" }, 500)
  }

  return json({ ok: true }, 200)
}

function safeJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    return null
  }
}

async function finish(deps: WebhookDeps, id: string, outcome: Outcome): Promise<void> {
  try {
    await deps.finishEvent(id, outcome.status, outcome.error ?? null)
  } catch {
    // The delivery is already answered; a bookkeeping failure is logged and not
    // turned into a retry that would run the handler again.
    deps.log.error("paystack_webhook_finish_failed", {})
  }
}

/** The configured dependencies. Read lazily, so importing this file never fails. */
function configuredDeps(): WebhookDeps | null {
  try {
    const env = getPaystackEnv()

    return {
      secretKey: env.PAYSTACK_SECRET_KEY,
      webhookSecret: env.PAYSTACK_WEBHOOK_SECRET,
      enforceIps: env.enforceWebhookIps,
      verifyTransaction,
      insertEvent: db.insertWebhookEvent,
      finishEvent: db.finishWebhookEvent,
      processPaidOrder: db.processPaidOrder,
      findOpenRefund: db.findOpenRefund,
      processRefund: db.processRefund,
      enqueueJob,
      markRefundFailed: db.markRefundFailed,
      getOrderByReference: db.getOrderByReference,
      openDispute: db.openDispute,
      recordDisputeProviderOutcome: db.recordDisputeProviderOutcome,
      recordTransferResult: payoutDb.recordTransferResult,
      log: logger,
    }
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  const deps = configuredDeps()

  if (deps === null) {
    // No secret key, so no delivery can be verified. 500 keeps Paystack trying
    // while the deployment is fixed; answering 200 would drop real events.
    logger.error("paystack_webhook_not_configured", {})

    return json({ error: "unavailable" }, 500)
  }

  return handlePaystackWebhook(request, deps)
}
