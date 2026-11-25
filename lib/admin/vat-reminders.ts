import "server-only"

import { createHash } from "node:crypto"

import { vatReminderEmail, type BrandingUrls } from "@/lib/email/templates"
import { logger } from "@/lib/logger"

import { vatReminderTargets } from "./db"
import type { VatReminderTarget } from "./screen-types"

// The daily VAT reminder.
//
// One email per finance or admin account, per month, per reminder kind, claimed
// in public.email_log before it is sent. The claim is what makes "once" a
// property of the database: a cron that fires twice, or a retry after a restart,
// finds the row and sends nothing.
//
// The email never carries buyer data. It says the month, the due date, the net
// payable and where to go, and nothing else.

export const VAT_REMINDER_KIND = "vat_reminder"

/** The sha256 of an address, the same hash the order emails use. Never the address. */
export function reminderRecipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

/** The email_log kind: the month, the reminder and the recipient, hashed. */
export function reminderKind(target: VatReminderTarget, recipientHash: string): string {
  return `${VAT_REMINDER_KIND}:${target.period}:${target.reminder}:${recipientHash}`
}

export interface ReminderRecipient {
  userId: string
  email: string
}

export interface VatReminderDeps {
  /** The service-role lookup. Answers null on a day with nothing to say. */
  targets: (today: string) => Promise<VatReminderTarget | null>
  /** Active accounts holding the finance or admin role. */
  recipients: () => Promise<readonly ReminderRecipient[]>
  /** Claims the send. True when this caller owns it, false when it is taken. */
  claim: (kind: string, period: string, recipientHash: string) => Promise<boolean>
  /** Records the provider's message id, or releases the claim on failure. */
  settle: (kind: string, recipientHash: string, result: { ok: true; messageId: string | null } | { ok: false }) => Promise<void>
  send: (input: { to: string; subject: string; html: string; text: string; template: string }) => Promise<{ ok: boolean; messageId?: string | null }>
  branding: BrandingUrls
  vatUrl: string
  /** Today in Lagos, as YYYY-MM-DD. */
  today: string
}

export interface VatReminderSummary {
  period: string | null
  reminder: string | null
  sent: number
  skipped: number
  failed: number
}

/** "September 2026" from "2026-09-01". */
export function periodLabel(period: string): string {
  const [year, month] = period.split("-")

  if (year === undefined || month === undefined) {
    return period
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1))

  if (Number.isNaN(date.getTime())) {
    return period
  }

  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date)
}

export async function runVatReminders(deps: VatReminderDeps): Promise<VatReminderSummary> {
  const target = await deps.targets(deps.today)

  if (target === null) {
    return { period: null, reminder: null, sent: 0, skipped: 0, failed: 0 }
  }

  const recipients = await deps.recipients()
  let sent = 0
  let skipped = 0
  let failed = 0

  const content = vatReminderEmail({
    periodLabel: periodLabel(target.period),
    dueDate: target.dueDate,
    netPayableKobo: target.netPayableKobo,
    reminder: target.reminder,
    vatUrl: deps.vatUrl,
    branding: deps.branding,
  })

  for (const recipient of recipients) {
    const hash = reminderRecipientHash(recipient.email)
    const kind = reminderKind(target, hash)

    let owned = false

    try {
      owned = await deps.claim(kind, target.period, hash)
    } catch (error) {
      logger.error("vat_reminder_claim_failed", { error })
      failed += 1
      continue
    }

    if (!owned) {
      skipped += 1
      continue
    }

    try {
      const result = await deps.send({
        to: recipient.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        template: VAT_REMINDER_KIND,
      })

      if (result.ok) {
        await deps.settle(kind, hash, { ok: true, messageId: result.messageId ?? null })
        sent += 1
      } else {
        await deps.settle(kind, hash, { ok: false })
        failed += 1
      }
    } catch (error) {
      logger.error("vat_reminder_send_failed", { error })
      await deps.settle(kind, hash, { ok: false })
      failed += 1
    }
  }

  return { period: target.period, reminder: target.reminder, sent, skipped, failed }
}
