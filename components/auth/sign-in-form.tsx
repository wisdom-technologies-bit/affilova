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

// Sign in with email and password, or with Google.
//
// The Turnstile token goes to the server action as captchaToken and is redeemed
// by Supabase. A token is single use, so every attempt (successful or not)
// clears it and resets the widget; a failed attempt also clears the password.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

export interface SignInFormProps {
  /** Safe same-site path to land on, or undefined for "/". */
  next?: string
  /** Raw ?error= value, already mapped to a fixed message here. */
  error?: string
}

export function SignInForm({ next, error }: SignInFormProps) {
  const router = useRouter()
  const initialAlert = signInAlertForError(error)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
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
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Use your email address and password.</p>

      {alert ? (
        <div className="mt-5">
          <FormAlert key={alert.message} variant={alert.variant} autoFocus>
            {alert.message}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
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
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="mt-2 text-right">
            <Link
              href="/forgot-password"
              className="rounded-sm text-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Forgot password?
            </Link>
          </div>
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

      <div className="my-5 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-[#E3E6E3]" />
        <span className="text-xs uppercase tracking-wide text-slate-500">or</span>
        <span aria-hidden="true" className="h-px flex-1 bg-[#E3E6E3]" />
      </div>

      <GoogleButton />

      <p className="mt-6 text-center text-sm text-slate-600">
        New here?{" "}
        <Link
          href="/sign-up"
          className="rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Create an account
        </Link>
      </p>
    </div>
  )
}
