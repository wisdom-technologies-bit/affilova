import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/identity/password-strength"

// The inline checks the auth forms run on blur.
//
// These are advice, not a gate. Nothing here decides whether the form submits:
// the server action still owns every rule, and a person who types a wrong value
// and presses the button gets the same answer they got before this file existed.
// What changes is that the message appears next to the field as soon as the field
// loses focus, in words that say how to fix it, instead of only after a round trip.
//
// Each message names the fix. "Enter an email address" tells a person what is
// missing; "Invalid email" does not.

export type FieldErrors = Record<string, string>

export function emailError(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed === "") {
    return "Enter your email address"
  }

  // One @, something before it, and a dot after it. Anything stricter than this
  // rejects addresses that are real, so the server keeps the final say.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Add the full address, like name@example.com"
  }

  return undefined
}

export function requiredNameError(value: string, which: "first" | "last"): string | undefined {
  if (value.trim() === "") {
    return which === "first" ? "Enter your first name" : "Enter your last name"
  }

  return undefined
}

export function signInPasswordError(value: string): string | undefined {
  if (value === "") {
    return "Enter your password"
  }

  return undefined
}

export function newPasswordError(value: string): string | undefined {
  if (value === "") {
    return "Choose a password"
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`
  }

  return undefined
}

/**
 * Runs the checks a form owns and returns only the messages that apply.
 * A field that is absent from the result is valid as far as this file can tell.
 */
export function collectErrors(
  checks: Record<string, (value: string) => string | undefined>,
  values: Record<string, string>,
): FieldErrors {
  const errors: FieldErrors = {}

  for (const [field, check] of Object.entries(checks)) {
    const message = check(values[field] ?? "")

    if (message !== undefined) {
      errors[field] = message
    }
  }

  return errors
}

/** Re-exported so a form can show the same word the guidance line shows. */
export { passwordStrength }
