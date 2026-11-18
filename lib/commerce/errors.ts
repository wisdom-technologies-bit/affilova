// The words a checkout or refund failure is allowed to use.
//
// Every function in the SQL migrations raises a short code as its message
// ('product_unavailable', 'refund_exists', ...). That code is looked up here.
// Anything else, including a raw Postgres error and its detail, answers one
// generic sentence: no table name, no constraint name and no stack ever reaches
// a browser.

export const GENERIC_COMMERCE_ERROR = "Something went wrong. Please try again."

const MESSAGES: Readonly<Record<string, string>> = {
  // Input
  invalid_input: "Check the form and try again.",
  invalid_email: "Enter a valid email address.",
  invalid_name: "That name is too long.",
  invalid_reason: "Give a reason of at least 10 characters.",
  note_required: "Give a reason of at least 10 characters.",
  invalid_decision: "Choose approve or reject.",

  // Product and order state
  product_unavailable: "That product is not available right now.",
  guest_checkout_disabled: "Sign in to buy this product.",
  buyer_not_found: "Sign in again and retry.",
  duplicate_reference: "That checkout was already started. Reload the page and try again.",
  invalid_reference: "That checkout reference cannot be used.",
  not_found: "That order could not be found.",
  bad_state: "This order is not in a state where that is allowed.",
  not_refundable: "This order cannot be refunded.",

  // Refunds
  refund_exists: "A refund has already been requested for this order.",
  self_decision: "You cannot decide on your own order.",
  partial_refund_unsupported: "Only a full refund is supported.",
  forbidden: "You do not have access to that.",

  // Disputes
  dispute_exists: "A dispute is already open on this order.",
  no_open_dispute: "There is no open dispute on this order.",
  invalid_outcome: "That dispute outcome cannot be used.",

  // Checkout guards, raised by the action rather than the database
  not_authenticated: "Sign in to continue.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  captcha_failed: "Complete the verification and try again.",
  captcha_unavailable: "Verification is unavailable right now. Please try again in a moment.",
  payments_unavailable: "Payments are unavailable right now. Please try again in a moment.",
}

/** Every code that has a message of its own. */
export const COMMERCE_ERROR_CODES: readonly string[] = Object.keys(MESSAGES)

function rawMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error.trim()
  }

  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message

    if (typeof message === "string") {
      return message.trim()
    }
  }

  return null
}

/**
 * The known code an error carries, or null. The comparison is exact, so a
 * database message that merely mentions a code is not mistaken for it.
 */
export function commerceErrorCode(error: unknown): string | null {
  const message = rawMessage(error)

  if (message === null) {
    return null
  }

  return Object.prototype.hasOwnProperty.call(MESSAGES, message) ? message : null
}

/** A short, safe sentence for an error. Never the raw database text. */
export function commerceErrorMessage(error: unknown): string {
  const code = commerceErrorCode(error)

  return code === null ? GENERIC_COMMERCE_ERROR : MESSAGES[code]
}
