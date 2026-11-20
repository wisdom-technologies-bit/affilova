"use server"

import { headers } from "next/headers"
import { z } from "zod"

import * as db from "@/lib/commerce/db"
import { commerceErrorMessage, GENERIC_COMMERCE_ERROR } from "@/lib/commerce/errors"
import { runStartCheckout, type Attribution, type StartCheckoutResult } from "@/lib/commerce/checkout"
import { enqueueRefundSubmit } from "@/lib/commerce/refund-submit"
import { appUrl } from "@/lib/identity/app-urls"
import { getAuthUser } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { initializeTransaction } from "@/lib/paystack/client"
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit"
import { verifyCheckoutTurnstile } from "@/lib/security/turnstile-verify"

// The checkout and refund server actions.
//
// This module only wires: every decision lives in lib/commerce/checkout.ts and
// lib/commerce/db.ts, so the behaviour is tested without a Next.js runtime.
//
// A "use server" module may export only async functions, which is why nothing
// else is exported here.

export interface StartCheckoutRequest {
  productId: string
  email: string
  name?: string
  turnstileToken: string
}

/**
 * Start a checkout and return the Paystack URL to send the buyer to.
 *
 * The amount never comes from this call: the database prices the order and the
 * Paystack request uses that number.
 */
export async function startCheckoutAction(input: StartCheckoutRequest): Promise<StartCheckoutResult> {
  const requestHeaders = await headers()
  const ip = clientIpFromHeaders(requestHeaders)

  try {
    return await runStartCheckout(
      {
        productId: typeof input?.productId === "string" ? input.productId : "",
        email: typeof input?.email === "string" ? input.email : "",
        name: typeof input?.name === "string" ? input.name : undefined,
        turnstileToken: typeof input?.turnstileToken === "string" ? input.turnstileToken : "",
        ip,
      },
      {
        rateLimit,
        verifyTurnstile: verifyCheckoutTurnstile,
        getBuyerUserId: async () => {
          const user = await getAuthUser()

          return user === null ? null : user.id
        },
        // The affiliate extension point. The tracking task fills this in; until
        // then every order is created with no affiliate, which is exactly what a
        // buyer following no referral link gets.
        readAttribution: async (): Promise<Attribution | null> => null,
        createOrder: db.createOrder,
        initializeTransaction,
        attachPaystackInit: db.attachPaystackInit,
        failOrder: db.failOrder,
        callbackUrl: () => appUrl("public", "/checkout/return"),
      },
    )
  } catch (error) {
    logger.error("checkout_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    })

    return { ok: false, error: GENERIC_COMMERCE_ERROR }
  }
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

const refundRequestSchema = z.object({
  orderId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(10, "Give a reason of at least 10 characters.")
    .max(1000, "Keep the reason to 1000 characters or fewer."),
})

export type RequestRefundResult =
  | { ok: true; requestId: string; autoApproved: boolean }
  | { ok: false; error: string }

/**
 * Ask for a refund on a paid order. Only the buyer may ask; the database checks
 * that, and decides whether the request is inside the refund window.
 */
export async function requestRefundAction(input: {
  orderId: string
  reason: string
}): Promise<RequestRefundResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: commerceErrorMessage("not_authenticated") }
  }

  const parsed = refundRequestSchema.safeParse({
    orderId: typeof input?.orderId === "string" ? input.orderId : "",
    reason: typeof input?.reason === "string" ? input.reason : "",
  })

  if (!parsed.success) {
    const first = parsed.error.issues[0]

    return { ok: false, error: first === undefined ? commerceErrorMessage("invalid_input") : first.message }
  }

  try {
    const result = await db.requestRefund({
      actorId: user.id,
      orderId: parsed.data.orderId,
      reason: parsed.data.reason,
    })

    if (result.autoApproved) {
      await enqueueRefundSubmit(result.requestId)
    }

    return { ok: true, requestId: result.requestId, autoApproved: result.autoApproved }
  } catch (error) {
    logger.warn("refund_request_failed", { code: error instanceof Error ? error.message : "unknown" })

    return { ok: false, error: commerceErrorMessage(error) }
  }
}

const refundDecisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000, "Keep the note to 1000 characters or fewer.").optional(),
})

export type DecideRefundResult = { ok: true } | { ok: false; error: string }

/**
 * Decide a refund request. The product's vendor, or admin and finance staff, may
 * decide; the database enforces that and refuses a self-decision.
 */
export async function decideRefundAction(input: {
  requestId: string
  decision: "approve" | "reject"
  note?: string
}): Promise<DecideRefundResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: commerceErrorMessage("not_authenticated") }
  }

  const parsed = refundDecisionSchema.safeParse({
    requestId: typeof input?.requestId === "string" ? input.requestId : "",
    decision: input?.decision,
    note: typeof input?.note === "string" ? input.note : undefined,
  })

  if (!parsed.success) {
    const first = parsed.error.issues[0]

    return { ok: false, error: first === undefined ? commerceErrorMessage("invalid_input") : first.message }
  }

  try {
    await db.decideRefund({
      actorId: user.id,
      requestId: parsed.data.requestId,
      decision: parsed.data.decision,
      note: parsed.data.note === undefined || parsed.data.note === "" ? null : parsed.data.note,
    })
  } catch (error) {
    logger.warn("refund_decision_failed", { code: error instanceof Error ? error.message : "unknown" })

    return { ok: false, error: commerceErrorMessage(error) }
  }

  if (parsed.data.decision === "approve") {
    await enqueueRefundSubmit(parsed.data.requestId)
  }

  return { ok: true }
}
