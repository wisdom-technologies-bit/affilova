// Pure helpers behind the sign-in experience: turning a redirect's error query
// parameter into a message, and checking a password confirmation.
//
// They live outside the components so they can be unit tested without a DOM.

export type AlertVariant = "error" | "success" | "info"

export type AlertMessage = {
  variant: AlertVariant
  message: string
}

/**
 * /sign-in?error=... is set by the auth routes when a callback or an email link
 * fails. Only these two values are recognised; anything else is ignored so an
 * arbitrary query value can never put text on the page.
 */
export function signInAlertForError(value: string | null | undefined): AlertMessage | null {
  if (value === "callback_failed") {
    return { variant: "error", message: "We could not complete sign-in. Please try again." }
  }

  if (value === "link_invalid") {
    return {
      variant: "error",
      message: "That link is invalid or has expired. Request a new one.",
    }
  }

  return null
}

/** /forgot-password?error=expired is set by /reset-password when signed out. */
export function resetPasswordAlertForError(value: string | null | undefined): AlertMessage | null {
  if (value === "expired") {
    return { variant: "error", message: "That reset link has expired. Request a new one." }
  }

  return null
}

/**
 * The one client-side check the reset form makes before calling the server
 * action: both fields hold the same new password and it is long enough.
 * Length and strength are otherwise decided by the server action.
 */
export function confirmPasswordError(password: string, confirmation: string): string | null {
  if (confirmation === "") {
    return "Confirm your new password"
  }

  if (password !== confirmation) {
    return "Passwords do not match"
  }

  return null
}
