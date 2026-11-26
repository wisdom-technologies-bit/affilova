// The vocabulary a failed send is described in.
//
// A Brevo error body is never stored and never logged: it names the sender
// address, sometimes the key and sometimes the IP, and none of that belongs in a
// log line or in a database row. What is kept is a short machine code, and from
// that code and the status one reason out of the fixed list below. Everything
// downstream (the log line, the failures table, the Security page, the message a
// person is shown) speaks this list and nothing else.
//
// Nothing in this file reads the environment, so it is safe to import from a
// test and from a client component.

/**
 * The five words the suppression list accepts, in the order the admin card shows
 * them. They mirror the check constraint in
 * supabase/migrations/20261127000100_email_suppressions.sql, and they live here
 * because this file has no imports: the Security card is a client component and
 * may not import lib/email/suppression.ts, which is server-only.
 */
export const EMAIL_SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "blocked",
  "invalid",
  "unsubscribed",
] as const

export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number]

export function isEmailSuppressionReason(value: unknown): value is EmailSuppressionReason {
  return (
    typeof value === "string" && (EMAIL_SUPPRESSION_REASONS as readonly string[]).includes(value)
  )
}

/** The reasons a send can fail, as they are stored and shown. */
export const EMAIL_FAILURE_REASONS = [
  "unauthorized",
  "ip_not_authorized",
  "invalid_sender",
  "invalid_request",
  "quota",
  "provider_error",
  "network",
  "not_configured",
  // Added with the suppression list: not a provider failure at all, so it is
  // never recorded in the failures table and never retried. It is in this list
  // because a caller that asks "did it send" deserves one vocabulary for "no".
  "suppressed",
] as const

export type EmailFailureReason = (typeof EMAIL_FAILURE_REASONS)[number]

/**
 * The reason a result carries.
 *
 * "rejected" and "unavailable" are the two words the sender used before this
 * list existed. The sender no longer returns them, but a caller or a test that
 * builds a failure by hand still compiles against them, so they stay in the type
 * and in the advice table.
 */
export type EmailSendFailureReason = EmailFailureReason | "rejected" | "unavailable"

/** One failed send, as it is recorded. */
export interface EmailFailureRecord {
  /** The template name, never the subject. */
  template: string
  /** The provider's status, or null when the request never got one. */
  status: number | null
  reason: EmailFailureReason
}

/** What a person reading the admin page should do about a reason. */
export const EMAIL_REASON_ADVICE: Readonly<Record<EmailSendFailureReason, string>> = {
  unauthorized:
    "Brevo refused the API key. Check BREVO_API_KEY: it must be an API key from SMTP & API, API keys, not an SMTP key.",
  ip_not_authorized:
    "Brevo may be blocking Vercel's changing IP addresses; check Security, Authorized IPs.",
  invalid_sender:
    "EMAIL_FROM uses a free mail domain, which Brevo does not accept as a sender; use an address on your own authenticated domain.",
  invalid_request:
    "Brevo rejected the request itself. Check that EMAIL_FROM is a plain address and that BREVO_API_KEY is the key for this account.",
  quota:
    "Brevo refused the message for a quota or rate reason. Check the plan's daily sending limit and the account's credit balance.",
  provider_error:
    "Brevo returned an error of its own. The send is retried, so this usually clears on its own; if it does not, check Brevo's status page.",
  network:
    "The request to Brevo never completed: the deployment could not reach api.brevo.com. Check the network and try again.",
  not_configured:
    "Email is not configured: BREVO_API_KEY or EMAIL_FROM is missing from the deployment.",
  suppressed:
    "This address is on the suppression list: an earlier message to it hard bounced, was blocked or was marked as spam. Nothing is sent to it until an admin removes it on the Security page.",
  rejected: "Brevo refused the message.",
  unavailable: "Brevo could not be reached.",
}

/**
 * Which of the two things a person is told.
 *
 * "support" means nothing they can do will help, so the message names a way to
 * reach a human. "retry" means the failure is temporary and trying again in a
 * few minutes is the right answer.
 */
export type EmailFailureTone = "support" | "retry"

export function emailFailureTone(reason: EmailSendFailureReason): EmailFailureTone {
  switch (reason) {
    case "quota":
    case "provider_error":
    case "network":
      return "retry"
    default:
      // unauthorized, ip_not_authorized, invalid_sender, invalid_request,
      // not_configured and the two legacy words are all configuration or
      // account problems: waiting will not fix them.
      return "support"
  }
}

// ---------------------------------------------------------------------------
// Reading the provider's answer
//
// The body is read inside a try/catch by the caller and handed over as unknown.
// Only two things are taken out of it: a short machine code and, for the mapping
// alone, the message text. Neither is stored or logged.
// ---------------------------------------------------------------------------

const UNKNOWN_CODE = "unknown"

/** Lower-case letters, digits and underscores, forty at most. */
const CODE_PATTERN = /^[a-z0-9_]{1,40}$/

/** Brevo's "code" field, or "unknown" when it is missing or unexpected. */
export function readProviderCode(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNKNOWN_CODE
  }

  const value = (body as Record<string, unknown>).code

  if (typeof value !== "string") {
    return UNKNOWN_CODE
  }

  const code = value.trim().toLowerCase()

  return CODE_PATTERN.test(code) ? code : UNKNOWN_CODE
}

/**
 * Brevo's "message" field, lower-cased, for the mapping only.
 *
 * The value is returned to the caller and used to pick a reason; it is never
 * written anywhere. An absent or non-string message reads as an empty string,
 * which maps on the status alone.
 */
export function readProviderMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return ""
  }

  const value = (body as Record<string, unknown>).message

  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

/** Mailboxes a sender may not use at Brevo, and a warning anywhere else. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "gmx.net",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "hotmail.co.uk",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "rocketmail.com",
  "tutanota.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yandex.com",
  "ymail.com",
  "zoho.com",
]

/** The domain part of an address, lower-cased, or "" when there is none. */
export function domainOf(address: string): string {
  const at = address.lastIndexOf("@")

  return at === -1 ? "" : address.slice(at + 1).trim().toLowerCase()
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.includes(domain.trim().toLowerCase())
}

/**
 * "ip", "ip address" or "ip_address" anywhere in the text.
 *
 * A plain \bip\b would miss the machine code, because an underscore is a word
 * character: "ip_not_authorized" has no word boundary after "ip".
 */
const IP_MENTION = /(?:^|[^a-z0-9])ip(?:[^a-z0-9]|$)|ip[ _-]?address/

/**
 * The words Brevo uses when it is refusing an address rather than a key.
 *
 * The separators are spelled out because the machine code joins its words with
 * underscores: "ip_not_authorized" has to match "not authorized".
 */
const BLOCKED =
  /(?:un|not[ _-]?)authori[sz]ed|(?:un|not[ _-]?)recogni[sz]ed|not[ _-]?allowed|not[ _-]?permitted|blocked|denied/

/**
 * A sender, a from address, or one of the free mail domains named outright.
 *
 * "sender" is not word-bounded: the machine code for it is "invalid_sender", and
 * an underscore is a word character, so \bsender\b would never match it.
 */
const SENDER_MENTION = /sender|from[ _-]?(?:address|email|mailbox)/

function mentionsBlockedIp(message: string, code: string): boolean {
  const haystack = `${message} ${code}`

  return IP_MENTION.test(haystack) && BLOCKED.test(haystack)
}

function mentionsSender(message: string, code: string): boolean {
  const haystack = `${message} ${code}`

  if (SENDER_MENTION.test(haystack)) {
    return true
  }

  return FREE_MAIL_DOMAINS.some((domain) => haystack.includes(domain))
}

/**
 * The reason a non-2xx answer maps to.
 *
 * The status decides; the code and the message only break the ties the status
 * leaves open, which are the two 401/403 answers Brevo gives (a bad key and a
 * blocked IP) and the two 400s (a bad sender and a malformed request).
 */
export function emailFailureReason(
  status: number,
  message: string,
  code: string,
): EmailFailureReason {
  if (status === 401 || status === 403) {
    return mentionsBlockedIp(message, code) ? "ip_not_authorized" : "unauthorized"
  }

  if (status === 400) {
    return mentionsSender(message, code) ? "invalid_sender" : "invalid_request"
  }

  if (status === 402 || status === 429) {
    return "quota"
  }

  if (status >= 500) {
    return "provider_error"
  }

  // A 4xx nobody documented, and anything else odd: the request was refused, so
  // it is ours to fix and retrying it would only repeat the refusal.
  return status >= 400 ? "invalid_request" : "provider_error"
}

/** True for the reasons a second attempt can fix. */
export function isRetryableReason(reason: EmailSendFailureReason): boolean {
  return reason === "provider_error" || reason === "network"
}

/** Whether a value is one of the reasons this list knows. */
export function isEmailFailureReason(value: unknown): value is EmailFailureReason {
  return typeof value === "string" && (EMAIL_FAILURE_REASONS as readonly string[]).includes(value)
}
