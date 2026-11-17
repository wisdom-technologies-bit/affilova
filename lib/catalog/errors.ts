// The only place a database or storage error becomes words a person can read.
//
// Every function in the migration raises a short code as its MESSAGE
// ('invalid_price', 'slug_taken', ...). That code is looked up here. Anything
// else, including a raw Postgres error and its detail, answers the generic
// sentence: no table name, no constraint name and no stack ever reaches a
// browser.

export const GENERIC_ERROR = "Something went wrong. Please try again."

const MESSAGES: Readonly<Record<string, string>> = {
  // Sign in and permissions
  not_authenticated: "Sign in to continue.",
  forbidden: "You do not have access to that.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",

  // Input
  invalid_input: "Check the form and try again.",
  invalid_fields: "Check the form and try again.",
  invalid_title: "The title must be between 3 and 120 characters.",
  invalid_slug: "The address must be 4 to 80 characters: lowercase letters, numbers and hyphens.",
  invalid_short_description: "The short description must be between 10 and 200 characters.",
  invalid_description: "The description is too long.",
  invalid_category: "Choose a category.",
  invalid_price: "Enter a price of at least ₦100 and at most ₦10,000,000.",
  invalid_compare_price: "The compare-at price must be higher than the price.",
  invalid_commission: "The commission is outside the range allowed right now.",
  invalid_approval: "Choose how affiliates join this product.",
  invalid_refund_window: "The refund window is outside the range allowed right now.",
  invalid_max_downloads: "The download limit must be between 1 and 100.",
  invalid_name: "That file name cannot be used.",
  invalid_content_type: "That file type cannot be used.",
  invalid_alt: "The image description must be 140 characters or fewer.",

  // Product state
  slug_taken: "That address is already used by another product.",
  not_found: "That product could not be found.",
  bad_state: "This product is not in a state where that is allowed.",
  not_ready: "Finish the product first: fill in the description and add a file and a cover image.",
  reason_required: "Give a reason of at least 10 characters.",
  self_review: "You cannot review your own product.",

  // Files
  file_limit: "A product can have at most 10 files.",
  size_limit: "That file would take the product over its size limit.",
  key_mismatch: "That upload does not belong to this product.",
  size_mismatch: "The uploaded file did not match the size that was reserved.",
  last_file: "A published product must keep at least one file.",
  upload_missing: "The upload did not arrive. Try uploading the file again.",
  storage_failed: "The file could not be uploaded. Try again.",

  // Images
  image_limit: "A product can have at most 6 images.",
  image_missing: "That image could not be found. Upload it again.",
  image_too_large: "The image must be 5 MB or smaller.",
  image_too_small: "The image must be at least 400 pixels wide and 400 pixels tall.",
  image_format: "Use a JPG, PNG or WebP image.",
  image_upload_failed: "The image could not be uploaded. Try again.",

  // Upload rules from lib/catalog/files.ts
  invalid_filename: "That file name cannot be used.",
  empty_file: "That file is empty.",
  too_large: "A file must be 2 GB or smaller.",
  not_allowed_type: "That file type is not allowed.",
  double_extension: "That file name is not allowed.",
}

/** Every code that has a message of its own. */
export const CATALOG_ERROR_CODES: readonly string[] = Object.keys(MESSAGES)

// Supabase answers with a plain object (PostgrestError), anything else with an
// Error, and a function can also raise an Error with just the code.
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
 * The known code an error carries, or null. A message that happens to contain a
 * known code among other text is not matched: the comparison is exact, so a
 * database message like 'new row violates check constraint "invalid_price"'
 * cannot be mistaken for the code itself.
 */
export function catalogErrorCode(error: unknown): string | null {
  const message = rawMessage(error)

  if (message === null) {
    return null
  }

  return Object.prototype.hasOwnProperty.call(MESSAGES, message) ? message : null
}

/** A short, safe sentence for an error. Never the raw database text. */
export function catalogErrorMessage(error: unknown): string {
  const code = catalogErrorCode(error)

  return code === null ? GENERIC_ERROR : MESSAGES[code]
}

/** The failure half of every action's return value. */
export function actionFailure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: catalogErrorMessage(error) }
}
