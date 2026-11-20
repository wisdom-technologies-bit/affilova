// The only place a database error from the affiliate functions becomes words.
//
// Every function in 20261118000200_affiliate_tracking.sql raises a short code as
// its MESSAGE. That code is looked up here; anything else answers the generic
// sentence, so no table name, constraint name or database detail ever reaches a
// browser.

export const AFFILIATE_GENERIC_ERROR = "Something went wrong. Please try again."

const MESSAGES: Readonly<Record<string, string>> = {
  not_authenticated: "Sign in to continue.",
  forbidden: "You do not have access to that.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  invalid_input: "Check the form and try again.",

  // Links
  not_allowed: "You cannot promote this product right now.",
  alias_taken: "That short name is already used by another link. Try another one.",
  label_taken: "You already have a link for this product with that name. Give this one a different name.",
  link_limit: "You have reached the number of links allowed for this product.",
  invalid_alias: "The short name must be 4 to 40 characters: lowercase letters, numbers and hyphens.",
  invalid_label: "The name must be 60 characters or fewer.",
  code_unavailable: "A link could not be created just now. Please try again.",
  not_found: "That link could not be found.",

  // Access
  blocked: "This product's vendor has blocked you from promoting it.",
  invalid_decision: "Choose approve, reject or block.",
  invalid_note: "Keep the note to 500 characters or fewer.",
  invite_invalid: "That invitation is not valid any more. Ask the vendor for a new one.",
  invalid_token: "That invitation link is not valid.",
  invalid_max_uses: "The number of uses must be between 1 and 1000.",
  invalid_expiry: "The invitation must last between 1 and 365 days.",

  // Tracking
  invalid_click: "The click could not be recorded.",
}

/** The sentence for a code, or the generic one. Never the database's own text. */
export function affiliateErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message.trim() : String(error).trim()

  return MESSAGES[code] ?? AFFILIATE_GENERIC_ERROR
}
