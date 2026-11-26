"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { signUpAction } from "@/app/auth/actions"
import { EnvelopeSimple } from "@/components/ds/icons"
import { Button } from "@/components/ui/button"
import { PASSWORD_GUIDANCE } from "@/lib/identity/password-strength"

import { FormAlert } from "./form-alert"
import { GoogleButton } from "./google-button"
import { PasswordField } from "./password-field"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { Turnstile } from "./turnstile"
import { emailError, newPasswordError, requiredNameError } from "./validation"

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."
const MISSING_TOKEN = "Complete the verification check to continue."

type SentConfirmation = {
  email: string
}

type Touched = {
  firstName: boolean
  lastName: boolean
  email: boolean
  password: boolean
}

const TEXT_LINK =
  "focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"

// Create an account.
//
// The success state is a panel rather than a line of green text: it names the
// address the message went to, says what happens next, and says where to look if
// it does not arrive. "Use a different email" returns to the form with the
// fields as they were, so a typo costs one field, not the whole form.
//
// The inline messages under a field are advice shown on blur. They never decide
// whether the form submits: the server action still owns every rule.

export function CheckEmailPanel({
  email,
  onDifferentEmail,
}: {
  email: string
  /** Returns to the form. Left out where the panel is shown on its own. */
  onDifferentEmail?: () => void
}) {
  return (
    <div>
      <EnvelopeSimple size="lg" className="text-brand-600" />

      <h1 className="mt-4 text-h1 text-foreground">Check your email</h1>

      <p className="mt-3 text-body text-text-muted">
        We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
      </p>

      <ul className="mt-4 space-y-1.5 text-body text-text-muted">
        <li>Open the link to confirm your account, then sign in.</li>
        <li>If it has not arrived in a minute, look in your spam folder.</li>
      </ul>

      {onDifferentEmail === undefined ? null : (
        <Button type="button" variant="outline" className="mt-8 w-full" onClick={onDifferentEmail}>
          Use a different email
        </Button>
      )}

      <p className="mt-6 text-small text-text-muted">
        Already confirmed?{" "}
        <Link href="/sign-in" className={TEXT_LINK}>
          Sign in
        </Link>
      </p>
    </div>
  )
}

export function SignUpForm() {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [touched, setTouched] = useState<Touched>({
    firstName: false,
    lastName: false,
    email: false,
    password: false,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)
  const [sent, setSent] = useState<SentConfirmation | null>(null)

  function resetVerification(): void {
    setToken("")
    setResetSignal((value) => value + 1)
  }

  function markTouched(field: keyof Touched): void {
    setTouched((current) => ({ ...current, [field]: true }))
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
        // The server's message is the same sentence as the panel heading, so the
        // panel says it once, in the place a person is looking.
        setSent({ email })
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
    return <CheckEmailPanel email={sent.email} onDifferentEmail={handleDifferentEmail} />
  }

  return (
    <div>
      <h1 className="text-h1 text-foreground">Create your account</h1>
      <p className="mt-2 text-body text-text-muted">Enter your details to get started.</p>

      {formError !== null ? (
        <div className="mt-6">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="sign-up-first-name"
            name="firstName"
            label="First name"
            autoComplete="given-name"
            required
            value={firstName}
            error={touched.firstName ? requiredNameError(firstName, "first") : undefined}
            onBlur={() => markTouched("firstName")}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <TextField
            id="sign-up-last-name"
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            required
            value={lastName}
            error={touched.lastName ? requiredNameError(lastName, "last") : undefined}
            onBlur={() => markTouched("lastName")}
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
          error={touched.email ? emailError(email) : undefined}
          onBlur={() => markTouched("email")}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          id="sign-up-password"
          name="password"
          label="Password"
          hint={PASSWORD_GUIDANCE}
          showStrength
          autoComplete="new-password"
          required
          value={password}
          error={touched.password ? newPasswordError(password) : undefined}
          onBlur={() => markTouched("password")}
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

      <div className="my-6 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="text-small text-text-subtle">or</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton />

      <p className="mt-8 text-small text-text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className={TEXT_LINK}>
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        By creating an account you agree to the{" "}
        <Link href="/terms-of-service" className="underline underline-offset-2 hover:text-foreground">
          Terms of Service
        </Link>
        ,{" "}
        <Link href="/privacy-policy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/cookie-policy" className="underline underline-offset-2 hover:text-foreground">
          Cookie Policy
        </Link>
        .
      </p>
    </div>
  )
}
