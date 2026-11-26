// The password guidance line, as a pure function.
//
// It is deliberately shallow: length only, in words, and it never blocks a
// password the server would accept. The rule the server applies is "at least 10
// characters" (lib/identity/schemas.ts), so 10 characters is where the advice
// stops saying "Too short" and starts saying "Acceptable". Strength beyond
// length is the breached-password check's job, not this line's.
//
// The label is a word, not a bar and not a colour: a person who cannot tell green
// from amber still reads "Good", and the same line is read out by a screen
// reader.

/** The shortest password the server accepts. Kept beside the label that says so. */
export const MIN_PASSWORD_LENGTH = 10

/** A longer password is worth a second word, so the guidance is not always the same. */
export const GOOD_PASSWORD_LENGTH = 14

export type PasswordStrengthLabel = "Too short" | "Acceptable" | "Good"

export interface PasswordStrength {
  /** The word shown beside the guidance. Never rendered as colour alone. */
  label: PasswordStrengthLabel
  /** True once the length alone satisfies the server's rule. */
  meetsMinimum: boolean
}

export function passwordStrength(length: number): PasswordStrength {
  if (length < MIN_PASSWORD_LENGTH) {
    return { label: "Too short", meetsMinimum: false }
  }

  if (length < GOOD_PASSWORD_LENGTH) {
    return { label: "Acceptable", meetsMinimum: true }
  }

  return { label: "Good", meetsMinimum: true }
}

/** The line under a password field before anything is typed. */
export const PASSWORD_GUIDANCE = `At least ${MIN_PASSWORD_LENGTH} characters. A passphrase works well.`
