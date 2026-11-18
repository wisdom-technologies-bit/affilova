import "server-only"

import { z } from "zod"

import { commerceErrorMessage } from "@/lib/commerce/errors"
import type { CreatedRefund } from "@/lib/paystack/client"
import { PaystackError } from "@/lib/paystack/client"
import type { RefundRequestRow } from "@/lib/commerce/db"

// Submitting an approved refund to Paystack.
//
// The ledger is not touched here. Paystack accepting a refund means "queued for
// processing"; the reversal is posted by process_refund when the
// refund.processed webhook arrives, so a refund that later fails cannot leave
// the books reversed.
//
// Two guards against paying a customer twice:
//   * the job is enqueued with a de-duplication key per request, so one request
//     has one live job;
//   * Paystack accepts a given refund reference once, so even a repeated call
//     cannot create a second refund.

export const REFUND_SUBMIT_JOB = "refund_submit"

/** The de-duplication key for a refund request. One live job per request. */
export function refundSubmitDedupeKey(requestId: string): string {
  return `${REFUND_SUBMIT_JOB}:${requestId}`
}

/**
 * Our own Paystack refund reference: afv_refund_ plus the request id without
 * hyphens. 43 characters, inside the documented 8 to 64, letters, digits and
 * underscores only.
 */
export function refundProviderReference(requestId: string): string {
  return `afv_refund_${requestId.replace(/-/g, "")}`
}

export const refundSubmitPayloadSchema = z.object({
  request_id: z.string().uuid(),
})

export type RefundSubmitPayload = z.infer<typeof refundSubmitPayloadSchema>

export interface RefundSubmitDeps {
  readRequest: (requestId: string) => Promise<RefundRequestRow | null>
  readOrder: (orderId: string) => Promise<{ reference: string; totalKobo: number; status: string } | null>
  createRefund: (input: {
    transaction: string
    amountKobo: number
    reference: string
    merchantNote?: string
  }) => Promise<CreatedRefund>
  markSubmitted: (requestId: string, providerReference: string) => Promise<void>
  markFailed: (requestId: string, reason: string) => Promise<void>
  logWarn: (event: string, fields: Record<string, unknown>) => void
}

/**
 * Run one refund submission. Throwing means "try again later"; every terminal
 * outcome is recorded and returns normally.
 */
export async function runRefundSubmitJob(payload: unknown, deps: RefundSubmitDeps): Promise<void> {
  const parsed = refundSubmitPayloadSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("refund_submit_bad_payload")
  }

  const requestId = parsed.data.request_id
  const request = await deps.readRequest(requestId)

  if (request === null) {
    // The request was deleted or never existed: there is nothing to submit.
    return
  }

  if (request.status !== "approved") {
    // Already submitted, already processed, already failed, or rejected.
    return
  }

  if (request.providerReference !== null) {
    return
  }

  const order = await deps.readOrder(request.orderId)

  if (order === null) {
    await deps.markFailed(requestId, "order_missing")
    return
  }

  const providerReference = refundProviderReference(requestId)

  try {
    const refund = await deps.createRefund({
      transaction: order.reference,
      // The full amount, from the database.
      amountKobo: order.totalKobo,
      reference: providerReference,
      merchantNote: "Refund approved on Affilova",
    })

    await deps.markSubmitted(requestId, refund.reference ?? providerReference)
  } catch (error) {
    if (error instanceof PaystackError) {
      // 409 means Paystack already holds this refund reference: a retry of a
      // call that did land. That is the same outcome as a fresh success, so it
      // is recorded as submitted rather than as a failure.
      if (error.status === 409) {
        deps.logWarn("refund_submit_already_exists", { request: requestId })

        await deps.markSubmitted(requestId, providerReference)
        return
      }

      if (error.retryable) {
        // The job runner backs off and tries again.
        throw error
      }

      await deps.markFailed(requestId, `paystack_${error.code}`)
      return
    }

    // A database or network failure this module cannot classify: let the queue
    // retry rather than marking a refund failed for a reason that may pass.
    throw error
  }
}

/** The safe sentence a buyer sees when a refund request is refused. */
export function refundErrorMessage(error: unknown): string {
  return commerceErrorMessage(error)
}
