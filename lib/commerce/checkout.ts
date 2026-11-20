import { randomInt } from "node:crypto"

import { z } from "zod"

import { commerceErrorCode, commerceErrorMessage, GENERIC_COMMERCE_ERROR } from "@/lib/commerce/errors"
import { logger } from "@/lib/logger"
import type { CheckoutChannel, InitializedTransaction } from "@/lib/paystack/client"
import { CHECKOUT_CHANNELS } from "@/lib/paystack/client"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

// Starting a checkout, with every dependency injected.
//
// The order of the steps is the point:
//   1. validate the form,
//   2. count the attempt against the IP and against the email,
//   3. redeem the Turnstile token on the server, failing closed,
//   4. create the pending order, which is where the price comes from,
//   5. ask Paystack for a checkout URL using THAT price,
//   6. remember the access code.
//
// Nothing here trusts a number that came from the browser: the amount sent to
// Paystack is the total_kobo create_order returned. If Paystack refuses, the
// order is failed rather than left pending, so a buyer who never reached the
// payment page is not holding a stale order for a day.

/** Ten checkouts from one address in ten minutes. */
export const CHECKOUT_IP_LIMIT = 10

/** Five checkouts for one email address in ten minutes. */
export const CHECKOUT_EMAIL_LIMIT = 5

export const CHECKOUT_WINDOW_SECONDS = 10 * 60

/** afv_ + 24 characters, which is inside the documented reference alphabet. */
const REFERENCE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
const REFERENCE_PREFIX = "afv_"
const REFERENCE_LENGTH = 24

const nameSchema = z
  .string()
  .trim()
  .max(100, "Keep the name to 100 characters or fewer.")

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.")

export const startCheckoutSchema = z.object({
  productId: z.string().trim().uuid("Choose a product."),
  email: emailSchema,
  name: nameSchema.optional(),
  turnstileToken: z.string().trim().min(1, "Complete the verification and try again."),
})

export type StartCheckoutInput = z.input<typeof startCheckoutSchema> & {
  /** The caller's address, already read from the proxy headers. */
  ip: string
}

/**
 * The click the browser remembered for this product.
 *
 * Only a click id: the affiliate is never sent by the browser, and is derived
 * from the click by the database.
 */
export interface Attribution {
  clickId: string
}

export interface CreateOrderCall {
  buyerUserId: string | null
  email: string
  name: string | null
  productId: string
  affiliateId: string | null
  clickId: string | null
  ipHash: string | null
  reference: string
}

export interface CreatedOrder {
  orderId: string
  number: string
  /** Integer kobo, as the database computed it. */
  totalKobo: number
  currency: string
  reference: string
}

export interface InitializeCall {
  email: string
  amountKobo: number
  reference: string
  currency: "NGN"
  callbackUrl: string
  channels: readonly CheckoutChannel[]
  metadata: Record<string, string>
}

export interface CheckoutDeps {
  rateLimit: typeof rateLimit
  verifyTurnstile: (token: string) => Promise<{ ok: boolean }>
  getBuyerUserId: () => Promise<string | null>
  /** The click remembered for this product, or null when there is none. */
  readAttribution: (productId: string) => Promise<Attribution | null>
  /**
   * The affiliate a click belongs to, decided by the database: null when the
   * click is unknown, for another product, too old, or its affiliate is no
   * longer allowed to promote.
   */
  getClickAttribution: (clickId: string, productId: string) => Promise<string | null>
  createOrder: (call: CreateOrderCall) => Promise<CreatedOrder>
  initializeTransaction: (call: InitializeCall) => Promise<InitializedTransaction>
  attachPaystackInit: (orderId: string, accessCode: string) => Promise<void>
  failOrder: (reference: string, reason: string) => Promise<void>
  callbackUrl: () => string
  /** Injected so a test can produce a predictable reference. */
  randomChar?: () => number
}

export type StartCheckoutResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** A reference Paystack will accept: afv_ and 24 lowercase alphanumerics. */
export function generateReference(randomChar: () => number = () => randomInt(0, REFERENCE_ALPHABET.length)): string {
  let suffix = ""

  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    suffix += REFERENCE_ALPHABET[randomChar() % REFERENCE_ALPHABET.length] ?? "0"
  }

  return `${REFERENCE_PREFIX}${suffix}`
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "form"

    if (errors[key] === undefined) {
      errors[key] = issue.message
    }
  }

  return errors
}

/** The reason recorded on a failed order: a code, never a payload. */
function failureReason(error: unknown): string {
  if (error instanceof Error && error.name === "PaystackError") {
    const code = (error as { code?: unknown }).code

    return typeof code === "string" ? `paystack_${code}` : "paystack_error"
  }

  return "paystack_error"
}

/**
 * Who, if anyone, is owed a commission on this order.
 *
 * The cookie can only name a click. The affiliate comes from
 * get_click_attribution, which checks the click's product, age and the
 * affiliate's current eligibility in the database. A failure at any point is
 * "no affiliate": attribution is never a reason a buyer cannot pay.
 */
async function resolveAttribution(
  productId: string,
  deps: CheckoutDeps,
): Promise<{ affiliateId: string | null; clickId: string | null }> {
  let attribution: Attribution | null

  try {
    attribution = await deps.readAttribution(productId)
  } catch {
    return { affiliateId: null, clickId: null }
  }

  if (attribution === null) {
    return { affiliateId: null, clickId: null }
  }

  try {
    const affiliateId = await deps.getClickAttribution(attribution.clickId, productId)

    return { affiliateId, clickId: attribution.clickId }
  } catch {
    return { affiliateId: null, clickId: attribution.clickId }
  }
}

export async function runStartCheckout(
  input: StartCheckoutInput,
  deps: CheckoutDeps,
): Promise<StartCheckoutResult> {
  // 1. The form.
  const parsed = startCheckoutSchema.safeParse({
    productId: input.productId,
    email: input.email,
    name: input.name,
    turnstileToken: input.turnstileToken,
  })

  if (!parsed.success) {
    return {
      ok: false,
      error: commerceErrorMessage("invalid_input"),
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const { productId, email, name, turnstileToken } = parsed.data

  // 2. The two limits. Both deny when the database cannot count: a checkout is
  //    an expensive, externally visible action.
  const ipLimit = await deps.rateLimit({
    key: rateLimitKey(["checkout", "ip", input.ip]),
    limit: CHECKOUT_IP_LIMIT,
    windowSeconds: CHECKOUT_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!ipLimit.allowed) {
    return { ok: false, error: commerceErrorMessage("rate_limited") }
  }

  const emailLimit = await deps.rateLimit({
    key: rateLimitKey(["checkout", "email", email]),
    limit: CHECKOUT_EMAIL_LIMIT,
    windowSeconds: CHECKOUT_WINDOW_SECONDS,
    onError: "deny",
  })

  if (!emailLimit.allowed) {
    return { ok: false, error: commerceErrorMessage("rate_limited") }
  }

  // 3. Turnstile, on the server, once.
  const captcha = await deps.verifyTurnstile(turnstileToken)

  if (!captcha.ok) {
    return { ok: false, error: commerceErrorMessage("captcha_failed") }
  }

  // 4. The order. The price is the database's answer, not the browser's.
  const buyerUserId = await deps.getBuyerUserId()
  const { affiliateId, clickId } = await resolveAttribution(productId, deps)
  const reference = generateReference(deps.randomChar)

  let order: CreatedOrder

  try {
    order = await deps.createOrder({
      buyerUserId,
      email,
      name: name === undefined || name === "" ? null : name,
      productId,
      affiliateId,
      clickId,
      // Opaque on purpose: the orders table holds a hash, never an address.
      ipHash: rateLimitKey(["order-ip", input.ip]),
      reference,
    })
  } catch (error) {
    const code = commerceErrorCode(error)

    logger.warn("checkout_order_failed", { code: code ?? "unknown" })

    if (code === "invalid_email") {
      return {
        ok: false,
        error: commerceErrorMessage(error),
        fieldErrors: { email: commerceErrorMessage(error) },
      }
    }

    return { ok: false, error: commerceErrorMessage(error) }
  }

  const amountKobo = order.totalKobo

  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    logger.error("checkout_amount_invalid", { order: order.orderId })

    await deps.failOrder(order.reference, "invalid_amount")

    return { ok: false, error: GENERIC_COMMERCE_ERROR }
  }

  // 5. Paystack, with the database's amount.
  let initialized: InitializedTransaction

  try {
    initialized = await deps.initializeTransaction({
      email,
      amountKobo,
      reference: order.reference,
      currency: "NGN",
      callbackUrl: deps.callbackUrl(),
      channels: CHECKOUT_CHANNELS,
      // Only the order identity: no name, no email, no free text.
      metadata: { order_id: order.orderId, order_number: order.number },
    })
  } catch (error) {
    const reason = failureReason(error)

    logger.error("checkout_initialize_failed", {
      order: order.orderId,
      reason,
      // An Error value is what lib/logger reports to Sentry.
      error,
    })

    try {
      await deps.failOrder(order.reference, reason)
    } catch {
      // The buyer still needs an answer; the failed order can be expired later.
      logger.error("checkout_fail_order_failed", { order: order.orderId })
    }

    return { ok: false, error: commerceErrorMessage("payments_unavailable") }
  }

  // 6. The access code is a record, not a requirement: a failure here must not
  //    stop a buyer who already has a working checkout URL.
  try {
    await deps.attachPaystackInit(order.orderId, initialized.accessCode)
  } catch {
    logger.warn("checkout_attach_init_failed", { order: order.orderId })
  }

  return { ok: true, authorizationUrl: initialized.authorizationUrl }
}
