"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { updatePasswordAction } from "@/app/auth/actions"
import { CheckCircle } from "@/components/ds/icons"
import { Button } from "@/components/ui/button"
import { confirmPasswordError } from "@/lib/identity/auth-ui"
import { PASSWORD_GUIDANCE } from "@/lib/identity/password-strength"

import { FormAlert } from "./form-alert"
import { PasswordField } from "./password-field"
import { SubmitButton } from "./submit-button"
import { newPasswordError } from "./validation"

// Choose a new password.
//
// The only check this form makes before calling the server is that the two fields
// match, which is the one rule the server cannot see. Length and the breached
// password check belong to the server action, which also re-checks that the
// request is still signed in. The strength word is guidance: it never stops a
// password the server would accept.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."

const TEXT_LINK =
  "focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"


/** The panel shown once the new password has been stored. */
export function PasswordUpdatedPanel() {
  return (
    <div>
      <CheckCircle size="lg" tone="success" className="text-success" />

      <h1 className="mt-4 text-h1 text-foreground">Password updated</h1>
      <p className="mt-2 text-body text-text-muted">
        Your password has been changed. Use it the next time you sign in.
      </p>

      <Button asChild className="mt-6 w-full">
        <Link href="/">Continue</Link>
      </Button>
    </div>
  )
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [touched, setTouched] = useState({ password: false, confirmation: false })
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
    return <PasswordUpdatedPanel />
  }

  return (
    <div>
      <h1 className="text-h1 text-foreground">Choose a new password</h1>
      <p className="mt-2 text-body text-text-muted">{PASSWORD_GUIDANCE}</p>

      {formError !== null ? (
        <div className="mt-6">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <PasswordField
          id="reset-password-new"
          name="new-password"
          label="New password"
          showStrength
          autoComplete="new-password"
          required
          value={password}
          error={touched.password ? newPasswordError(password) : undefined}
          onBlur={() => setTouched((current) => ({ ...current, password: true }))}
          onChange={(event) => setPassword(event.target.value)}
        />

        <PasswordField
          id="reset-password-confirm"
          name="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          error={
            confirmationError ??
            (touched.confirmation && confirmation === "" ? "Confirm your new password" : undefined)
          }
          value={confirmation}
          onBlur={() => setTouched((current) => ({ ...current, confirmation: true }))}
          onChange={(event) => {
            setConfirmation(event.target.value)
            setConfirmationError(null)
          }}
        />

        <SubmitButton pending={pending}>Update password</SubmitButton>
      </form>

      <p className="mt-8 text-small text-text-muted">
        <Link href="/sign-in" className={TEXT_LINK}>
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
