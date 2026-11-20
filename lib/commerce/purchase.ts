import type { StartCheckoutRequest } from "./actions"
import type { StartCheckoutResult } from "./checkout"

// What the purchase card does, without React.
//
// The card owns the fields and the widget; every decision about whether a
// submission may leave the browser lives here, so it can be tested without a
// DOM, and so the same rules apply however the card is wired.

export const EMAIL_REQUIRED = "Enter the email address we should send your download link to."
export const EMAIL_INVALID = "Enter a valid email address, for example name@example.com."
export const VERIFICATION_REQUIRED = "Complete the verification challenge before paying."
export const EMAIL_FIELD = "email"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface PurchaseInput {
  productId: string
  email: string
  name?: string
  turnstileToken: string
}

export interface PurchaseDeps {
  startCheckout: (input: StartCheckoutRequest) => Promise<StartCheckoutResult>
  /** Where to send the browser on success. window.location.assign in the card. */
  assign: (url: string) => void
}

export type PurchaseOutcome =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export type PurchaseValidation =
  | { ok: true; input: StartCheckoutRequest }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Check the form, and build the request the action takes. */
export function validatePurchase(input: PurchaseInput): PurchaseValidation {
  const email = typeof input.email === "string" ? input.email.trim() : ""

  if (email === "") {
    return { ok: false, error: EMAIL_REQUIRED, fieldErrors: { [EMAIL_FIELD]: EMAIL_REQUIRED } }
  }

  if (!EMAIL.test(email)) {
    return { ok: false, error: EMAIL_INVALID, fieldErrors: { [EMAIL_FIELD]: EMAIL_INVALID } }
  }

  const token = typeof input.turnstileToken === "string" ? input.turnstileToken.trim() : ""

  if (token === "") {
    return { ok: false, error: VERIFICATION_REQUIRED }
  }

  const productId = typeof input.productId === "string" ? input.productId.trim() : ""

  if (productId === "") {
    return { ok: false, error: "This product is not available for checkout." }
  }

  const name = typeof input.name === "string" ? input.name.trim() : ""

  return {
    ok: true,
    input: {
      productId,
      email,
      ...(name === "" ? {} : { name }),
      turnstileToken: token,
    },
  }
}

/**
 * Validate, start the checkout, then hand the browser to Paystack.
 *
 * A failed start returns the action's own sentence and field errors, so the
 * card shows exactly what the server decided. The redirect happens only after a
 * successful start: a browser that leaves on an error would lose the message.
 */
export async function submitPurchase(
  input: PurchaseInput,
  deps: PurchaseDeps,
): Promise<PurchaseOutcome> {
  const validated = validatePurchase(input)

  if (!validated.ok) {
    return validated
  }

  let result: StartCheckoutResult

  try {
    result = await deps.startCheckout(validated.input)
  } catch {
    return { ok: false, error: "We could not start the payment. Please try again." }
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      ...(result.fieldErrors === undefined ? {} : { fieldErrors: result.fieldErrors }),
    }
  }

  deps.assign(result.authorizationUrl)

  return { ok: true }
}
