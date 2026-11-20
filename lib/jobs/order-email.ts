import "server-only"

import { createHash } from "node:crypto"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import type { SendEmailInput, SendEmailResult } from "@/lib/email/brevo"
import {
  affiliateCommissionEmail,
  purchaseReceiptEmail,
  refundNoticeEmail,
  vendorSaleEmail,
  type BrandingUrls,
} from "@/lib/email/templates"

import type { JobPayload } from "./types"
import type { OrderSummary } from "@/lib/commerce/order-summary"

// The two email jobs.
//
// Each email is claimed in public.email_log before it is sent: a unique row per
// (kind, order, recipient). A retried job therefore finds the claim and sends
// nothing, which is what makes "never twice" a property of the database rather
// than of the queue's bookkeeping. A send that fails releases its claim and
// throws, so the queue retries and the next attempt really does send.

export const ORDER_PAID_JOB = "order_paid"
export const REFUND_NOTICE_JOB = "refund_notice"

/**
 * The de-duplication key for the refund notice. One live notice job per order, so
 * a refunded order whose webhook is delivered twice cannot queue two emails; the
 * email_log claim is the second guard behind it.
 */
export function refundNoticeDedupeKey(orderId: string): string {
  return `${REFUND_NOTICE_JOB}:${orderId}`
}

/** The dedupe key for one email: never the address itself. */
export function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32)
}

export interface EmailLog {
  /** True when this call owns the send, false when it has already been done. */
  claim: (kind: string, orderId: string, hash: string) => Promise<boolean>
  markSent: (kind: string, orderId: string, hash: string, messageId: string | null) => Promise<void>
  release: (kind: string, orderId: string, hash: string) => Promise<void>
}

export interface OrderEmailDeps {
  readOrder: (orderId: string) => Promise<OrderSummary | null>
  createToken: (input: { orderId: string; email: string }) => string
  send: (input: SendEmailInput) => Promise<SendEmailResult>
  log: EmailLog
  branding: BrandingUrls
  now?: () => Date
}

function readOrderId(payload: JobPayload): string | null {
  const value = payload.order_id

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/** paidAt plus the hold, as an ISO instant. */
export function heldUntil(paidAt: string | null, holdDays: number): string {
  const base = paidAt === null ? new Date() : new Date(paidAt)
  const start = Number.isNaN(base.getTime()) ? new Date() : base

  return new Date(start.getTime() + holdDays * 24 * 60 * 60 * 1000).toISOString()
}

interface OutgoingEmail {
  kind: string
  to: string
  content: SendEmailInput
}

function buildBuyerEmail(order: OrderSummary, deps: OrderEmailDeps): OutgoingEmail | null {
  const item = order.item

  if (item === null) {
    return null
  }

  const token = deps.createToken({ orderId: order.id, email: order.buyerEmail })
  const accessUrl = `${deps.branding.siteUrl.replace(/\/+$/, "")}/access/${token}`

  const content = purchaseReceiptEmail({
    orderNumber: order.number,
    productTitle: item.title,
    amountKobo: order.totalKobo,
    paidAt: order.paidAt ?? new Date().toISOString(),
    accessUrl,
    refundWindowHours: item.refundWindowHours,
    branding: deps.branding,
  })

  return {
    kind: "purchase_receipt",
    to: order.buyerEmail,
    content: { ...content, to: order.buyerEmail, template: "purchase_receipt" },
  }
}

function buildVendorEmail(order: OrderSummary, deps: OrderEmailDeps): OutgoingEmail | null {
  const item = order.item

  if (item === null || item.vendorEmail === null) {
    return null
  }

  const content = vendorSaleEmail({
    orderNumber: order.number,
    productTitle: item.title,
    amountKobo: item.unitPriceKobo,
    vendorNetKobo: item.vendorNetKobo,
    heldUntil: heldUntil(order.paidAt, order.commissionHoldDays),
    branding: deps.branding,
  })

  return {
    kind: "vendor_sale",
    to: item.vendorEmail,
    content: { ...content, to: item.vendorEmail, template: "vendor_sale" },
  }
}

function buildAffiliateEmail(order: OrderSummary, deps: OrderEmailDeps): OutgoingEmail | null {
  const item = order.item

  if (item === null || item.affiliateId === null || item.affiliateEmail === null) {
    return null
  }

  const content = affiliateCommissionEmail({
    orderNumber: order.number,
    productTitle: item.title,
    commissionKobo: item.affiliateCommissionKobo,
    heldUntil: heldUntil(order.paidAt, order.commissionHoldDays),
    branding: deps.branding,
  })

  return {
    kind: "affiliate_commission",
    to: item.affiliateEmail,
    content: { ...content, to: item.affiliateEmail, template: "affiliate_commission" },
  }
}

async function deliver(orderId: string, email: OutgoingEmail, deps: OrderEmailDeps): Promise<void> {
  const hash = recipientHash(email.to)
  const owned = await deps.log.claim(email.kind, orderId, hash)

  if (!owned) {
    logger.info("email_skipped_duplicate", { template: email.content.template })

    return
  }

  const result = await deps.send(email.content)

  if (!result.ok) {
    // Give the claim back before throwing: the next attempt must be able to send.
    await deps.log.release(email.kind, orderId, hash)

    throw new Error(`email_send_failed:${email.content.template}`)
  }

  await deps.log.markSent(email.kind, orderId, hash, result.messageId)
}

/**
 * Send the buyer receipt, the vendor notice and, when an affiliate is on the
 * order, the commission notice.
 *
 * An order that is missing, or not paid, is not an error: it is nothing to do.
 * A send that fails throws, so the queue retries the whole job; the emails that
 * already went out are claimed and are not sent again.
 */
export async function runOrderPaidJob(payload: JobPayload, deps: OrderEmailDeps): Promise<void> {
  const orderId = readOrderId(payload)

  if (orderId === null) {
    logger.warn("order_paid_missing_order_id")

    return
  }

  const order = await deps.readOrder(orderId)

  if (order === null) {
    logger.warn("order_paid_order_not_found")

    return
  }

  if (order.status !== "paid") {
    logger.warn("order_paid_not_paid", { status: order.status })

    return
  }

  const emails = [
    buildBuyerEmail(order, deps),
    buildVendorEmail(order, deps),
    buildAffiliateEmail(order, deps),
  ].filter((email): email is OutgoingEmail => email !== null)

  for (const email of emails) {
    await deliver(orderId, email, deps)
  }
}

/** Tell the buyer their money was returned. */
export async function runRefundNoticeJob(payload: JobPayload, deps: OrderEmailDeps): Promise<void> {
  const orderId = readOrderId(payload)

  if (orderId === null) {
    logger.warn("refund_notice_missing_order_id")

    return
  }

  const order = await deps.readOrder(orderId)

  if (order === null || order.item === null) {
    logger.warn("refund_notice_order_not_found")

    return
  }

  if (order.status !== "refunded") {
    logger.warn("refund_notice_not_refunded", { status: order.status })

    return
  }

  const content = refundNoticeEmail({
    orderNumber: order.number,
    productTitle: order.item.title,
    amountKobo: order.totalKobo,
    branding: deps.branding,
  })

  await deliver(
    orderId,
    {
      kind: "refund_notice",
      to: order.buyerEmail,
      content: { ...content, to: order.buyerEmail, template: "refund_notice" },
    },
    deps,
  )
}

// ---------------------------------------------------------------------------
// The email log, on the real table
// ---------------------------------------------------------------------------

const EMAIL_LOG = "email_log"

export const emailLog: EmailLog = {
  async claim(kind, orderId, hash) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .insert({ kind, order_id: orderId, recipient_hash: hash, status: "pending" })

    if (error === null) {
      return true
    }

    // 23505 is a unique violation: someone already owns this send.
    if (error.code === "23505") {
      return false
    }

    throw new Error("email_log_claim_failed")
  },

  async markSent(kind, orderId, hash, messageId) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .update({ status: "sent", provider_message_id: messageId })
      .eq("kind", kind)
      .eq("order_id", orderId)
      .eq("recipient_hash", hash)

    if (error !== null) {
      throw new Error("email_log_update_failed")
    }
  },

  async release(kind, orderId, hash) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .delete()
      .eq("kind", kind)
      .eq("order_id", orderId)
      .eq("recipient_hash", hash)

    if (error !== null) {
      throw new Error("email_log_release_failed")
    }
  },
}
