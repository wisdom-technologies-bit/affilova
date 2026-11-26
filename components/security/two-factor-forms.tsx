"use client"

import { useActionState } from "react"

import { submitEnrollmentCode, submitVerifyCode } from "@/lib/identity/mfa-actions"

// The two forms behind staff two-factor sign-in.
//
// Both are a labelled six digit field with inputmode numeric and
// autocomplete="one-time-code", so a phone offers the code from the message or
// the authenticator, and a screen reader announces the field as a one time code.
// The error sits in an aria-live region, so it is read out when it appears
// without moving focus.

const FIELD =
  "mt-1.5 block w-full min-h-11 rounded-md border border-input bg-background px-3 py-2.5 text-center text-lg tracking-[0.4em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

const LABEL = "block text-sm font-medium text-foreground"

const BUTTON =
  "mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"

function CodeField({ id }: { id: string }) {
  return (
    <>
      <label htmlFor={id} className={LABEL}>
        Six digit code
      </label>
      <input
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        aria-describedby={`${id}-hint`}
        className={FIELD}
      />
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
        The code changes every thirty seconds.
      </p>
    </>
  )
}

export interface VerifyFormProps {
  next: string
}

export function VerifyForm({ next }: VerifyFormProps) {
  const [error, formAction, pending] = useActionState(submitVerifyCode, null)

  return (
    <form action={formAction}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enter your code</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Open your authenticator app and enter the six digit code for Affilova.
      </p>

      <input type="hidden" name="next" value={next} />

      <div className="mt-6">
        <CodeField id="verify-code" />
      </div>

      <button type="submit" className={BUTTON} disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </button>

      <p aria-live="polite" className="mt-4 min-h-6 text-sm text-destructive">
        {error ?? ""}
      </p>
    </form>
  )
}

export interface EnrollFormProps {
  qrCode: string
  secret: string
  next: string
}

export function EnrollForm({ qrCode, secret, next }: EnrollFormProps) {
  const [error, formAction, pending] = useActionState(submitEnrollmentCode, null)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Set up two-factor sign-in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Staff accounts need a second step to sign in. Scan this code with an authenticator app, then enter
        the six digit code it shows.
      </p>

      <div className="mt-6 flex flex-col items-center gap-4">
        {/* The QR code is an inline image from Supabase, not a stored file. */}
        <img
          src={qrCode}
          alt="QR code to scan with an authenticator app"
          width={180}
          height={180}
          className="rounded-md border border-border bg-white p-2"
        />
        <div className="w-full">
          <p className="text-xs font-medium text-muted-foreground">Or enter this key by hand</p>
          <code className="mt-1 block break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground">
            {secret}
          </code>
        </div>
      </div>

      <form action={formAction} className="mt-6">
        <input type="hidden" name="next" value={next} />
        <CodeField id="enroll-code" />
        <button type="submit" className={BUTTON} disabled={pending}>
          {pending ? "Checking…" : "Turn on two-factor"}
        </button>
        <p aria-live="polite" className="mt-4 min-h-6 text-sm text-destructive">
          {error ?? ""}
        </p>
      </form>
    </div>
  )
}
