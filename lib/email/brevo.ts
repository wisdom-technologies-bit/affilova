import "server-only"

import { getServerEnv } from "@/lib/env"
import { logger } from "@/lib/logger"
import {
  emailFailureReason,
  isEmailFailureReason,
  isRetryableReason,
  readProviderCode,
  readProviderMessage,
  type EmailFailureRecord,
  type EmailSendFailureReason,
} from "@/lib/email/reasons"

// Brevo's transactional email API, called from the server only.
//
// What is never logged: the recipient's address, the subject and the body. A log
// line with a buyer's address in it is a leak that outlives the request, so the
// only things written are the template name and the provider's message id.
//
// Retries are deliberately narrow. A 5xx or a refused connection may succeed a
// moment later, so those are retried; a 4xx is our mistake (a bad key, a blocked
// sender, an invalid address) and retrying it only delays the failure.
//
// A failure is described by one reason from lib/email/reasons.ts, never by the
// provider's words. The body of a non-2xx answer is read inside a try/catch and
// only two things come out of it: a short machine code and, for the mapping
// alone, the message text. Neither is logged, stored or returned.

export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"

/** Ten seconds, as the brief requires. */
export const BREVO_TIMEOUT_MS = 10_000

/** One retry after the first attempt: three calls at most. */
export const BREVO_MAX_ATTEMPTS = 3

const RETRY_DELAY_MS = 500

export interface EmailSender {
  name: string
  email: string
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
  /** The template name, for the log line. Never the subject. */
  template: string
}

export interface BrevoDeps {
  apiKey: string
  from: EmailSender
  replyTo: EmailSender | null
  /** Injected so tests need no network. */
  fetch: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /**
   * Where the final failure is recorded. Injected so a test can watch it without
   * a database; the production path leaves it out and the admin-client recorder
   * in lib/email/failures.ts is used instead.
   */
  record?: (failure: EmailFailureRecord) => Promise<void>
  /**
   * Whether this address is on the suppression list. Injected so a test can
   * answer without a database; the production path leaves it out and
   * lib/email/suppression.ts is used instead.
   */
  isSuppressed?: (address: string) => Promise<boolean>
}

export type SendEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: EmailSendFailureReason }

/** One attempt's answer, with the status the reason came from. */
interface AttemptOutcome {
  result: SendEmailResult
  /** The provider's status, or null when the request never produced one. */
  status: number | null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** The provider's message id, when the answer carries one. */
function readMessageId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null
  }

  const value = (body as Record<string, unknown>).messageId

  return typeof value === "string" && value !== "" ? value : null
}

/**
 * The two things taken out of a refused answer: a short machine code and the
 * message text, which is used to pick a reason and then thrown away.
 *
 * A body that is not JSON, or that takes too long, reads as "unknown" and maps
 * on the status alone. Nothing from here is ever logged or stored.
 */
async function readFailureBody(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body: unknown = await response.json()

    return { code: readProviderCode(body), message: readProviderMessage(body) }
  } catch {
    return { code: "unknown", message: "" }
  }
}

async function attempt(deps: BrevoDeps, input: SendEmailInput): Promise<AttemptOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS)

  try {
    const response = await deps.fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": deps.apiKey,
      },
      body: JSON.stringify({
        sender: deps.from,
        ...(deps.replyTo === null ? {} : { replyTo: deps.replyTo }),
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
      }),
      signal: controller.signal,
      cache: "no-store",
    })

    if (!response.ok) {
      const { code, message } = await readFailureBody(response)
      const reason = emailFailureReason(response.status, message, code)
      const retryable = isRetryableReason(reason)

      logger.error("email_send_failed", {
        template: input.template,
        status: response.status,
        reason,
        retryable,
      })

      return { result: { ok: false, reason }, status: response.status }
    }

    let body: unknown = null

    try {
      body = await response.json()
    } catch {
      body = null
    }

    const messageId = readMessageId(body)

    logger.info("email_sent", {
      template: input.template,
      messageId: messageId ?? "none",
    })

    return { result: { ok: true, messageId }, status: response.status }
  } catch {
    // A timeout or a refused connection: worth another try, and there is no
    // status to record, so the row carries a zero.
    logger.error("email_send_failed", {
      template: input.template,
      status: 0,
      reason: "network",
      retryable: true,
    })

    return { result: { ok: false, reason: "network" }, status: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The production recorder.
 *
 * Imported lazily so that nothing which imports this module (a test, a job, the
 * health check) drags the Supabase admin client in with it.
 */
async function recordWithAdminClient(failure: EmailFailureRecord): Promise<void> {
  const { recordEmailFailure } = await import("@/lib/email/failures")

  await recordEmailFailure(failure)
}

/**
 * The production suppression check.
 *
 * Imported lazily for the same reason as the recorder: a test that calls
 * sendEmail with its own deps must not drag the Supabase admin client in.
 */
async function checkWithAdminClient(address: string): Promise<boolean> {
  const { isSuppressed } = await import("@/lib/email/suppression")

  return isSuppressed(address)
}

/** Injected deps that did not ask for a recorder get none: no database in tests. */
async function recordNowhere(): Promise<void> {
  // Deliberately empty.
}

/** One second, as the brief requires: diagnostics never hold up a send. */
export const FAILURE_RECORD_TIMEOUT_MS = 1_000

/**
 * Record one failure without ever failing or delaying the caller.
 *
 * The write is a nicety: a row in a diagnostics table. A database that is down,
 * a table that does not exist yet or a call that hangs must not turn a failed
 * email into a thrown error, and must not hold the request open. The race bounds
 * the wait at a second, and a rejection after that is swallowed on its own
 * promise rather than surfacing as an unhandled rejection.
 */
async function recordSafely(
  record: (failure: EmailFailureRecord) => Promise<void>,
  failure: EmailFailureRecord,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const pending = record(failure).catch(() => {})

    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FAILURE_RECORD_TIMEOUT_MS)
      }),
    ])
  } catch {
    // Nothing useful left to do: the send already failed for a better reason.
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Send one email, retrying only what a retry can fix.
 *
 * Never throws: the caller decides whether a failure should fail the job. The
 * job handlers treat a failure as retryable, which is why this returns a value.
 */
export async function sendEmail(input: SendEmailInput, deps?: BrevoDeps): Promise<SendEmailResult> {
  let resolved: BrevoDeps

  if (deps !== undefined) {
    resolved = deps
  } else {
    let apiKey: string
    let fromAddress: string
    let replyToAddress: string | undefined

    try {
      const env = getServerEnv()

      apiKey = env.BREVO_API_KEY ?? ""
      fromAddress = env.EMAIL_FROM ?? ""
      replyToAddress = env.EMAIL_REPLY_TO
    } catch {
      return { ok: false, reason: "not_configured" }
    }

    if (apiKey.trim() === "" || fromAddress.trim() === "") {
      logger.error("email_not_configured", { template: input.template })

      return { ok: false, reason: "not_configured" }
    }

    resolved = {
      apiKey,
      from: { name: "Affilova", email: fromAddress },
      replyTo:
        replyToAddress === undefined || replyToAddress.trim() === ""
          ? null
          : { name: "Affilova", email: replyToAddress },
      fetch: globalThis.fetch,
    }
  }

  const sleep = resolved.sleep ?? wait
  const record = resolved.record ?? (deps === undefined ? recordWithAdminClient : recordNowhere)
  const check = resolved.isSuppressed ?? (deps === undefined ? checkWithAdminClient : null)

  // The suppression list is asked before the first attempt, for every template.
  // A buyer whose message bounced last month is not written to again: repeating
  // it is what damages the domain, and a hard bounce is a fact about the mailbox
  // that a retry cannot change.
  //
  // This is not a provider failure, so nothing is recorded in the failures
  // table: the counts there are "Brevo refused us", and this is "we chose not
  // to ask".
  if (check !== null) {
    let suppressed = false

    try {
      suppressed = await check(input.to)
    } catch {
      // isSuppressed already fails open and logs; this is the belt for an
      // injected check that throws. Sending is the lesser harm.
      suppressed = false
    }

    if (suppressed) {
      logger.info("email_skipped_suppressed", { template: input.template })

      return { ok: false, reason: "suppressed" }
    }
  }

  let last: AttemptOutcome = { result: { ok: false, reason: "network" }, status: null }

  for (let attemptNumber = 1; attemptNumber <= BREVO_MAX_ATTEMPTS; attemptNumber += 1) {
    last = await attempt(resolved, input)

    if (last.result.ok || !isRetryableReason(last.result.reason)) {
      break
    }

    if (attemptNumber < BREVO_MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attemptNumber)
    }
  }

  // Only the final answer is recorded: a retry that worked is not a failure
  // worth a row, and three rows for one message would make the counts lie.
  if (!last.result.ok && isEmailFailureReason(last.result.reason)) {
    await recordSafely(record, {
      template: input.template,
      status: last.status,
      reason: last.result.reason,
    })
  }

  return last.result
}
