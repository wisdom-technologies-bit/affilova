// The only place a database error from the account read models becomes words.
//
// Every function in 20261121000200_account_vendor_read_models.sql raises a short
// code as its MESSAGE. That code is looked up here; anything else answers the
// generic sentence, so no table name, constraint name or database detail ever
// reaches a browser.

export const ACCOUNT_GENERIC_ERROR = "Something went wrong. Please try again."

const MESSAGES: Readonly<Record<string, string>> = {
  not_authenticated: "Sign in to continue.",
  forbidden: "You do not have access to that.",
  not_found: "That order could not be found.",
  invalid_input: "Check the form and try again.",
  invalid_cursor: "That page of results is no longer available. Start again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  invalid_order: "That purchase could not be opened.",
}

/** The sentence for a code, or the generic one. Never the database's own text. */
export function accountErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message.trim() : String(error).trim()

  return MESSAGES[code] ?? ACCOUNT_GENERIC_ERROR
}
