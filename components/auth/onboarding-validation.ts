import { isReservedHandle } from "@/lib/identity/reserved-handles"

// The inline checks the two onboarding forms run on blur.
//
// These are advice, not a gate: the server action still parses with the zod
// schemas in lib/identity/onboarding-schemas.ts, and that is what decides. The
// messages here are deliberately identical to the schema's, and
// onboarding-validation.test.ts asserts that by running the schema and comparing,
// so the two cannot drift apart without a failing test.
//
// The schemas are not imported here on purpose: they would put zod in the browser
// bundle of two pages to produce a sentence that this file can produce for
// nothing.

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/
const PHONE_PATTERN = /^[0-9+()\s-]*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const SLUG_MESSAGE =
  "Use 3 to 40 characters: lowercase letters, numbers or hyphens, starting and ending with a letter or number"
export const USERNAME_MESSAGE = "Use 3 to 30 characters: lowercase letters, numbers or underscores"
export const RESERVED_MESSAGE = "That one is reserved. Choose another"

export function vendorBusinessNameError(value: string): string | undefined {
  const trimmed = value.trim()

  // The schema reports the length rule for an empty value rather than a separate
  // "required" sentence, and this file says what the schema says.
  if (trimmed.length < 2) {
    return "Use at least 2 characters"
  }

  if (trimmed.length > 100) {
    return "Use at most 100 characters"
  }

  return undefined
}

export function vendorSlugError(value: string): string | undefined {
  const slug = value.trim().toLowerCase()

  if (!SLUG_PATTERN.test(slug)) {
    return SLUG_MESSAGE
  }

  if (isReservedHandle(slug)) {
    return RESERVED_MESSAGE
  }

  return undefined
}

export function vendorSupportEmailError(value: string): string | undefined {
  const email = value.trim()

  if (email === "") {
    return "Enter a support email address"
  }

  if (email.length > 254) {
    return "That email address is too long"
  }

  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address"
  }

  return undefined
}

export function vendorPhoneError(value: string): string | undefined {
  const phone = value.trim()

  if (phone === "") {
    return undefined
  }

  if (phone.length > 20) {
    return "Use at most 20 characters"
  }

  if (!PHONE_PATTERN.test(phone)) {
    return "Use digits, spaces, +, - or parentheses"
  }

  return undefined
}

export function affiliateUsernameError(value: string): string | undefined {
  const username = value.trim().toLowerCase()

  if (!USERNAME_PATTERN.test(username)) {
    return USERNAME_MESSAGE
  }

  if (isReservedHandle(username)) {
    return RESERVED_MESSAGE
  }

  return undefined
}

export function affiliateChannelsError(channels: readonly string[]): string | undefined {
  if (channels.length === 0) {
    return undefined
  }

  if (channels.length > 10) {
    return "Choose at most 10 channels"
  }

  if (new Set(channels).size !== channels.length) {
    return "Choose each channel once"
  }

  return undefined
}
