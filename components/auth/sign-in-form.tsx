"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { signInAction } from "@/app/auth/actions"
import { signInAlertForError } from "@/lib/identity/auth-ui"

import { FormAlert } from "./form-alert"
import { GoogleButton } from "./google-button"
import { PasswordField } from "./password-field"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { Turnstile } from "./turnstile"
import { emailError, signInPasswordError } from "./validation"

// Sign in with email and password, or with Google.
//
// The Turnstile token goes to the server action as captchaToken and is redeemed
// by Supabase. A token is single use, so every attempt (successful or not)
// clears it and resets the widget; a failed attempt also clears the password.
//
// The inline messages under a field are advice shown on blur. They do not decide
// whether the form submits: the server action still owns every rule, so pressing
// the button with an empty field gets the same answer it always did.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

export interface SignInFormProps {
  /** Safe same-site path to land on, or undefined for "/". */
  next?: string
  /** Raw ?error= value, already mapped to a fixed message here. */
  error?: string
}

const TEXT_LINK =
  "focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"

export function SignInForm({ next, error }: SignInFormProps) {
  const router = useRouter()
  const initialAlert = signInAlertForError(error)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [touched, setTouched] = useState({ email: false, password: false })
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)

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
      const result = await signInAction({ email, password, captchaToken: token, next })

      resetVerification()

      if (result.ok) {
        router.replace(result.redirectTo)
        return
      }

      setFormError(result.error)
      setPassword("")
    } catch {
      resetVerification()
      setFormError(UNEXPECTED_FAILURE)
      setPassword("")
    }

    setPending(false)
  }

  const alert = formError !== null ? { variant: "error" as const, message: formError } : initialAlert

  return (
    <div>
      <h1 className="text-h1 text-foreground">Sign in</h1>
      <p className="mt-2 text-body text-text-muted">Use your email address and password.</p>

      {alert ? (
        <div className="mt-6">
          <FormAlert key={alert.message} variant={alert.variant} autoFocus>
            {alert.message}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <TextField
          id="sign-in-email"
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          error={touched.email ? emailError(email) : undefined}
          onBlur={() => setTouched((current) => ({ ...current, email: true }))}
          onChange={(event) => setEmail(event.target.value)}
        />

        <div>
          <PasswordField
            id="sign-in-password"
            name="password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            error={touched.password ? signInPasswordError(password) : undefined}
            onBlur={() => setTouched((current) => ({ ...current, password: true }))}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="mt-2 text-small">
            <Link href="/forgot-password" className={TEXT_LINK}>
              Forgot your password?
            </Link>
          </p>
        </div>

        <Turnstile
          action="sign_in"
          onToken={setToken}
          onExpire={() => setToken("")}
          onError={() => setToken("")}
          resetSignal={resetSignal}
        />

        <SubmitButton pending={pending} disabled={token === ""}>
          Sign in
        </SubmitButton>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="text-small text-text-subtle">or</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton />

      <p className="mt-8 text-small text-text-muted">
        New here?{" "}
        <Link href="/sign-up" className={TEXT_LINK}>
          Create an account
        </Link>
      </p>
    </div>
  )
}
