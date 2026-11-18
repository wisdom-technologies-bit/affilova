"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { getOrderByReference } from "@/lib/commerce/db"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"

// The status of one order, for the return page.
//
// What it deliberately does not return: the buyer's email, the name, the items,
// the amounts, the transaction id. Anyone holding a reference may ask, so the
// answer is one word and the order number.
//
// The reference is unguessable (afv_ and 24 random characters), and the limit
// keeps it that way: 60 asks a minute from one address.

/** Sixty asks a minute per address. */
const ORDER_STATUS_LIMIT = 60

const ORDER_STATUS_WINDOW_SECONDS = 60

export type OrderStatusValue = "pending" | "paid" | "failed" | "expired" | "refunded" | "unknown"

export interface OrderStatusResult {
  status: OrderStatusValue
  /** Present only when the order exists. */
  number?: string
}

const referenceSchema = z.object({
  reference: z.string().trim().min(1).max(64),
})

/**
 * The order statuses the checkout page can show.
 *
 * A disputed order reports "paid": the buyer paid, and the downloads are frozen
 * while the dispute is open. That is a different page, not a different state of
 * the payment.
 */
function mapStatus(value: string): OrderStatusValue {
  switch (value) {
    case "pending":
      return "pending"
    case "paid":
      return "paid"
    case "failed":
      return "failed"
    case "expired":
      return "expired"
    case "refunded":
      return "refunded"
    case "disputed":
      return "paid"
    default:
      return "unknown"
  }
}

export async function getOrderStatusAction(input: { reference: string }): Promise<OrderStatusResult> {
  const parsed = referenceSchema.safeParse({
    reference: typeof input?.reference === "string" ? input.reference : "",
  })

  if (!parsed.success) {
    return { status: "unknown" }
  }

  const requestHeaders = await headers()
  const ip = clientIpFromHeaders(requestHeaders)

  const limit = await rateLimit({
    key: rateLimitKey(["order-status", "ip", ip]),
    limit: ORDER_STATUS_LIMIT,
    windowSeconds: ORDER_STATUS_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!limit.allowed) {
    return { status: "unknown" }
  }

  try {
    const order = await getOrderByReference(parsed.data.reference)

    if (order === null) {
      return { status: "unknown" }
    }

    return { status: mapStatus(order.status), number: order.number }
  } catch {
    logger.error("order_status_failed", {})

    return { status: "unknown" }
  }
}
