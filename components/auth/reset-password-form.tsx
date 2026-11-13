"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { updatePasswordAction } from "@/app/auth/actions"
import { confirmPasswordError } from "@/lib/identity/auth-ui"

import { FormAlert } from "./form-alert"
import { PasswordField } from "./password-field"
import { SubmitButton } from "./submit-button"

// Choose a new password. The only client-side check is that both fields match:
// the length and strength rules belong to the server action, which also
// re-checks that the request is still signed in.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."

export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [updated, setUpdated] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (pending) {
      return
    }

    const mismatch = confirmPasswordError(password, confirmation)

    setConfirmationError(mismatch)

    if (mismatch !== null) {
      return
    }

    setFormError(null)
    setPending(true)

    try {
      const result = await updatePasswordAction({ password })

      if (result.ok) {
        setUpdated(true)
        setPassword("")
        setConfirmation("")
      } else {
        setFormError(result.error)
        setPassword("")
        setConfirmation("")
      }
    } catch {
      setFormError(UNEXPECTED_FAILURE)
      setPassword("")
      setConfirmation("")
    }

    setPending(false)
  }

  if (updated) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Password updated</h1>
        <p className="mt-2 text-sm text-slate-600">Your password has been changed.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Continue
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-slate-600">Use at least 10 characters.</p>

      {formError !== null ? (
        <div className="mt-5">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <PasswordField
          id="reset-password-new"
          name="new-password"
          label="New password"
          hint="At least 10 characters"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <PasswordField
          id="reset-password-confirm"
          name="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          error={confirmationError ?? undefined}
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value)
            setConfirmationError(null)
          }}
        />

        <SubmitButton pending={pending}>Update password</SubmitButton>
      </form>
    </div>
  )
}
