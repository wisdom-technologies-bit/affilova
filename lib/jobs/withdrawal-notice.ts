import "server-only"

import { createHash } from "node:crypto"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import type { SendEmailInput, SendEmailResult } from "@/lib/email/brevo"
import {
  withdrawalNoticeEmail,
  type BrandingUrls,
} from "@/lib/email/templates"

import {
  WITHDRAWAL_NOTICE_JOB,
  isNoticeStatus,
  withdrawalNoticeDedupeKey,
} from "./withdrawal-notice-keys"
import type { JobPayload } from "./types"

// The withdrawal notice: one email when a withdrawal is paid, fails, is
// reversed or is rejected.
//
// The email is claimed in public.email_log (kind withdrawal_<status>, one row
// per withdrawal and recipient) before it is sent, so a retried job or a webhook
// delivered twice cannot send it twice. A send that fails gives the claim back
// and throws, so the queue retries. The email holds the amounts and the status:
// never an account number, which this module never reads.

export { WITHDRAWAL_NOTICE_JOB, isNoticeStatus, withdrawalNoticeDedupeKey }

export interface WithdrawalForNotice {
  id: string
  status: string
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  /** Only filled for a rejection. */
  reason: string | null
  email: string | null
}

export interface WithdrawalNoticeLog {
  claim: (kind: string, withdrawalId: string, hash: string) => Promise<boolean>
  markSent: (kind: string, withdrawalId: string, hash: string, messageId: string | null) => Promise<void>
  release: (kind: string, withdrawalId: string, hash: string) => Promise<void>
}

export interface WithdrawalNoticeDeps {
  /** By id or by Paystack reference: the webhook knows only the reference. */
  read: (key: { withdrawalId: string } | { reference: string }) => Promise<WithdrawalForNotice | null>
  send: (input: SendEmailInput) => Promise<SendEmailResult>
  log: WithdrawalNoticeLog
  branding: BrandingUrls
}

function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32)
}

function text(payload: JobPayload, key: string): string | null {
  const value = payload[key]

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

export async function runWithdrawalNoticeJob(payload: JobPayload, deps: WithdrawalNoticeDeps): Promise<void> {
  const status = text(payload, "status")
  const withdrawalId = text(payload, "withdrawal_id")
  const reference = text(payload, "reference")

  if (status === null || !isNoticeStatus(status) || (withdrawalId === null && reference === null)) {
    logger.warn("withdrawal_notice_bad_payload")

    return
  }

  const withdrawal = await deps.read(
    withdrawalId !== null ? { withdrawalId } : { reference: reference as string },
  )

  if (withdrawal === null) {
    logger.warn("withdrawal_notice_not_found")

    return
  }

  // The notice says what the database says now, not what the job remembers: a
  // job that outlived a status change sends nothing rather than something wrong.
  if (withdrawal.status !== status) {
    logger.warn("withdrawal_notice_status_changed", { expected: status, actual: withdrawal.status })

    return
  }

  if (withdrawal.email === null) {
    logger.warn("withdrawal_notice_no_email")

    return
  }

  const kind = `withdrawal_${status}`
  const hash = recipientHash(withdrawal.email)

  if (!(await deps.log.claim(kind, withdrawal.id, hash))) {
    logger.info("email_skipped_duplicate", { template: kind })

    return
  }

  const content = withdrawalNoticeEmail({
    status,
    grossKobo: withdrawal.grossKobo,
    feeKobo: withdrawal.feeKobo,
    netKobo: withdrawal.netKobo,
    reason: withdrawal.reason,
    branding: deps.branding,
  })

  const result = await deps.send({ ...content, to: withdrawal.email, template: kind })

  if (!result.ok) {
    await deps.log.release(kind, withdrawal.id, hash)

    throw new Error(`email_send_failed:${kind}`)
  }

  await deps.log.markSent(kind, withdrawal.id, hash, result.messageId)
}

// ---------------------------------------------------------------------------
// The real wiring
// ---------------------------------------------------------------------------

const EMAIL_LOG = "email_log"

export const withdrawalNoticeLog: WithdrawalNoticeLog = {
  async claim(kind, withdrawalId, hash) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .insert({ kind, withdrawal_id: withdrawalId, recipient_hash: hash, status: "pending" })

    if (error === null) {
      return true
    }

    if (error.code === "23505") {
      return false
    }

    throw new Error("email_log_claim_failed")
  },

  async markSent(kind, withdrawalId, hash, messageId) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .update({ status: "sent", provider_message_id: messageId })
      .eq("kind", kind)
      .eq("withdrawal_id", withdrawalId)
      .eq("recipient_hash", hash)

    if (error !== null) {
      throw new Error("email_log_update_failed")
    }
  },

  async release(kind, withdrawalId, hash) {
    const { error } = await getSupabaseAdminClient()
      .from(EMAIL_LOG)
      .delete()
      .eq("kind", kind)
      .eq("withdrawal_id", withdrawalId)
      .eq("recipient_hash", hash)

    if (error !== null) {
      throw new Error("email_log_release_failed")
    }
  },
}

function big(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === "string" && /^-?[0-9]{1,19}$/.test(value)) {
    return BigInt(value)
  }

  return null
}

/** Reads only amounts, status, the rejection reason and the owner's email. */
export async function readWithdrawalForNotice(
  key: { withdrawalId: string } | { reference: string },
): Promise<WithdrawalForNotice | null> {
  const supabase = getSupabaseAdminClient()
  const base = supabase
    .from("withdrawals")
    .select("id, user_id, status, gross_kobo, fee_kobo, net_kobo, note")

  const { data, error } = await ("withdrawalId" in key
    ? base.eq("id", key.withdrawalId)
    : base.eq("reference", key.reference)
  ).maybeSingle()

  if (error !== null) {
    throw new Error("withdrawal_notice_read_failed")
  }

  if (data === null || typeof data !== "object") {
    return null
  }

  const row = data as Record<string, unknown>
  const gross = big(row.gross_kobo)
  const fee = big(row.fee_kobo)
  const net = big(row.net_kobo)

  if (
    typeof row.id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.status !== "string" ||
    gross === null ||
    fee === null ||
    net === null
  ) {
    return null
  }

  const profile = await supabase.from("profiles").select("email").eq("id", row.user_id).maybeSingle()

  if (profile.error !== null) {
    throw new Error("withdrawal_notice_read_failed")
  }

  const email = (profile.data as { email?: unknown } | null)?.email

  return {
    id: row.id,
    status: row.status,
    grossKobo: gross,
    feeKobo: fee,
    netKobo: net,
    reason: row.status === "rejected" && typeof row.note === "string" ? row.note : null,
    email: typeof email === "string" && email.trim() !== "" ? email : null,
  }
}
