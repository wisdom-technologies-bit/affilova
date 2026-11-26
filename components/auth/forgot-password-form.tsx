"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { requestPasswordResetAction } from "@/app/auth/actions"
import { EnvelopeSimple } from "@/components/ds/icons"
import { resetPasswordAlertForError } from "@/lib/identity/auth-ui"

import { FormAlert } from "./form-alert"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { Turnstile } from "./turnstile"
import { emailError } from "./validation"

// Request a reset link.
//
// The page answers the same way whether or not the address has an account: the
// server action never reports that, and this form only shows the neutral
// message. The Turnstile token is single use, so it is cleared and the widget
// reset after every attempt.

const NEUTRAL_MESSAGE = "If an account exists for that email, we have sent a reset link."
const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

const TEXT_LINK =
  "focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"

export interface ForgotPasswordFormProps {
  /** Raw ?error= value, already mapped to a fixed message here. */
  error?: string
}


/** The panel shown once the neutral answer has been sent. */
export function ResetLinkSentPanel({ email }: { email: string }) {
  return (
    <div>
      <EnvelopeSimple size="lg" className="text-brand-600" />

      <h1 className="mt-4 text-h1 text-foreground">Check your email</h1>

      <p className="mt-3 text-body text-text-muted">
        If an account exists for <span className="font-medium text-foreground">{email}</span>, we have sent
        a reset link to it.
      </p>

      <ul className="mt-4 space-y-1.5 text-body text-text-muted">
        <li>Open the link to choose a new password.</li>
        <li>If it has not arrived in a minute, look in your spam folder.</li>
      </ul>

      <p className="mt-8 text-small text-text-muted">
        <Link href="/sign-in" className={TEXT_LINK}>
          Back to sign in
        </Link>
      </p>
    </div>
  )
}

export function ForgotPasswordForm({ error }: ForgotPasswordFormProps) {
  const initialAlert = resetPasswordAlertForError(error)

  const [email, setEmail] = useState("")
  const [touched, setTouched] = useState(false)
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
    return <ResetLinkSentPanel email={email} />
  }

  const alert = formError !== null ? { variant: "error" as const, message: formError } : initialAlert

  return (
    <div>
      <h1 className="text-h1 text-foreground">Reset your password</h1>
      <p className="mt-2 text-body text-text-muted">
        Enter your email address and we will send you a reset link.
      </p>

      {alert ? (
        <div className="mt-6">
          <FormAlert key={alert.message} variant={alert.variant} autoFocus>
            {alert.message}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
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
          error={touched ? emailError(email) : undefined}
          onBlur={() => setTouched(true)}
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

      <p className="mt-8 text-small text-text-muted">
        <Link href="/sign-in" className={TEXT_LINK}>
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
