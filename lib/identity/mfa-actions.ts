"use server"

import { redirect } from "next/navigation"

import { logger } from "@/lib/logger"
import { safeNextPath } from "@/lib/identity/safe-next"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"
import { hasStaffRole } from "@/lib/identity/mfa"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// The two writes behind staff two-factor sign-in.
//
// Supabase owns the factor, the challenge and the verification; this module only
// sequences them and turns the answers into sentences a person can act on.
//
// Three rules hold throughout:
//
//   * the secret and the QR code are returned to the page and to nothing else.
//     They are never stored, never logged and never put in a URL;
//   * a failure is answered with one fixed sentence per case. A Supabase message
//     can name an internal detail, so it is logged at error level and never shown;
//   * the next path is passed through safeNextPath() before a redirect, so this
//     cannot become an open redirect.

const NOT_SIGNED_IN = "Sign in again to continue."
const NOT_STAFF = "Two-factor sign-in is only available to staff accounts."
const START_FAILED = "The setup could not be started. Please try again."
const CODE_FAILED = "That code did not work. Check the code in your authenticator app and try again."
const RATE_LIMITED = "Too many attempts. Wait ten minutes and try again."

/** Ten attempts per ten minutes, per account. */
const VERIFY_LIMIT = 10
const VERIFY_WINDOW_SECONDS = 600

const CODE = /^\d{6}$/

export type EnrollStart =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string }

type FactorRow = { id: string; status: string; factor_type: string }

function factorsOf(data: unknown): FactorRow[] {
  if (typeof data !== "object" || data === null) {
    return []
  }

  const all = (data as { all?: unknown }).all

  if (!Array.isArray(all)) {
    return []
  }

  const rows: FactorRow[] = []

  for (const entry of all) {
    if (typeof entry !== "object" || entry === null) {
      continue
    }

    const factor = entry as { id?: unknown; status?: unknown; factor_type?: unknown }

    if (typeof factor.id !== "string") {
      continue
    }

    rows.push({
      id: factor.id,
      status: typeof factor.status === "string" ? factor.status : "",
      factor_type: typeof factor.factor_type === "string" ? factor.factor_type : "",
    })
  }

  return rows
}

async function staffUser(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const roles = await getUserRoles(user.id)

  if (!hasStaffRole(roles)) {
    return { ok: false, error: NOT_STAFF }
  }

  return { ok: true, userId: user.id }
}

/**
 * Start (or restart) enrolment and answer with what the page must show.
 *
 * An earlier unfinished factor is removed first: Supabase only returns a QR code
 * at the moment a factor is created, so a half-finished attempt from another tab
 * would otherwise leave a screen with no code to scan.
 */
export async function beginEnrollment(): Promise<EnrollStart> {
  const staff = await staffUser()

  if (!staff.ok) {
    return { ok: false, error: staff.error }
  }

  const supabase = await createSupabaseServerClient()

  const listed = await supabase.auth.mfa.listFactors()

  for (const factor of factorsOf(listed.data)) {
    if (factor.status !== "verified") {
      const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id })

      if (removed.error !== null && removed.error !== undefined) {
        logger.error("mfa_unenroll_unverified_failed", { reason: "unexpected" })
      }
    }
  }

  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" })

  if (enrolled.error !== null && enrolled.error !== undefined) {
    logger.error("mfa_enroll_failed", { reason: "unexpected" })

    return { ok: false, error: START_FAILED }
  }

  const data = enrolled.data as { id?: unknown; totp?: { qr_code?: unknown; secret?: unknown } } | null

  const factorId = typeof data?.id === "string" ? data.id : ""
  const qrCode = typeof data?.totp?.qr_code === "string" ? data.totp.qr_code : ""
  const secret = typeof data?.totp?.secret === "string" ? data.totp.secret : ""

  if (factorId === "" || qrCode === "" || secret === "") {
    logger.error("mfa_enroll_shape", { reason: "missing qr or secret" })

    return { ok: false, error: START_FAILED }
  }

  // The QR code is an inline data URI from Supabase and the secret is shown for
  // manual entry. Neither is written anywhere.
  return { ok: true, factorId, qrCode, secret }
}

async function challengeAndVerify(factorId: string, code: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()

  const challenge = await supabase.auth.mfa.challenge({ factorId })

  if (challenge.error !== null && challenge.error !== undefined) {
    logger.error("mfa_challenge_failed", { reason: "unexpected" })

    return false
  }

  const challengeId = (challenge.data as { id?: unknown } | null)?.id

  if (typeof challengeId !== "string" || challengeId === "") {
    logger.error("mfa_challenge_shape", { reason: "missing id" })

    return false
  }

  const verified = await supabase.auth.mfa.verify({ factorId, challengeId, code })

  if (verified.error !== null && verified.error !== undefined) {
    return false
  }

  return true
}

/**
 * The first code, which turns the new factor into a verified one.
 *
 * A success redirects, which throws, so this never returns on the happy path.
 */
export async function submitEnrollmentCode(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const staff = await staffUser()

  if (!staff.ok) {
    return staff.error
  }

  const code = String(formData.get("code") ?? "").trim()
  const next = safeNextPath(String(formData.get("next") ?? "/admin"))

  if (!CODE.test(code)) {
    return "Enter the six digit code from your authenticator app."
  }

  const supabase = await createSupabaseServerClient()
  const listed = await supabase.auth.mfa.listFactors()
  const pending = factorsOf(listed.data).find((factor) => factor.status !== "verified")

  if (pending === undefined) {
    return "That setup has expired. Reload this page to start again."
  }

  if (!(await challengeAndVerify(pending.id, code))) {
    return CODE_FAILED
  }

  redirect(next)
}

/**
 * A code at sign-in time, against an already verified factor.
 *
 * Rate limited per account, because six digits is a small space and an
 * unthrottled endpoint is an invitation to walk it.
 */
export async function submitVerifyCode(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const staff = await staffUser()

  if (!staff.ok) {
    return staff.error
  }

  const allowed = await rateLimit({
    key: rateLimitKey(["two-factor-verify", staff.userId]),
    limit: VERIFY_LIMIT,
    windowSeconds: VERIFY_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!allowed.allowed) {
    return RATE_LIMITED
  }

  const code = String(formData.get("code") ?? "").trim()
  const next = safeNextPath(String(formData.get("next") ?? "/admin"))

  if (!CODE.test(code)) {
    return "Enter the six digit code from your authenticator app."
  }

  const supabase = await createSupabaseServerClient()
  const listed = await supabase.auth.mfa.listFactors()
  const verified = factorsOf(listed.data).find(
    (factor) => factor.status === "verified" && factor.factor_type === "totp",
  )

  if (verified === undefined) {
    return "This account has no authenticator set up yet. Reload the page to set one up."
  }

  if (!(await challengeAndVerify(verified.id, code))) {
    return CODE_FAILED
  }

  redirect(next)
}
