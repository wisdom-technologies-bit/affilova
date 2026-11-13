"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { requestPasswordResetAction } from "@/app/auth/actions"
import { resetPasswordAlertForError } from "@/lib/identity/auth-ui"

import { FormAlert } from "./form-alert"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { Turnstile } from "./turnstile"

// Request a reset link.
//
// The page answers the same way whether or not the address has an account: the
// server action never reports that, and this form only shows the neutral
// message. The Turnstile token is single use, so it is cleared and the widget
// reset after every attempt.

const NEUTRAL_MESSAGE = "If an account exists for that email, we have sent a reset link."
const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

export interface ForgotPasswordFormProps {
  /** Raw ?error= value, already mapped to a fixed message here. */
  error?: string
}

export function ForgotPasswordForm({ error }: ForgotPasswordFormProps) {
  const initialAlert = resetPasswordAlertForError(error)

  const [email, setEmail] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)
  const [sent, setSent] = useState(false)

  function resetVerification(): void {
    setToken("")
    setResetSignal((value) => value + 1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (pending) {
      return
    }

    if (token === "") {
      setFormError(MISSING_TOKEN)
      return
    }

    setFormError(null)
    setPending(true)

    try {
      const result = await requestPasswordResetAction({ email, captchaToken: token })

      resetVerification()

      if (!result.ok) {
        setFormError(result.error)
      } else {
        setSent(true)
      }
    } catch {
      resetVerification()
      setFormError(UNEXPECTED_FAILURE)
    }

    setPending(false)
  }

  if (sent) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Check your email</h1>
        <div className="mt-5">
          <FormAlert variant="success">{NEUTRAL_MESSAGE}</FormAlert>
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link
            href="/sign-in"
            className="rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  const alert = formError !== null ? { variant: "error" as const, message: formError } : initialAlert

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-600">
        Enter your email address and we will send you a reset link.
      </p>

      {alert ? (
        <div className="mt-5">
          <FormAlert key={alert.message} variant={alert.variant} autoFocus>
            {alert.message}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <TextField
          id="forgot-password-email"
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Turnstile
          action="forgot_password"
          onToken={setToken}
          onExpire={() => setToken("")}
          onError={() => setToken("")}
          resetSignal={resetSignal}
        />

        <SubmitButton pending={pending} disabled={token === ""}>
          Send reset link
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        <Link
          href="/sign-in"
          className="rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
