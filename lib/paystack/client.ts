import "server-only"

import { z } from "zod"

import { getPaystackEnv, type PaystackMode } from "@/lib/env"
import { logger } from "@/lib/logger"

// The three Paystack calls this app makes, and nothing else.
//
// Rules that hold for every call here:
//   * the secret key travels only in the Authorization header, and it is never
//     logged, never returned and never put in an error message;
//   * a response body is never logged, not even a truncated one: it can quote a
//     customer email, a card BIN or a reference;
//   * every amount is an integer number of kobo, checked by the schema before it
//     is trusted;
//   * a response that does not match the documented shape is an error, not a
//     best guess. A missing field would otherwise become "0 kobo paid".
//
// fetch is injected so the tests need no network and no key.

export const PAYSTACK_API_BASE = "https://api.paystack.co"

/** Ten seconds, as the brief requires. Paystack answers in well under one. */
export const PAYSTACK_TIMEOUT_MS = 10_000

/** Backoff between verify attempts. Two retries, so three attempts at most. */
export const PAYSTACK_RETRY_DELAYS_MS: readonly number[] = [250, 750]

/**
 * The payment channels this app offers. The list is the documented set for
 * Initialize Transaction; the four used here are card, bank, ussd and
 * bank_transfer.
 */
export const CHECKOUT_CHANNELS = ["card", "bank", "ussd", "bank_transfer"] as const

export type CheckoutChannel = (typeof CHECKOUT_CHANNELS)[number]

export type PaystackErrorCode =
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "server_error"
  | "timeout"
  | "network"
  | "invalid_response"
  | "api_error"

/**
 * Every failure leaves this module as one of these.
 *
 * `retryable` answers one question only: could sending exactly the same request
 * again work? A 400 never becomes a 200 on a second try, and a 500 sometimes
 * does.
 */
export class PaystackError extends Error {
  readonly code: PaystackErrorCode
  readonly retryable: boolean
  /** The HTTP status, when there was one. Never the body. */
  readonly status: number | null

  constructor(
    code: PaystackErrorCode,
    message: string,
    options: { retryable: boolean; status?: number | null },
  ) {
    super(message)
    this.name = "PaystackError"
    this.code = code
    this.retryable = options.retryable
    this.status = options.status ?? null
  }
}

function statusToError(status: number): PaystackError {
  if (status === 401 || status === 403) {
    return new PaystackError("unauthorized", "Paystack rejected the secret key.", {
      retryable: false,
      status,
    })
  }

  if (status === 404) {
    return new PaystackError("not_found", "Paystack does not know that reference.", {
      retryable: false,
      status,
    })
  }

  if (status === 429) {
    return new PaystackError("rate_limited", "Paystack is rate limiting this integration.", {
      retryable: true,
      status,
    })
  }

  if (status >= 500) {
    return new PaystackError("server_error", "Paystack is unavailable right now.", {
      retryable: true,
      status,
    })
  }

  return new PaystackError("bad_request", "Paystack refused the request.", {
    retryable: false,
    status,
  })
}

// ---------------------------------------------------------------------------
// Response shapes
//
// Only the fields this app uses are declared. Extra keys are ignored: Paystack
// sends a large transaction object and will keep adding to it.
// ---------------------------------------------------------------------------

const initializeSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    access_code: z.string().min(1),
    reference: z.string().min(1),
  }),
})

const verifySchema = z.object({
  status: z.literal(true),
  data: z.object({
    // The documented type is an unsigned 64-bit integer. It is stored as a
    // bigint column, so it must arrive as a safe integer here.
    id: z.number().int().nonnegative(),
    status: z.string().min(1),
    reference: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().min(1),
    fees: z.number().int().nonnegative().nullish(),
    channel: z.string().nullish(),
    paid_at: z.string().nullish(),
    gateway_response: z.string().nullish(),
  }),
})

const refundSchema = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.number().int().nonnegative(),
    status: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().min(1),
    reference: z.string().nullish(),
    // Either the full transaction object or its id, depending on the endpoint.
    transaction: z.union([z.number().int(), z.object({ reference: z.string().nullish() }).passthrough()]).nullish(),
  }),
})

export interface InitializeTransactionInput {
  email: string
  /** Integer kobo, from the database. Never from the browser. */
  amountKobo: number
  reference: string
  currency: "NGN"
  callbackUrl: string
  channels: readonly CheckoutChannel[]
  /** Only the order identity: no buyer name, no email, no free text. */
  metadata: Record<string, string>
}

export interface InitializedTransaction {
  authorizationUrl: string
  accessCode: string
  reference: string
}

export interface VerifiedTransaction {
  /** Paystack's transaction id, an unsigned 64-bit integer. */
  id: number
  /** The transaction status: success, failed, abandoned, reversed, ... */
  status: string
  reference: string
  /** Integer kobo. */
  amountKobo: number
  currency: string
  /** Integer kobo; null when Paystack did not report a fee. */
  feesKobo: number | null
  channel: string | null
  paidAt: string | null
  gatewayResponse: string | null
}

export interface CreateRefundInput {
  /** The original transaction reference or its numeric id, as a string. */
  transaction: string
  /** Integer kobo. Omit for a full refund. */
  amountKobo?: number
  /**
   * Our own refund reference. Paystack accepts a given reference once, which is
   * what stops a retried job from refunding twice.
   */
  reference: string
  merchantNote?: string
}

export interface CreatedRefund {
  id: number
  status: string
  amountKobo: number
  currency: string
  reference: string | null
}

export interface PaystackClientOptions {
  secretKey: string
  /** Injected so tests need no network. */
  fetch: typeof fetch
  baseUrl?: string
  timeoutMs?: number
  retryDelaysMs?: readonly number[]
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>
}

export interface PaystackClient {
  initializeTransaction: (input: InitializeTransactionInput) => Promise<InitializedTransaction>
  verifyTransaction: (reference: string) => Promise<VerifiedTransaction>
  createRefund: (input: CreateRefundInput) => Promise<CreatedRefund>
  /** The derived mode, so a caller can log or display it. */
  mode: PaystackMode
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

function encodeReference(reference: string): string {
  return encodeURIComponent(reference)
}

export function createPaystackClient(options: PaystackClientOptions): PaystackClient {
  const baseUrl = options.baseUrl ?? PAYSTACK_API_BASE
  const timeoutMs = options.timeoutMs ?? PAYSTACK_TIMEOUT_MS
  const retryDelaysMs = options.retryDelaysMs ?? PAYSTACK_RETRY_DELAYS_MS
  const sleep = options.sleep ?? defaultSleep

  async function send(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await options.fetch(endpoint(baseUrl, path), {
        method: init.method,
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
        cache: "no-store",
      })

      if (!response.ok) {
        throw statusToError(response.status)
      }

      const text = await response.text()

      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new PaystackError("invalid_response", "Paystack sent a body that is not JSON.", {
          retryable: false,
          status: response.status,
        })
      }
    } catch (error) {
      if (error instanceof PaystackError) {
        throw error
      }

      // An abort is the timeout; anything else is a refused connection or DNS.
      // Neither message is kept: both can quote the URL, which carries nothing
      // secret here but is still not worth logging.
      if (error instanceof Error && error.name === "AbortError") {
        throw new PaystackError("timeout", "Paystack did not answer in time.", { retryable: true })
      }

      throw new PaystackError("network", "Paystack could not be reached.", { retryable: true })
    } finally {
      clearTimeout(timer)
    }
  }

  function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown, operation: string): z.infer<S> {
    const result = schema.safeParse(raw)

    if (!result.success) {
      logger.error("paystack_unexpected_response", {
        operation,
        issues: result.error.issues.length,
        // A ZodError is an Error, so lib/logger reports it to Sentry. Its
        // message names paths and types, and the logger masks any email in it.
        error: result.error,
      })

      throw new PaystackError("invalid_response", "Paystack sent an unexpected response.", {
        retryable: false,
      })
    }

    return result.data
  }

  return {
    mode: getModeFromKey(options.secretKey),

    async initializeTransaction(input) {
      const raw = await send("/transaction/initialize", {
        method: "POST",
        body: {
          email: input.email,
          // Paystack documents amount as a string in the subunit of the
          // currency. It is an integer here, so String() cannot lose a kobo.
          amount: String(input.amountKobo),
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          channels: [...input.channels],
          // Documented as a stringified JSON object.
          metadata: JSON.stringify(input.metadata),
        },
      })

      const parsed = parse(initializeSchema, raw, "initialize")

      return {
        authorizationUrl: parsed.data.authorization_url,
        accessCode: parsed.data.access_code,
        reference: parsed.data.reference,
      }
    },

    async verifyTransaction(reference) {
      // Only this call retries: it is a GET, so sending it again cannot charge
      // anyone or create anything twice.
      let attempt = 0

      for (;;) {
        try {
          const raw = await send(`/transaction/verify/${encodeReference(reference)}`, { method: "GET" })
          const parsed = parse(verifySchema, raw, "verify")

          return {
            id: parsed.data.id,
            status: parsed.data.status,
            reference: parsed.data.reference,
            amountKobo: parsed.data.amount,
            currency: parsed.data.currency,
            feesKobo: parsed.data.fees ?? null,
            channel: parsed.data.channel ?? null,
            paidAt: parsed.data.paid_at ?? null,
            gatewayResponse: parsed.data.gateway_response ?? null,
          }
        } catch (error) {
          const retryable = error instanceof PaystackError && error.retryable
          const delay = retryDelaysMs[attempt]

          if (!retryable || delay === undefined) {
            throw error
          }

          logger.warn("paystack_verify_retry", {
            attempt: attempt + 1,
            code: error instanceof PaystackError ? error.code : "unknown",
          })

          attempt += 1
          await sleep(delay)
        }
      }
    },

    async createRefund(input) {
      const raw = await send("/refund", {
        method: "POST",
        body: {
          transaction: input.transaction,
          ...(input.amountKobo === undefined ? {} : { amount: String(input.amountKobo) }),
          reference: input.reference,
          ...(input.merchantNote === undefined ? {} : { merchant_note: input.merchantNote }),
        },
      })

      const parsed = parse(refundSchema, raw, "refund")

      return {
        id: parsed.data.id,
        status: parsed.data.status,
        amountKobo: parsed.data.amount,
        currency: parsed.data.currency,
        reference: parsed.data.reference ?? null,
      }
    },
  }
}

// The mode is derived from the key prefix, and the client does not need the
// whole environment to know it.
function getModeFromKey(secretKey: string): PaystackMode {
  if (secretKey.startsWith("sk_test_")) {
    return "test"
  }

  if (secretKey.startsWith("sk_live_")) {
    return "live"
  }

  return "invalid"
}

/**
 * The configured client. Built on first use, so importing this module never
 * reads a variable and never fails a build.
 */
export function getPaystackClient(): PaystackClient {
  const env = getPaystackEnv()

  return createPaystackClient({ secretKey: env.PAYSTACK_SECRET_KEY, fetch: globalThis.fetch })
}

export async function initializeTransaction(
  input: InitializeTransactionInput,
): Promise<InitializedTransaction> {
  return getPaystackClient().initializeTransaction(input)
}

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  return getPaystackClient().verifyTransaction(reference)
}

export async function createRefund(input: CreateRefundInput): Promise<CreatedRefund> {
  return getPaystackClient().createRefund(input)
}
