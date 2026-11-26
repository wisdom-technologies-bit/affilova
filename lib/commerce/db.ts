import "server-only"

import { z } from "zod"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The typed wrappers around the checkout-support SQL functions.
//
// Every wrapper does the same three things: call the function with named
// arguments, refuse an answer that does not match the documented shape, and turn
// a PostgrestError into one short message. The business outcomes (not_found,
// mismatch, already_paid) are values, not errors: the caller decides what they
// mean.

function rpcFailure(name: string): Error {
  return new Error(`commerce_rpc_failed:${name}`)
}

const jsonObject = z.record(z.string(), z.unknown())

function firstObject(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const [row]: unknown[] = data

    return jsonObject.safeParse(row).success ? (row as Record<string, unknown>) : null
  }

  const parsed = jsonObject.safeParse(data)

  return parsed.success ? parsed.data : null
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]

  return typeof value === "string" && value !== "" ? value : null
}

function readInteger(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]

  return typeof value === "number" && Number.isInteger(value) ? value : null
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CreateOrderCall {
  buyerUserId: string | null
  email: string
  name: string | null
  productId: string
  affiliateId: string | null
  clickId: string | null
  ipHash: string | null
  reference: string
}

export interface CreatedOrder {
  orderId: string
  number: string
  totalKobo: number
  currency: string
  reference: string
}

export async function createOrder(call: CreateOrderCall): Promise<CreatedOrder> {
  const { data, error } = await getSupabaseAdminClient().rpc("create_order", {
    p_buyer_user: call.buyerUserId,
    p_email: call.email,
    p_name: call.name,
    p_product: call.productId,
    p_affiliate: call.affiliateId,
    p_click: call.clickId,
    p_ip_hash: call.ipHash,
    p_reference: call.reference,
  })

  if (error) {
    // The SQL raises a short code as the message; commerceErrorMessage maps it.
    throw new Error(typeof error.message === "string" ? error.message.trim() : "create_order_failed")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("create_order")
  }

  const orderId = readString(row, "order_id")
  const number = readString(row, "number")
  const reference = readString(row, "reference")
  const totalKobo = readInteger(row, "total_kobo")
  const currency = readString(row, "currency")

  if (orderId === null || number === null || reference === null || totalKobo === null || currency === null) {
    throw rpcFailure("create_order")
  }

  return { orderId, number, totalKobo, currency, reference }
}

/**
 * The affiliate a click belongs to, or null.
 *
 * The database is the only authority here: it checks that the click exists, is
 * for this product, is inside the attribution window and that the affiliate may
 * still promote. A null answer means the order is created with no affiliate.
 */
export async function getClickAttribution(clickId: string, productId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_click_attribution", {
    p_click: clickId,
    p_product: productId,
  })

  if (error) {
    throw rpcFailure("get_click_attribution")
  }

  if (typeof data === "string") {
    return data === "" ? null : data
  }

  if (Array.isArray(data)) {
    const [value]: unknown[] = data

    return typeof value === "string" && value !== "" ? value : null
  }

  return null
}

export async function attachPaystackInit(orderId: string, accessCode: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("attach_paystack_init", {
    p_order: orderId,
    p_access_code: accessCode,
  })

  if (error) {
    throw rpcFailure("attach_paystack_init")
  }
}

export async function failOrder(reference: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("fail_order", {
    p_reference: reference,
    p_reason: reason,
  })

  if (error) {
    throw rpcFailure("fail_order")
  }
}

export interface OrderLookup {
  id: string
  number: string
  status: string
  totalKobo: number
  buyerEmail: string
}

export async function getOrderByReference(reference: string): Promise<OrderLookup | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("get_order_by_reference", {
    p_reference: reference,
  })

  if (error) {
    throw rpcFailure("get_order_by_reference")
  }

  const row = firstObject(data)

  if (row === null) {
    return null
  }

  const id = readString(row, "id")
  const number = readString(row, "number")
  const status = readString(row, "status")
  const totalKobo = readInteger(row, "total_kobo")
  const buyerEmail = readString(row, "buyer_email")

  if (id === null || number === null || status === null || totalKobo === null) {
    throw rpcFailure("get_order_by_reference")
  }

  return { id, number, status, totalKobo, buyerEmail: buyerEmail ?? "" }
}

export type PaidOrderStatus = "processed" | "already_paid" | "mismatch" | "not_found"

export interface PaidOrderInput {
  reference: string
  paystackTransactionId: number
  amountKobo: number
  currency: string
  feesKobo: number
  channel: string | null
  paidAt: string | null
}

export interface PaidOrderResult {
  status: PaidOrderStatus
  orderId: string | null
  number: string | null
}

export async function processPaidOrder(input: PaidOrderInput): Promise<PaidOrderResult> {
  const { data, error } = await getSupabaseAdminClient().rpc("process_paid_order", {
    p_reference: input.reference,
    p_paystack_txn_id: input.paystackTransactionId,
    p_amount_kobo: input.amountKobo,
    p_currency: input.currency,
    p_fees_kobo: input.feesKobo,
    p_channel: input.channel,
    p_paid_at: input.paidAt,
  })

  if (error) {
    throw rpcFailure("process_paid_order")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("process_paid_order")
  }

  const status = readString(row, "status")

  if (
    status !== "processed" &&
    status !== "already_paid" &&
    status !== "mismatch" &&
    status !== "not_found"
  ) {
    throw rpcFailure("process_paid_order")
  }

  return { status, orderId: readString(row, "order_id"), number: readString(row, "number") }
}

export async function expirePendingOrders(limit: number): Promise<number> {
  const { data, error } = await getSupabaseAdminClient().rpc("expire_pending_orders", {
    p_limit: limit,
  })

  if (error) {
    throw rpcFailure("expire_pending_orders")
  }

  if (typeof data === "number") {
    return data
  }

  if (Array.isArray(data) && typeof data[0] === "number") {
    return data[0]
  }

  throw rpcFailure("expire_pending_orders")
}

export async function listOrdersNeedingVerification(limit: number): Promise<string[]> {
  const { data, error } = await getSupabaseAdminClient().rpc("list_orders_needing_verification", {
    p_limit: limit,
  })

  if (error) {
    throw rpcFailure("list_orders_needing_verification")
  }

  if (!Array.isArray(data)) {
    throw rpcFailure("list_orders_needing_verification")
  }

  const references: string[] = []

  for (const row of data as unknown[]) {
    if (typeof row === "string") {
      references.push(row)
      continue
    }

    if (typeof row === "object" && row !== null) {
      const reference = (row as { reference?: unknown }).reference

      if (typeof reference === "string" && reference !== "") {
        references.push(reference)
      }
    }
  }

  return references
}

// ---------------------------------------------------------------------------
// Webhook bookkeeping
// ---------------------------------------------------------------------------

export interface WebhookEventInsert {
  id: string
  duplicate: boolean
}

export async function insertWebhookEvent(input: {
  provider: string
  sha256: string
  eventType: string | null
  reference: string | null
}): Promise<WebhookEventInsert> {
  const { data, error } = await getSupabaseAdminClient().rpc("insert_webhook_event", {
    p_provider: input.provider,
    p_sha256: input.sha256,
    p_event_type: input.eventType,
    p_reference: input.reference,
  })

  if (error) {
    throw rpcFailure("insert_webhook_event")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("insert_webhook_event")
  }

  const id = readString(row, "id")
  const duplicate = row.duplicate

  if (id === null || typeof duplicate !== "boolean") {
    throw rpcFailure("insert_webhook_event")
  }

  return { id, duplicate }
}

export type WebhookOutcome = "received" | "processed" | "ignored" | "failed"

export async function finishWebhookEvent(
  id: string,
  status: WebhookOutcome,
  error?: string | null,
): Promise<void> {
  const { error: rpcError } = await getSupabaseAdminClient().rpc("finish_webhook_event", {
    p_id: id,
    p_status: status,
    p_error: error ?? null,
  })

  if (rpcError) {
    throw rpcFailure("finish_webhook_event")
  }
}

export async function purgeOldWebhookEvents(days: number): Promise<number> {
  const { data, error } = await getSupabaseAdminClient().rpc("purge_old_webhook_events", {
    p_days: days,
  })

  if (error) {
    throw rpcFailure("purge_old_webhook_events")
  }

  if (typeof data === "number") {
    return data
  }

  if (Array.isArray(data) && typeof data[0] === "number") {
    return data[0]
  }

  throw rpcFailure("purge_old_webhook_events")
}

/** The last 24 hours of webhook deliveries, counted by status. */
export async function webhookEventCounts(sinceIso: string): Promise<Record<WebhookOutcome, number>> {
  const supabase = getSupabaseAdminClient()
  const statuses: readonly WebhookOutcome[] = ["received", "processed", "ignored", "failed"]

  const answers = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("status", status)
        .gte("received_at", sinceIso)

      return { status, count: error ? 0 : (count ?? 0) }
    }),
  )

  const counts: Record<WebhookOutcome, number> = {
    received: 0,
    processed: 0,
    ignored: 0,
    failed: 0,
  }

  for (const answer of answers) {
    counts[answer.status] = answer.count
  }

  return counts
}

// ---------------------------------------------------------------------------
// Refunds and disputes
// ---------------------------------------------------------------------------

export interface OpenRefund {
  requestId: string
  status: string
  amountKobo: number
}

export async function findOpenRefund(orderReference: string): Promise<OpenRefund | null> {
  const { data, error } = await getSupabaseAdminClient().rpc("find_open_refund", {
    p_order_reference: orderReference,
  })

  if (error) {
    throw rpcFailure("find_open_refund")
  }

  const row = firstObject(data)

  if (row === null) {
    return null
  }

  const requestId = readString(row, "request_id")
  const status = readString(row, "status")
  const amountKobo = readInteger(row, "amount_kobo")

  if (requestId === null || status === null || amountKobo === null) {
    throw rpcFailure("find_open_refund")
  }

  return { requestId, status, amountKobo }
}

export async function processRefund(input: {
  requestId: string
  providerReference: string | null
  amountKobo: number
}): Promise<{ status: "processed" | "already_processed"; orderId: string }> {
  const { data, error } = await getSupabaseAdminClient().rpc("process_refund", {
    p_request: input.requestId,
    p_provider_reference: input.providerReference,
    p_amount_kobo: input.amountKobo,
  })

  if (error) {
    throw rpcFailure("process_refund")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("process_refund")
  }

  const status = readString(row, "status")
  const orderId = readString(row, "order_id")

  if ((status !== "processed" && status !== "already_processed") || orderId === null) {
    throw rpcFailure("process_refund")
  }

  return { status, orderId }
}

export async function markRefundSubmitted(requestId: string, providerReference: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("mark_refund_submitted", {
    p_request: requestId,
    p_provider_reference: providerReference,
  })

  if (error) {
    throw rpcFailure("mark_refund_submitted")
  }
}

export async function markRefundFailed(requestId: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("mark_refund_failed", {
    p_request: requestId,
    p_reason: reason,
  })

  if (error) {
    throw rpcFailure("mark_refund_failed")
  }
}

export async function openDispute(reference: string, note: string): Promise<{ status: string }> {
  const { data, error } = await getSupabaseAdminClient().rpc("open_dispute", {
    p_reference: reference,
    p_note: note,
  })

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message.trim() : "open_dispute_failed")
  }

  const row = firstObject(data)

  return { status: row === null ? "disputed" : (readString(row, "status") ?? "disputed") }
}

/**
 * What Paystack decided, stored without moving anything.
 *
 * The provider's resolution is recorded and the dispute is flagged as needing a
 * person; the order, the entitlements and the ledger are untouched. Only
 * resolve_dispute moves money, and only a person may call it.
 */
export async function recordDisputeProviderOutcome(
  reference: string,
  resolution: string,
  note: string,
): Promise<{ status: string; needsDecision: boolean }> {
  const { data, error } = await getSupabaseAdminClient().rpc("record_dispute_provider_outcome", {
    p_reference: reference,
    p_resolution: resolution,
    p_note: note,
  })

  if (error) {
    throw new Error(
      typeof error.message === "string" ? error.message.trim() : "record_dispute_provider_outcome_failed",
    )
  }

  const row = firstObject(data)

  return {
    status: row === null ? "recorded" : (readString(row, "status") ?? "recorded"),
    needsDecision: row === null ? true : row.needs_decision === true,
  }
}

export async function resolveDispute(
  orderId: string,
  outcome: "won" | "lost",
): Promise<{ status: string }> {
  const { data, error } = await getSupabaseAdminClient().rpc("resolve_dispute", {
    p_order: orderId,
    p_outcome: outcome,
  })

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message.trim() : "resolve_dispute_failed")
  }

  const row = firstObject(data)

  return { status: row === null ? outcome : (readString(row, "status") ?? outcome) }
}

export interface RefundRequestRow {
  id: string
  status: string
  orderId: string
  providerReference: string | null
}

export async function readRefundRequest(requestId: string): Promise<RefundRequestRow | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("refund_requests")
    .select("id, status, order_id, provider_reference")
    .eq("id", requestId)
    .maybeSingle()

  if (error) {
    throw rpcFailure("read_refund_request")
  }

  if (data === null) {
    return null
  }

  const row = data as Record<string, unknown>

  const id = readString(row, "id")
  const status = readString(row, "status")
  const orderId = readString(row, "order_id")

  if (id === null || status === null || orderId === null) {
    throw rpcFailure("read_refund_request")
  }

  return { id, status, orderId, providerReference: readString(row, "provider_reference") }
}

// ---------------------------------------------------------------------------
// Refund requests
// ---------------------------------------------------------------------------

export async function requestRefund(input: {
  actorId: string
  orderId: string
  reason: string
}): Promise<{ requestId: string; autoApproved: boolean }> {
  const { data, error } = await getSupabaseAdminClient().rpc("request_refund", {
    p_actor: input.actorId,
    p_order: input.orderId,
    p_reason: input.reason,
  })

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message.trim() : "request_refund_failed")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("request_refund")
  }

  const requestId = readString(row, "request_id")
  const autoApproved = row.auto_approved

  if (requestId === null || typeof autoApproved !== "boolean") {
    throw rpcFailure("request_refund")
  }

  return { requestId, autoApproved }
}

/**
 * Ask for a refund as a guest: the caller is not signed in, so the database
 * proves ownership with the address the order was bought with. Same rules and
 * same answers as request_refund, which is why the result shape is identical.
 */
export async function requestRefundByEmail(input: {
  orderId: string
  email: string
  reason: string
}): Promise<{ requestId: string; autoApproved: boolean }> {
  const { data, error } = await getSupabaseAdminClient().rpc("request_refund_by_email", {
    p_order: input.orderId,
    p_email: input.email,
    p_reason: input.reason,
  })

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message.trim() : "request_refund_failed")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("request_refund_by_email")
  }

  const requestId = readString(row, "request_id")
  const autoApproved = row.auto_approved

  if (requestId === null || typeof autoApproved !== "boolean") {
    throw rpcFailure("request_refund_by_email")
  }

  return { requestId, autoApproved }
}

/** The address an order was bought with, for the guest refund proof. */
export async function readOrderBuyerEmail(orderId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("orders")
    .select("buyer_email")
    .eq("id", orderId)
    .maybeSingle()

  if (error) {
    throw rpcFailure("read_order_buyer_email")
  }

  if (data === null) {
    return null
  }

  const email = readString(data as Record<string, unknown>, "buyer_email")

  return email === null ? null : email.trim()
}

export async function decideRefund(input: {
  actorId: string
  requestId: string
  decision: "approve" | "reject"
  note: string | null
}): Promise<{ orderReference: string; amountKobo: number }> {
  const { data, error } = await getSupabaseAdminClient().rpc("decide_refund", {
    p_actor: input.actorId,
    p_request: input.requestId,
    p_decision: input.decision,
    p_note: input.note,
  })

  if (error) {
    throw new Error(typeof error.message === "string" ? error.message.trim() : "decide_refund_failed")
  }

  const row = firstObject(data)

  if (row === null) {
    throw rpcFailure("decide_refund")
  }

  const orderReference = readString(row, "order_reference")
  const amountKobo = readInteger(row, "amount_kobo")

  if (orderReference === null || amountKobo === null) {
    throw rpcFailure("decide_refund")
  }

  return { orderReference, amountKobo }
}

export interface OrderForRefund {
  reference: string
  totalKobo: number
  status: string
}

/** The order behind a refund request, read by id. Money comes from here. */
export async function readOrderForRefund(orderId: string): Promise<OrderForRefund | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("orders")
    .select("paystack_reference, total_kobo, status")
    .eq("id", orderId)
    .maybeSingle()

  if (error) {
    throw rpcFailure("read_order_for_refund")
  }

  if (data === null) {
    return null
  }

  const row = data as Record<string, unknown>

  const reference = readString(row, "paystack_reference")
  const totalKobo = readInteger(row, "total_kobo")
  const status = readString(row, "status")

  if (reference === null || totalKobo === null || status === null) {
    throw rpcFailure("read_order_for_refund")
  }

  return { reference, totalKobo, status }
}
