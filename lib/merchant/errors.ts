// The only place a database error from the vendor read models becomes words.
//
// Every function in 20261121000200_account_vendor_read_models.sql raises a short
// code as its MESSAGE. That code is looked up here; anything else answers the
// generic sentence, so no table name, constraint name or database detail ever
// reaches a browser.

export const MERCHANT_GENERIC_ERROR = "Something went wrong. Please try again."

const MESSAGES: Readonly<Record<string, string>> = {
  not_authenticated: "Sign in to continue.",
  forbidden: "You do not have access to that.",
  not_found: "That could not be found.",
  invalid_input: "Check the form and try again.",
  invalid_range: "Choose a date range of 366 days or fewer, starting before it ends.",
  invalid_status: "Choose one of the available statuses.",
  invalid_cursor: "That page of results is no longer available. Start again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  note_required: "Give a reason of at least 10 characters.",
  bad_state: "This request has already been decided.",
  self_decision: "You cannot decide on your own order.",
}

/** The sentence for a code, or the generic one. Never the database's own text. */
export function merchantErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message.trim() : String(error).trim()

  return MESSAGES[code] ?? MERCHANT_GENERIC_ERROR
}
