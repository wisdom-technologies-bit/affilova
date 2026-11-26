import "server-only"

import { parseEmailEnv, type EmailEnv, type EnvSource } from "@/lib/env"
import { domainOf, isFreeMailDomain } from "@/lib/email/reasons"

// What the deployment's email settings look like, as categories.
//
// Nothing here returns a value: not the key, not a prefix of the key, not the
// address. A page that shows "the key is an API key" is useful; a page that shows
// the key is a leak with a long tail. The caller gets booleans, one of four
// categories per field, and a list of sentences telling a person what to fix.
//
// The checks are the four things that actually stop Brevo from sending:
//   * the key must exist and must be an API key, not an SMTP key;
//   * the sender must exist and must be on a domain the account has
//     authenticated, which a free mailbox never is;
//   * a reply-to is optional, but without one a reply goes nowhere;
//   * the two signing secrets are needed for links and codes, not for sending.

export type ApiKeyKind = "api" | "smtp" | "unknown" | "missing"

export type FromDomainKind = "own" | "free_mail" | "invalid" | "missing"

export interface EmailConfigHealth {
  apiKeyPresent: boolean
  /** "api" for xkeysib-, "smtp" for xsmtpsib-, "unknown" for anything else. */
  apiKeyKind: ApiKeyKind
  fromPresent: boolean
  fromDomainKind: FromDomainKind
  replyToPresent: boolean
  /** Set, and long enough for getOrderAccessSecret to accept it. */
  orderAccessSecretPresent: boolean
  /** Set, and long enough for getStepUpSecret to accept it. */
  stepUpSecretPresent: boolean
  /** True when nothing on this list would stop a send. */
  ready: boolean
  /** One sentence per problem, in the order the checks run. Empty when ready. */
  problems: readonly string[]
}

/** The length getOrderAccessSecret and getStepUpSecret both require. */
const MIN_SECRET_LENGTH = 32

const API_KEY_PREFIX = "xkeysib-"
const SMTP_KEY_PREFIX = "xsmtpsib-"

function apiKeyKindOf(value: string | undefined): ApiKeyKind {
  if (value === undefined) {
    return "missing"
  }

  if (value.startsWith(API_KEY_PREFIX)) {
    return "api"
  }

  if (value.startsWith(SMTP_KEY_PREFIX)) {
    return "smtp"
  }

  return "unknown"
}

/** Whether an address is shaped like one, without trying to be an RFC. */
function looksLikeAddress(value: string): boolean {
  const at = value.indexOf("@")

  if (at <= 0 || at !== value.lastIndexOf("@") || at === value.length - 1) {
    return false
  }

  const domain = value.slice(at + 1)

  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(domain)
}

function fromDomainKindOf(value: string | undefined): FromDomainKind {
  if (value === undefined) {
    return "missing"
  }

  if (!looksLikeAddress(value)) {
    return "invalid"
  }

  return isFreeMailDomain(domainOf(value)) ? "free_mail" : "own"
}

function longEnough(value: string | undefined): boolean {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH
}

function adviceFor(health: Omit<EmailConfigHealth, "problems" | "ready">): string[] {
  const problems: string[] = []

  if (health.apiKeyKind === "missing") {
    problems.push(
      "BREVO_API_KEY is not set; create an API key under SMTP & API, API keys and add it to the deployment.",
    )
  }

  if (health.apiKeyKind === "smtp") {
    problems.push(
      "BREVO_API_KEY looks like an SMTP key; create an API key under SMTP & API, API keys.",
    )
  }

  if (health.apiKeyKind === "unknown") {
    problems.push(
      "BREVO_API_KEY does not look like a Brevo key; an API key starts with xkeysib-.",
    )
  }

  if (health.fromDomainKind === "missing") {
    problems.push(
      "EMAIL_FROM is not set; add an address on your own authenticated domain, for example no-reply@yourdomain.com.",
    )
  }

  if (health.fromDomainKind === "free_mail") {
    problems.push(
      "EMAIL_FROM uses a free mail domain, which Brevo does not accept as a sender; use an address on your own authenticated domain.",
    )
  }

  if (health.fromDomainKind === "invalid") {
    problems.push(
      "EMAIL_FROM is not a plain address; use something like no-reply@yourdomain.com, with no display name.",
    )
  }

  if (!health.replyToPresent) {
    problems.push(
      "EMAIL_REPLY_TO is not set; a buyer who replies to a transactional message will reach nobody.",
    )
  }

  if (!health.orderAccessSecretPresent) {
    problems.push(
      "ORDER_ACCESS_SECRET is not set, or is shorter than 32 characters; buyer download links cannot be signed without it.",
    )
  }

  if (!health.stepUpSecretPresent) {
    problems.push(
      "STEP_UP_SECRET is not set, or is shorter than 32 characters; payout step-up codes cannot be issued without it.",
    )
  }

  return problems
}

/**
 * The health of the email configuration.
 *
 * The environment is read through lib/env.ts like everywhere else. A test passes
 * the same shape getEmailEnv() returns, so no test has to touch process.env.
 */
export function getEmailConfigHealth(source: EnvSource = process.env): EmailConfigHealth {
  const env: EmailEnv = parseEmailEnv(source)

  const facts = {
    apiKeyPresent: env.BREVO_API_KEY !== undefined,
    apiKeyKind: apiKeyKindOf(env.BREVO_API_KEY),
    fromPresent: env.EMAIL_FROM !== undefined,
    fromDomainKind: fromDomainKindOf(env.EMAIL_FROM),
    replyToPresent: env.EMAIL_REPLY_TO !== undefined,
    orderAccessSecretPresent: longEnough(env.ORDER_ACCESS_SECRET),
    stepUpSecretPresent: longEnough(env.STEP_UP_SECRET),
  }

  const problems = adviceFor(facts)

  // A missing reply-to or a missing signing secret is worth saying, but neither
  // stops Brevo from accepting a message, so neither makes the card "not ready".
  const ready = facts.apiKeyKind === "api" && facts.fromDomainKind === "own"

  return { ...facts, ready, problems }
}
