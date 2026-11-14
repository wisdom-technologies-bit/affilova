"use server"

import { headers } from "next/headers"

import { appUrl } from "@/lib/identity/app-urls"
import { isPasswordBreached } from "@/lib/identity/password"
import { safeNextPath } from "@/lib/identity/safe-next"
import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type ForgotPasswordInput,
  type SignInInput,
  type SignUpInput,
  type UpdatePasswordInput,
} from "@/lib/identity/schemas"
import { getAuthUser } from "@/lib/identity/session"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// Server actions for the Supabase auth flow.
//
// Two rules hold for every action here:
//   * it returns a plain object and never throws to the client, so a form always
//     has something to show;
//   * it never passes a raw Supabase message through, and never lets the caller
//     learn whether an email address already has an account.

const MESSAGES = {
  generic: "Something went wrong. Please try again.",
  captcha: "Verification failed. Please try again.",
  breached: "This password has appeared in a data breach. Choose a different one.",
  signUpSent: "Check your email to confirm your account",
  invalidCredentials: "Incorrect email or password.",
  emailNotConfirmed: "Confirm your email address first.",
  signedOutOfDate: "You need to sign in again to change your password.",
  rateLimited: "Too many attempts. Please wait a moment and try again.",
  weakPassword: "Choose a stronger password.",
  samePassword: "Choose a password you have not used before.",
  expiredLink: "That link has expired. Request a new one.",
  signUpClosed: "Sign-ups are closed right now.",
  invalidEmail: "Enter a valid email address.",
  // Our own limiter, as opposed to the Supabase messages above.
  throttled: "Too many attempts. Please wait a few minutes and try again.",
} as const

// Throttles, all keyed on a SHA-256 hash so no IP address and no email address
// is ever stored. A window is fixed and rolls over on its own.
const LIMITS = {
  signInIp: { limit: 10, windowSeconds: 10 * 60 },
  signInEmail: { limit: 5, windowSeconds: 10 * 60 },
  signUpIp: { limit: 5, windowSeconds: 60 * 60 },
  resetIp: { limit: 5, windowSeconds: 60 * 60 },
  resetEmail: { limit: 3, windowSeconds: 60 * 60 },
  updatePasswordUser: { limit: 10, windowSeconds: 60 * 60 },
} as const

// The caller's address. headers() is only readable inside a request, so a
// failure here falls back to the shared "unknown" bucket rather than throwing
// from an action that is expected to always answer.
async function callerIp(): Promise<string> {
  try {
    return clientIpFromHeaders(await headers())
  } catch {
    return "unknown"
  }
}

// True when this attempt must be refused. rateLimit never throws and is called
// with onError "allow", so a database problem lets the attempt through: being
// unable to count must not lock a person out of their own account.
async function isThrottled(
  parts: readonly string[],
  budget: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const result = await rateLimit({
    key: rateLimitKey(parts),
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
    onError: "allow",
  })

  return !result.allowed
}

function throttled(): { ok: false; error: string } {
  return { ok: false, error: MESSAGES.throttled }
}

export type SignUpResult = { ok: true; message: string } | { ok: false; error: string }

export type SignInResult = { ok: true; redirectTo: string } | { ok: false; error: string }

export type GoogleSignInResult = { ok: true; url: string } | { ok: false; error: string }

export type SignOutResult = { ok: true }

export type PasswordResetResult = { ok: true } | { ok: false; error: string }

export type UpdatePasswordResult = { ok: true } | { ok: false; error: string }

type SupabaseError = { code?: string } | null

// Short, safe messages. The raw Supabase text is never returned: it names
// internal reasons and, for signup, can reveal that an address is taken.
function messageForError(error: SupabaseError): string {
  switch (error?.code) {
    case "captcha_failed":
      return MESSAGES.captcha
    case "invalid_credentials":
      return MESSAGES.invalidCredentials
    case "email_not_confirmed":
      return MESSAGES.emailNotConfirmed
    case "weak_password":
      return MESSAGES.weakPassword
    case "same_password":
      return MESSAGES.samePassword
    case "otp_expired":
    case "otp_disabled":
      return MESSAGES.expiredLink
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return MESSAGES.rateLimited
    case "signup_disabled":
      return MESSAGES.signUpClosed
    case "email_address_invalid":
    case "email_address_not_authorized":
      return MESSAGES.invalidEmail
    default:
      return MESSAGES.generic
  }
}

function firstIssue(issues: readonly { message: string }[]): string {
  const issue = issues[0]

  return issue !== undefined && issue.message !== "" ? issue.message : MESSAGES.generic
}

export async function signUpAction(input: SignUpInput): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error.issues) }
  }

  const { email, password, firstName, lastName, captchaToken } = parsed.data

  if (await isThrottled(["sign-up", "ip", await callerIp()], LIMITS.signUpIp)) {
    return throttled()
  }

  try {
    // Checked before Supabase is called at all, so a breached password costs
    // nothing and never reaches the auth server.
    if (await isPasswordBreached(password)) {
      return { ok: false, error: MESSAGES.breached }
    }

    const supabase = await createSupabaseServerClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: appUrl("public", "/auth/confirm"),
        captchaToken,
      },
    })

    // An address that is already registered is answered either with a fake user
    // (no identities) or, when confirmations are off, with an explicit error.
    // Both are answered with exactly the same body as a new signup.
    if (
      error &&
      error.code !== "email_exists" &&
      error.code !== "user_already_exists"
    ) {
      return { ok: false, error: messageForError(error) }
    }

    return { ok: true, message: MESSAGES.signUpSent }
  } catch {
    return { ok: false, error: MESSAGES.generic }
  }
}

export async function signInAction(
  input: SignInInput & { next?: string },
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error.issues) }
  }

  // Two budgets: a burst from one address, and repeated guesses at one account.
  const ip = await callerIp()
  const email = parsed.data.email.trim().toLowerCase()

  const [ipThrottled, emailThrottled] = await Promise.all([
    isThrottled(["sign-in", "ip", ip], LIMITS.signInIp),
    isThrottled(["sign-in", "email", email], LIMITS.signInEmail),
  ])

  if (ipThrottled || emailThrottled) {
    return throttled()
  }

  try {
    const supabase = await createSupabaseServerClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { captchaToken: parsed.data.captchaToken },
    })

    if (error) {
      if (error.code === "invalid_credentials") {
        return { ok: false, error: MESSAGES.invalidCredentials }
      }

      if (error.code === "email_not_confirmed") {
        return { ok: false, error: MESSAGES.emailNotConfirmed }
      }

      return { ok: false, error: messageForError(error) }
    }

    return { ok: true, redirectTo: safeNextPath(input.next) }
  } catch {
    return { ok: false, error: MESSAGES.generic }
  }
}

export async function signInWithGoogleAction(): Promise<GoogleSignInResult> {
  try {
    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: appUrl("public", "/auth/callback"),
        // The browser is sent to the returned URL by the caller.
        skipBrowserRedirect: true,
      },
    })

    if (error || typeof data.url !== "string" || data.url === "") {
      return { ok: false, error: messageForError(error) }
    }

    return { ok: true, url: data.url }
  } catch {
    return { ok: false, error: MESSAGES.generic }
  }
}

export async function signOutAction(): Promise<SignOutResult> {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch {
    // A failed sign-out call still ends with the client sending the user to the
    // login page; there is nothing useful to report.
  }

  return { ok: true }
}

export async function requestPasswordResetAction(
  input: ForgotPasswordInput,
): Promise<PasswordResetResult> {
  const parsed = forgotPasswordSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error.issues) }
  }

  const ip = await callerIp()
  const email = parsed.data.email.trim().toLowerCase()

  const [ipThrottled, emailThrottled] = await Promise.all([
    isThrottled(["request-password-reset", "ip", ip], LIMITS.resetIp),
    isThrottled(["request-password-reset", "email", email], LIMITS.resetEmail),
  ])

  if (ipThrottled || emailThrottled) {
    return throttled()
  }

  try {
    const supabase = await createSupabaseServerClient()

    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: appUrl("public", "/auth/confirm?next=/auth/reset-password"),
      captchaToken: parsed.data.captchaToken,
    })
  } catch {
    // Swallowed on purpose: a network problem must not be distinguishable from
    // an address that has no account.
  }

  return { ok: true }
}

export async function updatePasswordAction(
  input: UpdatePasswordInput,
): Promise<UpdatePasswordResult> {
  const parsed = updatePasswordSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error.issues) }
  }

  try {
    const user = await getAuthUser()

    if (!user) {
      return { ok: false, error: MESSAGES.signedOutOfDate }
    }

    // Keyed on the user, not the address: a signed-in person changing their
    // password has an identity to count against.
    if (await isThrottled(["update-password", "user", user.id], LIMITS.updatePasswordUser)) {
      return throttled()
    }

    if (await isPasswordBreached(parsed.data.password)) {
      return { ok: false, error: MESSAGES.breached }
    }

    const supabase = await createSupabaseServerClient()

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

    if (error) {
      return { ok: false, error: messageForError(error) }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: MESSAGES.generic }
  }
}
