import "server-only"

import { sendEmail } from "@/lib/email/brevo"
import { appUrl } from "@/lib/identity/app-urls"
import { lagosDayOf } from "@/lib/dates/lagos"
import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { vatReminderTargets } from "./db"
import { dailyReconciliationDeps, runDailyReconciliation, type ReconciliationOutcome } from "./reconcile"
import { runVatReminders, type ReminderRecipient, type VatReminderSummary } from "./vat-reminders"

// The real dependencies for the two finance cron jobs.
//
// Kept out of the route so the route stays a list of jobs, and so the logic in
// reconcile.ts and vat-reminders.ts can be tested without a database or a mail
// provider.

/** Active accounts that hold finance or admin. Nobody else is reminded. */
export async function financeReminderRecipients(): Promise<readonly ReminderRecipient[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("user_roles")
    .select("user_id, role, status, profiles(email, status)")
    .in("role", ["admin", "finance"])
    .eq("status", "active")

  if (error !== null) {
    throw new Error("reminder_recipients_failed")
  }

  const seen = new Set<string>()
  const recipients: ReminderRecipient[] = []

  for (const row of (data ?? []) as unknown as {
    user_id: string
    profiles: { email: string | null; status: string } | { email: string | null; status: string }[] | null
  }[]) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    const email = profile?.email ?? null

    if (email === null || email.trim() === "" || profile?.status !== "active") {
      continue
    }

    if (seen.has(row.user_id)) {
      continue
    }

    seen.add(row.user_id)
    recipients.push({ userId: row.user_id, email })
  }

  return recipients
}

/** The claim, the settle and the release, against the real email_log. */
export async function emailLogReminderStore(): Promise<{
  claim: (kind: string, period: string, hash: string) => Promise<boolean>
  settle: (kind: string, hash: string, result: { ok: true; messageId: string | null } | { ok: false }) => Promise<void>
}> {
  const client = getSupabaseAdminClient()

  return {
    async claim(kind, period, hash) {
      const { error } = await client
        .from("email_log")
        .insert({ kind, vat_period: period, recipient_hash: hash, status: "pending" })

      if (error === null) {
        return true
      }

      if (error.code === "23505") {
        return false
      }

      throw new Error("email_log_claim_failed")
    },
    async settle(kind, hash, result) {
      if (result.ok) {
        const { error } = await client
          .from("email_log")
          .update({ status: "sent", provider_message_id: result.messageId })
          .eq("kind", kind)
          .eq("recipient_hash", hash)

        if (error !== null) {
          throw new Error("email_log_update_failed")
        }

        return
      }

      // A failed send releases the claim, so tomorrow's run tries again.
      const { error } = await client.from("email_log").delete().eq("kind", kind).eq("recipient_hash", hash)

      if (error !== null) {
        throw new Error("email_log_release_failed")
      }
    },
  }
}

function branding() {
  return {
    siteUrl: appUrl("public", "/"),
    contactUrl: appUrl("account", "/support"),
  }
}

/** The VAT screen lives on the admin host. */
function vatScreenUrl(): string {
  return appUrl("admin", "/vat")
}

export async function runVatReminderCron(now: Date): Promise<VatReminderSummary> {
  const store = await emailLogReminderStore()

  return runVatReminders({
    targets: vatReminderTargets,
    recipients: financeReminderRecipients,
    claim: store.claim,
    settle: store.settle,
    send: (input) =>
      sendEmail({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        template: input.template,
      }),
    branding: branding(),
    vatUrl: vatScreenUrl(),
    today: lagosDayOf(now),
  })
}

export async function runReconcileCron(): Promise<ReconciliationOutcome> {
  try {
    return await runDailyReconciliation(await dailyReconciliationDeps())
  } catch (error) {
    // The run itself could not be stored. That is a real failure and the cron
    // answers 500 so the scheduler tries again.
    logger.error("reconciliation_failed", { error })

    throw error
  }
}
