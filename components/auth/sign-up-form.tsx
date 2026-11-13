"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { signUpAction } from "@/app/auth/actions"

import { FormAlert } from "./form-alert"
import { GoogleButton } from "./google-button"
import { PasswordField } from "./password-field"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { Turnstile } from "./turnstile"

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

type SentConfirmation = {
  email: string
  message: string
}

export function SignUpForm() {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)
  const [sent, setSent] = useState<SentConfirmation | null>(null)

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
      const result = await signUpAction({
        email,
        password,
        firstName,
        lastName,
        captchaToken: token,
      })

      resetVerification()

      if (result.ok) {
        setSent({ email, message: result.message })
        setPassword("")
        setPending(false)
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

  function handleDifferentEmail(): void {
    resetVerification()
    setSent(null)
    setFormError(null)
    setPassword("")
  }

  if (sent !== null) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We sent a confirmation link to <span className="font-medium text-slate-900">{sent.email}</span>.
        </p>
        <p className="mt-3 text-sm text-slate-600">{sent.message}</p>
        <button
          type="button"
          onClick={handleDifferentEmail}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">Enter your details to get started.</p>

      {formError !== null ? (
        <div className="mt-5">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="sign-up-first-name"
            name="firstName"
            label="First name"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <TextField
            id="sign-up-last-name"
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>

        <TextField
          id="sign-up-email"
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

        <PasswordField
          id="sign-up-password"
          name="password"
          label="Password"
          hint="At least 10 characters"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Turnstile
          action="sign_up"
          onToken={setToken}
          onExpire={() => setToken("")}
          onError={() => setToken("")}
          resetSignal={resetSignal}
        />

        <SubmitButton pending={pending} disabled={token === ""}>
          Create account
        </SubmitButton>
      </form>

      <div className="mt-4">
        <GoogleButton />
      </div>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
        By creating an account you agree to the{" "}
        <Link
          href="/terms-of-service"
          className="underline underline-offset-2 transition-colors duration-150 hover:text-slate-900"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy-policy"
          className="underline underline-offset-2 transition-colors duration-150 hover:text-slate-900"
        >
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  )
}
