import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { verifyCheckoutTurnstile } from "@/lib/security/turnstile-verify"
import { appUrl } from "@/lib/identity/app-urls"

import { createAccessToken } from "./access-token"
import type { SendEmailInput, SendEmailResult } from "@/lib/email/brevo"
import { purchaseReceiptEmail } from "@/lib/email/templates"

// "Send me a new link".
//
// The form answers the same sentence whether or not the address has ever bought
// anything: an answer that differs is a way to ask "does this person shop here?".
// Everything that could differ (no orders, a refused challenge, too many
// attempts, a failed send) is logged internally and answered neutrally.
//
// The limits are per address and per email, both fixed windows: 5 an hour from
// one connection, 3 an hour to one inbox. Neither is a security boundary on its
// own; together with the challenge they stop a script from using the form to
// post links to a stranger.

export const RESEND_NEUTRAL = "If that address has paid orders, we have emailed the links again."

/** Five an hour per address. */
export const RESEND_IP_LIMIT = 5

/** Three an hour per email address. */
export const RESEND_EMAIL_LIMIT = 3

export const RESEND_WINDOW_SECONDS = 60 * 60

/** How many of the buyer's most recent paid orders are included. */
export const RESEND_MAX_ORDERS = 5

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface PaidOrderRef {
  id: string
  number: string
  buyerEmail: string
  paidAt: string | null
  productTitle: string
  totalKobo: number
  refundWindowHours: number
}

export interface ResendDeps {
  verifyTurnstile: (token: string) => Promise<{ ok: boolean }>
  rateLimit: (options: {
    key: string
    limit: number
    windowSeconds: number
    onError?: "allow" | "deny"
  }) => Promise<{ allowed: boolean }>
  findPaidOrders: (email: string) => Promise<PaidOrderRef[]>
  createToken: (input: { orderId: string; email: string }) => string
  send: (input: SendEmailInput) => Promise<SendEmailResult>
  siteUrl: string
  contactUrl: string
  logInfo: (event: string, fields?: Record<string, unknown>) => void
}

export interface ResendInput {
  email: string
  turnstileToken: string
  ip: string
}

export interface ResendResult {
  ok: true
  message: string
}

function neutral(): ResendResult {
  return { ok: true, message: RESEND_NEUTRAL }
}

/**
 * Verify, limit, then email one link per recent paid order.
 *
 * Always answers the neutral sentence. The return type has no failure branch on
 * purpose: the caller has nothing to add.
 */
export async function resendAccessLinks(
  input: ResendInput,
  deps: ResendDeps,
): Promise<ResendResult> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : ""

  if (!EMAIL.test(email)) {
    return neutral()
  }

  const verified = await deps.verifyTurnstile(
    typeof input.turnstileToken === "string" ? input.turnstileToken : "",
  )

  if (!verified.ok) {
    deps.logInfo("resend_challenge_refused")

    return neutral()
  }

  const perIp = await deps.rateLimit({
    key: rateLimitKey(["access-resend", "ip", input.ip]),
    limit: RESEND_IP_LIMIT,
    windowSeconds: RESEND_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!perIp.allowed) {
    deps.logInfo("resend_rate_limited", { scope: "ip" })

    return neutral()
  }

  const perEmail = await deps.rateLimit({
    key: rateLimitKey(["access-resend", "email", email]),
    limit: RESEND_EMAIL_LIMIT,
    windowSeconds: RESEND_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!perEmail.allowed) {
    deps.logInfo("resend_rate_limited", { scope: "email" })

    return neutral()
  }

  let orders: PaidOrderRef[]

  try {
    orders = await deps.findPaidOrders(email)
  } catch {
    deps.logInfo("resend_lookup_failed")

    return neutral()
  }

  if (orders.length === 0) {
    deps.logInfo("resend_no_orders")

    return neutral()
  }

  const recent = orders.slice(0, RESEND_MAX_ORDERS)

  for (const order of recent) {
    const token = deps.createToken({ orderId: order.id, email: order.buyerEmail })
    const accessUrl = `${deps.siteUrl.replace(/\/+$/, "")}/access/${token}`

    const content = purchaseReceiptEmail({
      orderNumber: order.number,
      productTitle: order.productTitle,
      amountKobo: order.totalKobo,
      paidAt: order.paidAt ?? new Date().toISOString(),
      accessUrl,
      refundWindowHours: order.refundWindowHours,
      branding: { siteUrl: deps.siteUrl, contactUrl: deps.contactUrl },
    })

    const sent = await deps.send({
      ...content,
      to: order.buyerEmail,
      template: "access_link_resend",
    })

    if (!sent.ok) {
      deps.logInfo("resend_send_failed")
    }
  }

  return neutral()
}

/** The production dependencies: Turnstile, the limiter, the database, Brevo. */
export function defaultResendDeps(): ResendDeps {
  return {
    verifyTurnstile: (token) => verifyCheckoutTurnstile(token),
    rateLimit: (options) => rateLimit(options),
    findPaidOrders: async (email) => {
      const { data, error } = await getSupabaseAdminClient()
        .from("orders")
        .select(
          "id,number,buyer_email,paid_at,total_kobo,order_items(title_snapshot,refund_window_hours)",
        )
        .eq("buyer_email", email)
        .eq("status", "paid")
        .order("paid_at", { ascending: false })
        .limit(RESEND_MAX_ORDERS)

      if (error !== null || !Array.isArray(data)) {
        return []
      }

      return data.flatMap((row: unknown): PaidOrderRef[] => {
        if (typeof row !== "object" || row === null) {
          return []
        }

        const record = row as Record<string, unknown>
        const items: unknown = record.order_items
        const item = Array.isArray(items) && typeof items[0] === "object" ? items[0] : null
        const itemRecord = item === null ? null : (item as Record<string, unknown>)

        if (
          typeof record.id !== "string" ||
          typeof record.number !== "string" ||
          typeof record.buyer_email !== "string"
        ) {
          return []
        }

        return [
          {
            id: record.id,
            number: record.number,
            buyerEmail: record.buyer_email,
            paidAt: typeof record.paid_at === "string" ? record.paid_at : null,
            productTitle:
              typeof itemRecord?.title_snapshot === "string" ? itemRecord.title_snapshot : "your purchase",
            totalKobo: typeof record.total_kobo === "number" ? record.total_kobo : 0,
            refundWindowHours:
              typeof itemRecord?.refund_window_hours === "number" ? itemRecord.refund_window_hours : 0,
          },
        ]
      })
    },
    createToken: (input) => createAccessToken(input),
    send: async (input) => {
      const { sendEmail } = await import("@/lib/email/brevo")

      return sendEmail(input)
    },
    siteUrl: appUrl("public", "/"),
    contactUrl: appUrl("public", "/contact"),
    logInfo: (event, fields) => logger.info(event, fields),
  }
}

/** The caller's address, read the same way every other limiter reads it. */
export function resendClientIp(headers: Headers): string {
  return clientIpFromHeaders(headers)
}
