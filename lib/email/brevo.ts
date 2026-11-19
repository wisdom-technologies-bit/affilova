import "server-only"

import { getServerEnv } from "@/lib/env"
import { logger } from "@/lib/logger"

// Brevo's transactional email API, called from the server only.
//
// What is never logged: the recipient's address, the subject and the body. A log
// line with a buyer's address in it is a leak that outlives the request, so the
// only things written are the template name and the provider's message id.
//
// Retries are deliberately narrow. A 5xx or a refused connection may succeed a
// moment later, so those are retried; a 4xx is our mistake (a bad key, a blocked
// sender, an invalid address) and retrying it only delays the failure.

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
}

export type SendEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: "not_configured" | "rejected" | "unavailable" }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRetryable(status: number): boolean {
  return status >= 500
}

/** The provider's message id, when the answer carries one. */
function readMessageId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null
  }

  const value = (body as Record<string, unknown>).messageId

  return typeof value === "string" && value !== "" ? value : null
}

async function attempt(deps: BrevoDeps, input: SendEmailInput): Promise<SendEmailResult> {
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
      const retryable = isRetryable(response.status)

      logger.error("email_send_failed", {
        template: input.template,
        status: response.status,
        retryable,
      })

      return { ok: false, reason: retryable ? "unavailable" : "rejected" }
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

    return { ok: true, messageId }
  } catch {
    // A timeout or a refused connection: worth another try.
    logger.error("email_send_failed", { template: input.template, retryable: true })

    return { ok: false, reason: "unavailable" }
  } finally {
    clearTimeout(timer)
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
  let last: SendEmailResult = { ok: false, reason: "unavailable" }

  for (let attemptNumber = 1; attemptNumber <= BREVO_MAX_ATTEMPTS; attemptNumber += 1) {
    last = await attempt(resolved, input)

    if (last.ok || last.reason === "rejected" || last.reason === "not_configured") {
      return last
    }

    if (attemptNumber < BREVO_MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attemptNumber)
    }
  }

  return last
}
