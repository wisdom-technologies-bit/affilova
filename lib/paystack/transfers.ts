import "server-only"

import { z } from "zod"

import { getPaystackEnv, type PaystackMode } from "@/lib/env"
import { logger } from "@/lib/logger"

import { PAYSTACK_API_BASE, PAYSTACK_TIMEOUT_MS, PaystackError } from "./client"

// The transfer (payout) calls: banks, account resolution, recipients, balance,
// and the transfers themselves.
//
// The rules from lib/paystack/client.ts hold here too, and one is stricter:
//   * the secret key travels only in the Authorization header and is never
//     logged, returned or put in an error message;
//   * a response body is never logged. A transfer body quotes the recipient's
//     bank details, including the full account number, so it is never written
//     anywhere and never returned to a browser;
//   * every amount is an integer number of kobo, checked by the schema;
//   * initiateTransfer is NEVER retried. A retried transfer can pay twice. The
//     unique reference is the idempotency guard: Paystack accepts a reference
//     once, and a duplicate-reference answer is reported as already submitted.
//
// fetch is injected so the tests need no network and no key.

export const PAYSTACK_BANK_CACHE_MS = 6 * 60 * 60 * 1000

export interface Bank {
  name: string
  code: string
  slug: string | null
  active: boolean
}

export interface ResolvedAccount {
  accountName: string
  accountNumber: string
}

export interface CreatedRecipient {
  recipientCode: string
  name: string
}

export interface PaystackBalance {
  currency: string
  balanceKobo: number
}

export interface InitiatedTransfer {
  transferCode: string
  /** Paystack's numeric transfer id, when it reports one. */
  transferId: bigint | null
  reference: string
  /** pending, success, failed, reversed, otp, ... as Paystack reports it. */
  status: string
  amountKobo: number
  /** The transfer fee Paystack reports, in kobo, when it reports one. */
  feeKobo: number | null
  /**
   * True when Paystack answered that the reference already exists. The transfer
   * was accepted earlier, so the caller treats it as submitted and never sends
   * it again.
   */
  alreadySubmitted: boolean
}

export interface TransferRecord {
  transferCode: string
  reference: string
  status: string
  amountKobo: number
  feeKobo: number | null
}

export interface ResolveAccountInput {
  accountNumber: string
  bankCode: string
}

export interface CreateRecipientInput {
  name: string
  accountNumber: string
  bankCode: string
}

export interface InitiateTransferInput {
  /** Integer kobo. */
  amountKobo: number
  recipientCode: string
  reference: string
  reason: string
}

export interface PaystackTransfersOptions {
  secretKey: string
  fetch: typeof fetch
  baseUrl?: string
  timeoutMs?: number
  /** Injected so a test can move the bank cache clock. */
  now?: () => number
}

export interface PaystackTransfers {
  listBanks: () => Promise<readonly Bank[]>
  resolveAccount: (input: ResolveAccountInput) => Promise<ResolvedAccount>
  createRecipient: (input: CreateRecipientInput) => Promise<CreatedRecipient>
  getBalance: () => Promise<readonly PaystackBalance[]>
  initiateTransfer: (input: InitiateTransferInput) => Promise<InitiatedTransfer>
  getTransferByReference: (reference: string) => Promise<TransferRecord>
  mode: PaystackMode
}

function statusToError(status: number): PaystackError {
  if (status === 401 || status === 403) {
    return new PaystackError("unauthorized", "Paystack rejected the secret key.", {
      retryable: false,
      status,
    })
  }

  if (status === 404) {
    return new PaystackError("not_found", "Paystack does not know that transfer.", {
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
// ---------------------------------------------------------------------------

const bankSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  slug: z.string().nullish(),
  active: z.boolean().nullish(),
})

const bankListSchema = z.object({
  status: z.literal(true),
  data: z.array(bankSchema),
})

const resolveSchema = z.object({
  status: z.literal(true),
  data: z.object({
    account_name: z.string().min(1),
    account_number: z.string().min(1),
  }),
})

const recipientSchema = z.object({
  status: z.literal(true),
  data: z.object({
    recipient_code: z.string().min(1),
    name: z.string().nullish(),
  }),
})

const balanceSchema = z.object({
  status: z.literal(true),
  data: z.array(
    z.object({
      currency: z.string().min(1),
      balance: z.number().int().nonnegative(),
    }),
  ),
})

const transferSchema = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.number().int().nonnegative().nullish(),
    transfer_code: z.string().min(1),
    reference: z.string().min(1),
    status: z.string().min(1),
    amount: z.number().int().nonnegative(),
    fee_charged: z.number().int().nonnegative().nullish(),
  }),
})

const transferLookupSchema = z.object({
  status: z.literal(true),
  data: z.object({
    transfer_code: z.string().min(1),
    reference: z.string().min(1),
    status: z.string().min(1),
    amount: z.number().int().nonnegative(),
    fee_charged: z.number().int().nonnegative().nullish(),
  }),
})

/** Paystack's own wording for a reference it has already accepted. */
const DUPLICATE_REFERENCE = /duplicate|already (been )?(used|taken|exist)/i

export function createPaystackTransfers(options: PaystackTransfersOptions): PaystackTransfers {
  const baseUrl = options.baseUrl ?? PAYSTACK_API_BASE
  const timeoutMs = options.timeoutMs ?? PAYSTACK_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())

  let bankCache: { at: number; banks: readonly Bank[] } | null = null

  async function send(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<{ httpStatus: number; json: unknown; message: string | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await options.fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
        cache: "no-store",
      })

      const text = await response.text()

      let json: unknown = null

      try {
        json = JSON.parse(text) as unknown
      } catch {
        if (response.ok) {
          throw new PaystackError("invalid_response", "Paystack sent a body that is not JSON.", {
            retryable: false,
            status: response.status,
          })
        }
      }

      return { httpStatus: response.status, json, message: providerMessage(json) }
    } catch (error) {
      if (error instanceof PaystackError) {
        throw error
      }

      // DOMException is not always an Error, so the name is read from the value.
      if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") {
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
      // The issue paths and types only. Never the body: it holds bank details.
      logger.error("paystack_transfer_unexpected_response", {
        operation,
        issues: result.error.issues.length,
      })

      throw new PaystackError("invalid_response", "Paystack sent an unexpected response.", {
        retryable: false,
      })
    }

    return result.data
  }

  return {
    mode: getModeFromKey(options.secretKey),

    async listBanks() {
      if (bankCache !== null && now() - bankCache.at < PAYSTACK_BANK_CACHE_MS) {
        return bankCache.banks
      }

      const { httpStatus, json } = await send("/bank?country=nigeria&currency=NGN", { method: "GET" })

      if (httpStatus >= 400) {
        throw statusToError(httpStatus)
      }

      const parsed = parse(bankListSchema, json, "list_banks")

      const banks = parsed.data.map((bank) => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug ?? null,
        active: bank.active !== false,
      }))

      bankCache = { at: now(), banks }

      return banks
    },

    async resolveAccount(input) {
      const query = new URLSearchParams({
        account_number: input.accountNumber,
        bank_code: input.bankCode,
      })

      const { httpStatus, json } = await send(`/bank/resolve?${query.toString()}`, { method: "GET" })

      if (httpStatus >= 400) {
        throw statusToError(httpStatus)
      }

      const parsed = parse(resolveSchema, json, "resolve_account")

      return {
        accountName: parsed.data.account_name,
        accountNumber: parsed.data.account_number,
      }
    },

    async createRecipient(input) {
      const { httpStatus, json } = await send("/transferrecipient", {
        method: "POST",
        body: {
          type: "nuban",
          name: input.name,
          account_number: input.accountNumber,
          bank_code: input.bankCode,
          currency: "NGN",
        },
      })

      if (httpStatus >= 400) {
        throw statusToError(httpStatus)
      }

      const parsed = parse(recipientSchema, json, "create_recipient")

      return {
        recipientCode: parsed.data.recipient_code,
        name: parsed.data.name ?? input.name,
      }
    },

    async getBalance() {
      const { httpStatus, json } = await send("/balance", { method: "GET" })

      if (httpStatus >= 400) {
        throw statusToError(httpStatus)
      }

      const parsed = parse(balanceSchema, json, "get_balance")

      return parsed.data.map((entry) => ({
        currency: entry.currency,
        balanceKobo: entry.balance,
      }))
    },

    async initiateTransfer(input) {
      if (!Number.isInteger(input.amountKobo) || input.amountKobo <= 0) {
        throw new PaystackError("bad_request", "A transfer amount must be a positive integer.", {
          retryable: false,
        })
      }

      // Deliberately one attempt. A retry could pay twice; the reference is the
      // guard, and reconcileStuck() is what recovers an unknown outcome.
      const { httpStatus, json, message } = await send("/transfer", {
        method: "POST",
        body: {
          source: "balance",
          amount: input.amountKobo,
          recipient: input.recipientCode,
          reference: input.reference,
          reason: input.reason,
        },
      })

      if (httpStatus >= 400) {
        if (httpStatus === 400 && message !== null && DUPLICATE_REFERENCE.test(message)) {
          logger.warn("paystack_transfer_duplicate_reference", { reference: input.reference })

          return {
            transferCode: "",
            transferId: null,
            reference: input.reference,
            status: "pending",
            amountKobo: input.amountKobo,
            feeKobo: null,
            alreadySubmitted: true,
          }
        }

        throw statusToError(httpStatus)
      }

      const parsed = parse(transferSchema, json, "initiate_transfer")

      return {
        transferCode: parsed.data.transfer_code,
        transferId:
          typeof parsed.data.id === "number" && Number.isInteger(parsed.data.id)
            ? BigInt(parsed.data.id)
            : null,
        reference: parsed.data.reference,
        status: parsed.data.status,
        amountKobo: parsed.data.amount,
        feeKobo: parsed.data.fee_charged ?? null,
        alreadySubmitted: false,
      }
    },

    async getTransferByReference(reference) {
      const { httpStatus, json } = await send(
        `/transfer/verify/${encodeURIComponent(reference)}`,
        { method: "GET" },
      )

      if (httpStatus >= 400) {
        throw statusToError(httpStatus)
      }

      const parsed = parse(transferLookupSchema, json, "get_transfer")

      return {
        transferCode: parsed.data.transfer_code,
        reference: parsed.data.reference,
        status: parsed.data.status,
        amountKobo: parsed.data.amount,
        feeKobo: parsed.data.fee_charged ?? null,
      }
    },
  }
}

/** The provider's short message, used only to recognise a duplicate reference. */
function providerMessage(json: unknown): string | null {
  if (typeof json !== "object" || json === null) {
    return null
  }

  const message: unknown = (json as Record<string, unknown>).message

  // Truncated because it is only ever pattern-matched, never logged.
  return typeof message === "string" ? message.slice(0, 200) : null
}

function getModeFromKey(secretKey: string): PaystackMode {
  if (secretKey.startsWith("sk_test_")) {
    return "test"
  }

  if (secretKey.startsWith("sk_live_")) {
    return "live"
  }

  return "invalid"
}

/** Built on first use, so importing this module never reads a variable. */
export function getPaystackTransfers(): PaystackTransfers {
  const env = getPaystackEnv()

  return createPaystackTransfers({ secretKey: env.PAYSTACK_SECRET_KEY, fetch: globalThis.fetch })
}
