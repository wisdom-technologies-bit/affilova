"use server"

import { z } from "zod"

import { sendEmail } from "@/lib/email/brevo"
import { emailFailureTone, type EmailSendFailureReason } from "@/lib/email/reasons"
import { stepUpCodeEmail } from "@/lib/email/templates"
import { catalogErrorCode, GENERIC_ERROR, catalogErrorMessage } from "@/lib/catalog/errors"
import { isLagosDay, lagosDayOf, addDays } from "@/lib/dates/lagos"
import { staffAal2Failure } from "@/lib/identity/mfa"
import { can } from "@/lib/identity/permissions"
import { appUrl } from "@/lib/identity/app-urls"
import { LEGAL } from "@/lib/site-config"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { enqueueJob } from "@/lib/jobs/queue"
import { logger } from "@/lib/logger"
import { PaystackError } from "@/lib/paystack/client"
import { getPaystackTransfers } from "@/lib/paystack/transfers"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import * as controls from "./controls-db"
import * as store from "./db"
import { PayoutRpcError } from "./db"
import { reasonText, requestOutcomeText } from "./format"
import { namesMatch } from "./name-match"
import { enqueueWithdrawalNotice } from "./notices"
import { getPayoutService } from "./run"
import {
  ADMIN_QUEUE_TABS,
  PAYOUT_SETTING_KEYS,
  type AdminQueuePage,
  type AdminQueueTab,
  type BankOption,
  type BlackoutDay,
  type PayoutScreenData,
  type PayoutSettingsSnapshot,
  type WithdrawalPreviewView,
} from "./screen-types"
import {
  STEP_UP_EXPIRY_SECONDS,
  generateCode,
  hashCode,
  isWellFormedCode,
  normaliseCode,
  type StepUpPurpose,
} from "./step-up"

// The server actions behind the payout screens.
//
// Every action: reads the signed-in user, loads their roles, validates its input
// with Zod, takes a rate limit, and only then touches anything. The user id sent
// to the database is always the authenticated one: no action accepts a user id
// from the browser. Every failure leaves as one short sentence. Account numbers,
// recipient codes and step-up codes are never returned and never logged; the
// only thing logged is a short event name and an error code.

// A "use server" module may only export async functions, so the types and the
// message tables stay local or live in screen-types.ts.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

const MESSAGES: Readonly<Record<string, string>> = {
  no_account: "Add a payout account first.",
  invalid_account: "That account could not be used. Check the bank and the account number.",
  invalid_status: "That withdrawal has already moved on, so this is no longer possible.",
  insufficient_balance: "That is more than your available balance.",
  owner_cannot_approve: "You cannot approve your own withdrawal.",
  already_approved_by_you: "You already approved this. A second, different approver is needed.",
  invalid_reason: "Give a reason of at least 10 characters.",
  setting_not_allowed: "That setting cannot be changed here.",
  invalid_value: "That value is not valid for this setting.",
  out_of_range: "That value is outside the range allowed for this setting.",
  invalid_combination: "That value conflicts with a related setting. Check the minimum, cap and approval limits.",
  invalid_day: "Choose a valid date.",
  invalid_tab: "Choose a tab from the list.",
  invalid_user: GENERIC_ERROR,
}

const NOT_SIGNED_IN = catalogErrorMessage("not_authenticated")
const FORBIDDEN = catalogErrorMessage("forbidden")
const RATE_LIMITED = catalogErrorMessage("rate_limited")
const INVALID_INPUT = catalogErrorMessage("invalid_input")

const BAD_CODE = "That code is not right or has expired. Ask for a new code."
const NAME_MISMATCH =
  "The name on this account does not match the name on your Affilova profile. Update your profile name or use an account in your own name."
const BANK_UNAVAILABLE = "We could not reach the bank check right now. Please try again in a moment."

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof PayoutRpcError) {
    const fixed = MESSAGES[error.code]

    if (fixed !== undefined) {
      return { ok: false, error: fixed }
    }

    // The preview reasons can also arrive as an error code from request_withdrawal.
    const reason = reasonText(error.code)

    if (!reason.startsWith("This withdrawal cannot")) {
      return { ok: false, error: reason }
    }

    return { ok: false, error: catalogErrorCode(error) === null ? GENERIC_ERROR : catalogErrorMessage(error) }
  }

  if (error instanceof PaystackError) {
    return { ok: false, error: BANK_UNAVAILABLE }
  }

  return { ok: false, error: GENERIC_ERROR }
}

function logFailure(event: string, error: unknown): void {
  logger.warn(event, {
    kind:
      error instanceof PayoutRpcError
        ? error.code
        : error instanceof PaystackError
          ? `paystack_${error.code}`
          : error instanceof Error
            ? error.name
            : "unknown",
  })
}

// ---------------------------------------------------------------------------
// Who is calling, and how often
// ---------------------------------------------------------------------------

type Member = { userId: string; email: string | null; roles: AppRole[] }

type Guard<T> = { ok: true; actor: T } | { ok: false; error: string }

/** An affiliate or a vendor: the two people who earn and withdraw. */
async function requireMember(): Promise<Guard<Member>> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "area:affiliate") && !can(roles, "area:merchant")) {
    return { ok: false, error: FORBIDDEN }
  }

  return { ok: true, actor: { userId: user.id, email: user.email, roles } }
}

type Admin = { userId: string; roles: AppRole[] }

async function requireAdmin(action: "payouts:approve" | "settings:write"): Promise<Guard<Admin>> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: FORBIDDEN }
  }

  // Money moves through these actions, so the second factor is required in the
  // action itself and not only on the screen that calls it.
  const mfa = await staffAal2Failure("/admin")

  if (mfa !== null) {
    return { ok: false, error: mfa }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

/** True when the caller may go on. Money actions fail closed if the limiter breaks. */
async function withinLimit(name: string, userId: string, limit: number, windowSeconds: number): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey(["payouts", name, userId]),
    limit,
    windowSeconds,
    onError: "deny",
  })

  return result.allowed
}

const HOUR = 60 * 60

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const bankCodeSchema = z.string().regex(/^[0-9]{3,6}$/)
const accountNumberSchema = z.string().regex(/^[0-9]{10}$/)
const codeSchema = z
  .string()
  .max(20)
  .transform(normaliseCode)
  .refine(isWellFormedCode)
const uuidSchema = z.string().uuid()

/** Kobo as a bigint, a safe integer or a string of digits; positive and bounded. */
const koboSchema = z
  .union([z.bigint(), z.number().int(), z.string().regex(/^[0-9]{1,12}$/)])
  .transform((value) => BigInt(value))
  .refine((value) => value > BigInt(0) && value <= BigInt(10_000_000) * BigInt(100))

const purposeSchema = z.enum(["bank_change", "withdrawal"])

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

export async function getPayoutScreenAction(): Promise<ActionResult<PayoutScreenData>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  if (!(await withinLimit("screen", guard.actor.userId, 240, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await controls.getPayoutScreenData(guard.actor.userId) }
  } catch (error) {
    logFailure("payout_screen_failed", error)

    return failure(error)
  }
}

export async function listBanksAction(): Promise<ActionResult<readonly BankOption[]>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  if (!(await withinLimit("banks", guard.actor.userId, 60, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const banks = await getPaystackTransfers().listBanks()

    return { ok: true, data: banks.map((bank) => ({ name: bank.name, code: bank.code })) }
  } catch (error) {
    logFailure("payout_banks_failed", error)

    return { ok: false, error: BANK_UNAVAILABLE }
  }
}

/** The name on the user's profile, for the name check. Null when none is set. */
async function profileName(userId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("profiles")
    .select("first_name, last_name, display_name")
    .eq("id", userId)
    .maybeSingle()

  if (error !== null || data === null || typeof data !== "object") {
    return null
  }

  const row = data as { first_name?: unknown; last_name?: unknown; display_name?: unknown }
  const full = [row.first_name, row.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ")

  if (full !== "") {
    return full
  }

  return typeof row.display_name === "string" && row.display_name.trim() !== "" ? row.display_name : null
}

export interface ResolvedAccountView {
  accountName: string
  accountLast4: string
  /** False when the bank's name does not match the profile name: saving will be refused. */
  nameMatches: boolean
}

/** Ask the bank whose account this is. The full number is never sent back. */
export async function resolveAccountAction(input: {
  bankCode: string
  accountNumber: string
}): Promise<ActionResult<ResolvedAccountView>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ bankCode: bankCodeSchema, accountNumber: accountNumberSchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Enter the 10 digit account number and choose a bank." }
  }

  if (!(await withinLimit("resolve", guard.actor.userId, 10, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const resolved = await getPaystackTransfers().resolveAccount({
      accountNumber: parsed.data.accountNumber,
      bankCode: parsed.data.bankCode,
    })
    const name = await profileName(guard.actor.userId)

    return {
      ok: true,
      data: {
        accountName: resolved.accountName,
        accountLast4: parsed.data.accountNumber.slice(-4),
        nameMatches: name !== null && namesMatch(name, resolved.accountName),
      },
    }
  } catch (error) {
    logFailure("payout_resolve_failed", error)

    if (error instanceof PaystackError && error.code === "bad_request") {
      return { ok: false, error: "The bank could not find that account. Check the number and the bank." }
    }

    return failure(error)
  }
}

/** Where to send someone when email cannot carry the message. */
function supportContact(): string {
  const email = LEGAL.supportEmail.trim()

  if (email !== "") {
    return email
  }

  const path = LEGAL.contactPath.trim() === "" ? "/contact" : LEGAL.contactPath.trim()

  return appUrl("public", path)
}

/**
 * What to tell someone whose step-up code could not be sent.
 *
 * Two sentences, chosen by whether waiting can help. A quota, a provider error
 * or a network failure clears on its own, so the answer is "try again in a few
 * minutes". A missing key, a refused sender, a blocked IP or a refused key is a
 * configuration problem a person cannot fix, so the answer names a way to reach
 * one instead of inviting a retry that will fail the same way.
 */
function stepUpEmailFailureText(reason: EmailSendFailureReason): string {
  if (emailFailureTone(reason) === "retry") {
    return "We could not send the code right now. Please try again in a few minutes."
  }

  return `Email is temporarily unavailable. Please contact support at ${supportContact()}.`
}

export async function requestStepUpCodeAction(input: {
  purpose: StepUpPurpose
}): Promise<ActionResult<{ expiresInMinutes: number }>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ purpose: purposeSchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  const { userId, email } = guard.actor

  if (email === null) {
    return { ok: false, error: "Your account has no email address, so we cannot send a code." }
  }

  try {
    const code = generateCode()
    const created = await controls.createStepUpCode({
      userId,
      purpose: parsed.data.purpose,
      codeHash: hashCode({ userId, purpose: parsed.data.purpose, code }),
      expiresInSeconds: STEP_UP_EXPIRY_SECONDS,
    })

    if (!created.ok) {
      return {
        ok: false,
        error:
          created.retryAfterSeconds > 0
            ? `Please wait ${created.retryAfterSeconds} seconds before asking for another code.`
            : "You have asked for too many codes. Try again later.",
      }
    }

    const content = stepUpCodeEmail({
      code,
      purpose: parsed.data.purpose,
      expiresInMinutes: STEP_UP_EXPIRY_SECONDS / 60,
      branding: { siteUrl: appUrl("public", "/"), contactUrl: appUrl("public", "/contact") },
    })
    const sent = await sendEmail({ ...content, to: email, template: "step_up_code" })

    if (!sent.ok) {
      // The reason, never the address and never Brevo's words.
      logger.warn("payout_step_up_email_failed", { reason: sent.reason })

      return { ok: false, error: stepUpEmailFailureText(sent.reason) }
    }

    return { ok: true, data: { expiresInMinutes: STEP_UP_EXPIRY_SECONDS / 60 } }
  } catch (error) {
    logFailure("payout_step_up_failed", error)

    return failure(error)
  }
}

/** True when the emailed code is right. The code is spent either way it is checked. */
async function codeIsValid(userId: string, purpose: StepUpPurpose, code: string): Promise<boolean> {
  return controls.verifyStepUpCode({ userId, purpose, codeHash: hashCode({ userId, purpose, code }) })
}

export async function savePayoutAccountAction(input: {
  bankCode: string
  accountNumber: string
  code: string
}): Promise<ActionResult<{ bankName: string; accountLast4: string; accountName: string }>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z
    .object({ bankCode: bankCodeSchema, accountNumber: accountNumberSchema, code: codeSchema })
    .safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  const { userId } = guard.actor

  if (!(await withinLimit("save-account", userId, 10, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    if (!(await codeIsValid(userId, "bank_change", parsed.data.code))) {
      return { ok: false, error: BAD_CODE }
    }

    // The bank's name comes from our own list, never from the browser.
    const banks = await getPaystackTransfers().listBanks()
    const bank = banks.find((entry) => entry.code === parsed.data.bankCode)

    if (bank === undefined) {
      return { ok: false, error: "Choose a bank from the list." }
    }

    const name = await profileName(userId)

    if (name === null) {
      return { ok: false, error: "Add your name to your Affilova profile first, then try again." }
    }

    const outcome = await getPayoutService().prepareAccount({
      userId,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      profileName: name,
    })

    if (outcome.status === "name_mismatch") {
      return { ok: false, error: NAME_MISMATCH }
    }

    return {
      ok: true,
      data: {
        bankName: bank.name,
        accountLast4: parsed.data.accountNumber.slice(-4),
        accountName: outcome.resolvedName,
      },
    }
  } catch (error) {
    logFailure("payout_save_account_failed", error)

    return failure(error)
  }
}

export async function previewWithdrawalAction(input: {
  amountKobo: bigint | number | string
}): Promise<ActionResult<WithdrawalPreviewView>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ amountKobo: koboSchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Enter an amount in naira, for example 5000 or 5,000.50." }
  }

  if (!(await withinLimit("preview", guard.actor.userId, 120, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const preview = await getPayoutService().previewWithdrawal(guard.actor.userId, parsed.data.amountKobo)

    return { ok: true, data: preview }
  } catch (error) {
    logFailure("payout_preview_failed", error)

    return failure(error)
  }
}

export async function requestWithdrawalAction(input: {
  amountKobo: bigint | number | string
  code: string
}): Promise<ActionResult<{ status: string; needsApproval: boolean; outcome: string }>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ amountKobo: koboSchema, code: codeSchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  const { userId } = guard.actor

  if (!(await withinLimit("withdraw", userId, 10, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const service = getPayoutService()

    // Check the rules before the code is used: a blocked request must not burn it.
    const preview = await service.previewWithdrawal(userId, parsed.data.amountKobo)

    if (!preview.allowed) {
      return { ok: false, error: reasonText(preview.reasons[0] ?? "") }
    }

    if (!(await codeIsValid(userId, "withdrawal", parsed.data.code))) {
      return { ok: false, error: BAD_CODE }
    }

    const requested = await service.requestManualWithdrawal({
      userId,
      amountKobo: parsed.data.amountKobo,
    })

    return {
      ok: true,
      data: {
        status: requested.status,
        needsApproval: requested.needsApproval,
        outcome: requestOutcomeText(requested.status, requested.needsApproval),
      },
    }
  } catch (error) {
    logFailure("payout_request_failed", error)

    return failure(error)
  }
}

export async function cancelWithdrawalAction(input: {
  withdrawalId: string
}): Promise<ActionResult<{ status: "cancelled" }>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ withdrawalId: uuidSchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  if (!(await withinLimit("cancel", guard.actor.userId, 30, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    // The database checks that the withdrawal is this user's and still requested.
    await controls.cancelWithdrawal(guard.actor.userId, parsed.data.withdrawalId)

    return { ok: true, data: { status: "cancelled" } }
  } catch (error) {
    logFailure("payout_cancel_failed", error)

    return failure(error)
  }
}

export async function setAutoPayoutAction(input: {
  enabled: boolean
}): Promise<ActionResult<{ enabled: boolean }>> {
  const guard = await requireMember()

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ enabled: z.boolean() }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  if (!(await withinLimit("auto", guard.actor.userId, 30, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    await store.setAutoPayout(guard.actor.userId, parsed.data.enabled)

    return { ok: true, data: { enabled: parsed.data.enabled } }
  } catch (error) {
    logFailure("payout_auto_failed", error)

    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function listWithdrawalsAction(input: {
  tab: string
  cursor?: { requestedAt: string; id: string } | null
}): Promise<ActionResult<AdminQueuePage>> {
  const guard = await requireAdmin("payouts:approve")

  if (!guard.ok) {
    return guard
  }

  const tabs = ADMIN_QUEUE_TABS.map((entry) => entry.value) as [string, ...string[]]
  const parsed = z
    .object({
      tab: z.enum(tabs),
      cursor: z.object({ requestedAt: z.string().max(40), id: uuidSchema }).nullish(),
    })
    .safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  if (!(await withinLimit("admin-list", guard.actor.userId, 600, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const page = await controls.adminWithdrawalQueue({
      actorId: guard.actor.userId,
      tab: parsed.data.tab as AdminQueueTab,
      limit: 25,
      cursor: parsed.data.cursor ?? null,
    })

    return { ok: true, data: page }
  } catch (error) {
    logFailure("payout_queue_failed", error)

    return failure(error)
  }
}

export async function approveWithdrawalAction(input: {
  withdrawalId: string
  note?: string | null
}): Promise<ActionResult<{ status: string; needsSecondApproval: boolean }>> {
  const guard = await requireAdmin("payouts:approve")

  if (!guard.ok) {
    return guard
  }

  const parsed = z
    .object({ withdrawalId: uuidSchema, note: z.string().trim().max(300).nullish() })
    .safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_INPUT }
  }

  if (!(await withinLimit("admin-decide", guard.actor.userId, 300, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    // The database refuses an approval of the person's own withdrawal.
    const result = await store.approveWithdrawal(
      guard.actor.userId,
      parsed.data.withdrawalId,
      parsed.data.note === undefined || parsed.data.note === "" ? null : (parsed.data.note ?? null),
    )

    return { ok: true, data: result }
  } catch (error) {
    logFailure("payout_approve_failed", error)

    return failure(error)
  }
}

export async function rejectWithdrawalAction(input: {
  withdrawalId: string
  reason: string
}): Promise<ActionResult<{ status: "rejected" }>> {
  const guard = await requireAdmin("payouts:approve")

  if (!guard.ok) {
    return guard
  }

  const parsed = z
    .object({ withdrawalId: uuidSchema, reason: z.string().trim().min(10).max(300) })
    .safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: MESSAGES.invalid_reason ?? INVALID_INPUT }
  }

  if (!(await withinLimit("admin-decide", guard.actor.userId, 300, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    await store.rejectWithdrawal(guard.actor.userId, parsed.data.withdrawalId, parsed.data.reason)

    // Tell the user. A queue failure is logged inside and does not undo the rejection.
    await enqueueWithdrawalNotice(
      enqueueJob,
      { withdrawalId: parsed.data.withdrawalId },
      "rejected",
      logger,
    )

    return { ok: true, data: { status: "rejected" } }
  } catch (error) {
    logFailure("payout_reject_failed", error)

    return failure(error)
  }
}

export async function listBlackoutDatesAction(): Promise<ActionResult<readonly BlackoutDay[]>> {
  const guard = await requireAdmin("settings:write")

  if (!guard.ok) {
    return guard
  }

  if (!(await withinLimit("admin-blackout-list", guard.actor.userId, 300, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    const today = lagosDayOf(new Date())

    return { ok: true, data: await controls.listBlackoutDates(today, addDays(today, 365)) }
  } catch (error) {
    logFailure("payout_blackout_list_failed", error)

    return failure(error)
  }
}

const daySchema = z.string().refine(isLagosDay)

export async function addBlackoutDateAction(input: {
  day: string
  reason: string
}): Promise<ActionResult<{ day: string }>> {
  const guard = await requireAdmin("settings:write")

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ day: daySchema, reason: z.string().trim().min(3).max(120) }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Choose a date and give a reason of 3 to 120 characters." }
  }

  if (!(await withinLimit("admin-blackout", guard.actor.userId, 60, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    await controls.addBlackoutDate(guard.actor.userId, parsed.data.day, parsed.data.reason)

    return { ok: true, data: { day: parsed.data.day } }
  } catch (error) {
    logFailure("payout_blackout_add_failed", error)

    return failure(error)
  }
}

export async function removeBlackoutDateAction(input: { day: string }): Promise<ActionResult<{ day: string }>> {
  const guard = await requireAdmin("settings:write")

  if (!guard.ok) {
    return guard
  }

  const parsed = z.object({ day: daySchema }).safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: MESSAGES.invalid_day ?? INVALID_INPUT }
  }

  if (!(await withinLimit("admin-blackout", guard.actor.userId, 60, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    await controls.removeBlackoutDate(guard.actor.userId, parsed.data.day)

    return { ok: true, data: { day: parsed.data.day } }
  } catch (error) {
    logFailure("payout_blackout_remove_failed", error)

    return failure(error)
  }
}

export async function getPayoutSettingsAction(): Promise<ActionResult<PayoutSettingsSnapshot>> {
  const guard = await requireAdmin("settings:write")

  if (!guard.ok) {
    return guard
  }

  if (!(await withinLimit("admin-settings-read", guard.actor.userId, 300, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    return { ok: true, data: await controls.readPayoutSettings() }
  } catch (error) {
    logFailure("payout_settings_read_failed", error)

    return failure(error)
  }
}

export async function updatePayoutSettingAction(input: {
  key: string
  value: boolean | number
}): Promise<ActionResult<{ key: string }>> {
  const guard = await requireAdmin("settings:write")

  if (!guard.ok) {
    return guard
  }

  const keys = PAYOUT_SETTING_KEYS as unknown as [string, ...string[]]
  const parsed = z
    .object({ key: z.enum(keys), value: z.union([z.boolean(), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]) })
    .safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: MESSAGES.setting_not_allowed ?? INVALID_INPUT }
  }

  if (!(await withinLimit("admin-settings", guard.actor.userId, 60, HOUR))) {
    return { ok: false, error: RATE_LIMITED }
  }

  try {
    // The database checks the type and range of every key and writes the history.
    await controls.updateSetting(guard.actor.userId, parsed.data.key, parsed.data.value)

    return { ok: true, data: { key: parsed.data.key } }
  } catch (error) {
    logFailure("payout_setting_update_failed", error)

    return failure(error)
  }
}
