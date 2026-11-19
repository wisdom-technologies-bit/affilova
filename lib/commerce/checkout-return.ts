import type { OrderStatusValue } from "./order-status"

// The return page: which reference to look at, and what to say about it.
//
// Paystack sends the reference back as `reference`, and older links send
// `trxref`. Both are accepted, both are validated before anything is asked, and
// neither is echoed into the page: the answer is a sentence about a payment, not
// a summary of an order.

export const POLL_INTERVAL_MS = 3_000
export const POLL_TIMEOUT_MS = 30_000

/** The message the neutral states share. */
export const REFERENCE_MISSING =
  "We could not find a payment reference on this page. Open the link from your payment confirmation, or contact us through our contact page."

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/

export type QueryValue = string | string[] | undefined

function first(value: QueryValue): string | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : value.trim()
  }

  if (Array.isArray(value)) {
    const candidate = value.find((entry) => typeof entry === "string" && entry.trim() !== "")

    return candidate === undefined ? null : candidate.trim()
  }

  return null
}

/** The reference from `?reference=`, falling back to `?trxref=`. */
export function readCheckoutReference(params: Record<string, QueryValue>): string | null {
  return first(params.reference) ?? first(params.trxref)
}

/** True for a reference shaped like one Paystack or this app issues. */
export function isValidReference(value: string | null): value is string {
  return typeof value === "string" && REFERENCE.test(value)
}

export type CheckoutReturnState =
  | { kind: "missing_reference" }
  | { kind: "polling" }
  | { kind: "paid"; number: string | null }
  | { kind: "still_confirming" }
  | { kind: "failed" }
  | { kind: "expired" }
  | { kind: "refunded" }
  | { kind: "unknown" }

export type Tone = "positive" | "neutral" | "attention"

export interface CheckoutReturnMessage {
  heading: string
  body: string
  tone: Tone
  /** True when the buyer should be offered the product page again. */
  retry: boolean
  /** Shown only while the page is still asking. */
  busy: boolean
}

/** The state a status answer turns into, once the polling window has closed. */
export function stateFromStatus(status: OrderStatusValue, number?: string): CheckoutReturnState {
  switch (status) {
    case "paid":
      return { kind: "paid", number: typeof number === "string" && number !== "" ? number : null }
    case "failed":
      return { kind: "failed" }
    case "expired":
      return { kind: "expired" }
    case "refunded":
      return { kind: "refunded" }
    case "unknown":
      return { kind: "unknown" }
    default:
      return { kind: "still_confirming" }
  }
}

/** The words for each state. A status is never shown by colour alone. */
export function returnMessage(state: CheckoutReturnState): CheckoutReturnMessage {
  switch (state.kind) {
    case "missing_reference":
      return {
        heading: "We cannot check this payment",
        body: REFERENCE_MISSING,
        tone: "neutral",
        retry: false,
        busy: false,
      }
    case "polling":
      return {
        heading: "Checking your payment",
        body: "This usually takes a few seconds. Please keep this page open.",
        tone: "neutral",
        retry: false,
        busy: true,
      }
    case "paid":
      return {
        heading: "Payment received",
        body:
          state.number === null
            ? "We emailed your download link to the address you used."
            : `Order ${state.number}. We emailed your download link to the address you used.`,
        tone: "positive",
        retry: false,
        busy: false,
      }
    case "still_confirming":
      return {
        heading: "Still confirming your payment",
        body:
          "You will get an email as soon as it is confirmed. You can close this page.",
        tone: "neutral",
        retry: false,
        busy: false,
      }
    case "failed":
      return {
        heading: "The payment did not go through",
        body:
          "No money was taken. You can try again from the product page, or use a different payment method.",
        tone: "attention",
        retry: true,
        busy: false,
      }
    case "expired":
      return {
        heading: "This payment session expired",
        body:
          "No money was taken. Start a new payment from the product page when you are ready.",
        tone: "attention",
        retry: true,
        busy: false,
      }
    case "refunded":
      return {
        heading: "This order was refunded",
        body:
          "The money was returned to the account you paid with. If you expected to keep this purchase, contact us through our contact page.",
        tone: "neutral",
        retry: false,
        busy: false,
      }
    case "unknown":
      return {
        heading: "We cannot find that payment",
        body:
          "Check the link in your payment confirmation. If it still does not work, contact us through our contact page.",
        tone: "neutral",
        retry: false,
        busy: false,
      }
  }
}
