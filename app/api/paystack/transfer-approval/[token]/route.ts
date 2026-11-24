import { timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { getPaystackEnv } from "@/lib/env"
import { logger } from "@/lib/logger"
import { getWithdrawalForApproval } from "@/lib/payouts/db"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { isPaystackSourceIp, sourceIpFromHeaders } from "@/lib/paystack/signature"

// POST /api/paystack/transfer-approval/[token]
//
// Paystack's "Transfer Approval" hook. When the setting is on, Paystack posts the
// transfer it is about to make and waits for an answer before sending it:
//
//   200  approve
//   400  decline
//
// The documented request body is the same body used to initiate the transfer:
// { source, amount, recipient, reference, reason }. Paystack documents NO
// signature header on this request, so the URL itself has to be the credential:
// the path carries a secret token that must equal PAYSTACK_TRANSFER_APPROVAL_TOKEN.
// A wrong or missing token answers 404 with an empty body, which tells a prober
// nothing about whether the route exists.
//
// Everything else is a reason to decline:
//   * the reference is not one of our withdrawals, or it is not in `processing`;
//   * the amount in kobo is not the net we recorded;
//   * the recipient code is not the user's active payout account.
// Declining is the safe answer: a transfer that is not approved is not sent.

export const dynamic = "force-dynamic"

/** Generous: one approval per transfer, and Paystack may retry a delivery. */
const APPROVAL_RATE_LIMIT = 240
const APPROVAL_RATE_WINDOW_SECONDS = 60

const bodySchema = z.object({
  reference: z.string().min(1).max(100),
  amount: z.number().int().positive(),
  recipient: z.string().min(1).max(120),
  source: z.string().optional(),
  reason: z.string().optional(),
  currency: z.string().optional(),
})

export interface TransferApprovalDeps {
  token: string
  enforceIps: boolean
  getWithdrawalForApproval: typeof getWithdrawalForApproval
  log: {
    info: (event: string, fields?: Record<string, unknown>) => void
    warn: (event: string, fields?: Record<string, unknown>) => void
    error: (event: string, fields?: Record<string, unknown>) => void
  }
}

type Decision = "approve" | "decline" | "not_found"

function empty(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } })
}

/** 200 with an empty JSON object approves; 400 with one declines. */
function decisionResponse(decision: Exclude<Decision, "not_found">): Response {
  return Response.json(
    {},
    {
      status: decision === "approve" ? 200 : 400,
      headers: { "Cache-Control": "no-store" },
    },
  )
}

/** Constant time, and a length difference is refused without comparing bytes. */
export function tokenMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8")
  const right = Buffer.from(expected, "utf8")

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

export async function handleTransferApproval(
  request: Request,
  token: string,
  deps: TransferApprovalDeps,
): Promise<Response> {
  if (deps.token === "" || !tokenMatches(token, deps.token)) {
    return empty(404)
  }

  if (request.method !== "POST") {
    return empty(405)
  }

  // The optional IP allowlist the webhook already uses.
  const sourceIp = sourceIpFromHeaders(request.headers)

  if (!isPaystackSourceIp(sourceIp)) {
    if (deps.enforceIps) {
      deps.log.warn("paystack_transfer_approval_ip_rejected", { source: sourceIp })

      return empty(401)
    }

    deps.log.warn("paystack_transfer_approval_ip_unexpected", { source: sourceIp })
  }

  const limit = await rateLimit({
    key: rateLimitKey(["paystack", "transfer-approval", clientIpFromHeaders(request.headers)]),
    limit: APPROVAL_RATE_LIMIT,
    windowSeconds: APPROVAL_RATE_WINDOW_SECONDS,
    // This route decides whether money leaves the account, so a limiter that
    // cannot count denies: an unavailable counter must not approve a transfer.
    onError: "deny",
  })

  if (!limit.allowed) {
    deps.log.warn("paystack_transfer_approval_rate_limited", {})

    return empty(429)
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    deps.log.warn("paystack_transfer_approval_unreadable", {})

    return decisionResponse("decline")
  }

  // A batch is never something this integration sends, and an array cannot be
  // matched to one withdrawal, so it is declined rather than guessed at.
  if (Array.isArray(body)) {
    deps.log.warn("paystack_transfer_approval_batch_declined", {})

    return decisionResponse("decline")
  }

  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    deps.log.warn("paystack_transfer_approval_malformed", {})

    return decisionResponse("decline")
  }

  const { reference, amount, recipient } = parsed.data

  let row: Awaited<ReturnType<typeof getWithdrawalForApproval>>

  try {
    row = await deps.getWithdrawalForApproval(reference)
  } catch {
    // Cannot check it, so cannot approve it. Paystack treats this as a decline
    // and the withdrawal stays processing for the reconciler.
    deps.log.error("paystack_transfer_approval_lookup_failed", { reference })

    return decisionResponse("decline")
  }

  const matches =
    row.found &&
    row.status === "processing" &&
    row.netKobo !== null &&
    row.netKobo === BigInt(amount) &&
    row.recipientCode !== null &&
    row.recipientCode === recipient

  if (!matches) {
    // The reference only: never the amount, the recipient code or the body.
    deps.log.error("paystack_transfer_approval_declined", { reference })

    return decisionResponse("decline")
  }

  deps.log.info("paystack_transfer_approval_approved", { reference })

  return decisionResponse("approve")
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  let token = ""

  try {
    const params = await context.params
    token = typeof params.token === "string" ? params.token : ""
  } catch {
    token = ""
  }

  let deps: TransferApprovalDeps

  try {
    const env = getPaystackEnv()

    deps = {
      token: env.PAYSTACK_TRANSFER_APPROVAL_TOKEN ?? "",
      enforceIps: env.enforceWebhookIps,
      getWithdrawalForApproval,
      log: logger,
    }
  } catch {
    // No key configured: the route exists but approves nothing.
    return empty(404)
  }

  return handleTransferApproval(request, token, deps)
}
