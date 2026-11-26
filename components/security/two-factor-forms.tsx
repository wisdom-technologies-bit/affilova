"use client"

import { useActionState, type ReactNode } from "react"

import { FormAlert } from "@/components/auth/form-alert"
import { SubmitButton } from "@/components/auth/submit-button"
import { CopyField } from "@/components/ds/copy-field"
import { Field } from "@/components/ds/field"
import { Input } from "@/components/ui/input"
import { submitEnrollmentCode, submitVerifyCode } from "@/lib/identity/mfa-actions"

// The two forms behind staff two-factor sign-in.
//
// Both use the same six digit field: inputmode numeric so a phone shows a number
// pad, autocomplete="one-time-code" so the code can be offered from the message or
// the authenticator, and a label a screen reader reads as a one time code. The
// error is an InlineAlert with role="alert", so it is announced without the focus
// being taken off the field the person is about to correct.
//
// Enrolment is three numbered steps in one card, in the order they happen: install
// the app, scan or copy the key, then enter the first code. The secret is shown in
// groups of four to be read aloud, and copied without the spaces.

const CODE_LENGTH = 6

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP", for reading and typing by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim()
}

function CodeField({ id, error }: { id: string; error?: string }) {
  return (
    <Field
      id={id}
      label="Six digit code"
      help="The code changes every thirty seconds."
      error={error}
      required
    >
      {(field) => (
        <Input
          {...field}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={CODE_LENGTH}
          autoFocus
          className="text-center text-lg tracking-[0.4em] tabular"
        />
      )}
    </Field>
  )
}

export interface VerifyFormProps {
  next: string
}

export function VerifyForm({ next }: VerifyFormProps) {
  const [error, formAction, pending] = useActionState(submitVerifyCode, null)

  return (
    <form action={formAction}>
      <h1 className="text-h1 text-foreground">Enter your code</h1>
      <p className="mt-2 text-body text-text-muted">
        Open your authenticator app and enter the six digit code for Affilova.
      </p>

      <input type="hidden" name="next" value={next} />

      {error === null ? null : (
        <div className="mt-6">
          <FormAlert variant="error">{error}</FormAlert>
        </div>
      )}

      <div className="mt-6">
        <CodeField id="verify-code" error={error ?? undefined} />
      </div>

      <div className="mt-6">
        <SubmitButton pending={pending}>Verify</SubmitButton>
      </div>
    </form>
  )
}

export interface EnrollFormProps {
  qrCode: string
  secret: string
  next: string
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="border-t border-border pt-6 first:border-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        <span aria-hidden="true" className="text-small font-medium tabular text-text-subtle">
          {number}
        </span>
        <h2 className="text-h3 text-foreground">{title}</h2>
      </div>
      <div className="mt-3 pl-6">{children}</div>
    </li>
  )
}

export function EnrollForm({ qrCode, secret, next }: EnrollFormProps) {
  const [error, formAction, pending] = useActionState(submitEnrollmentCode, null)

  return (
    <div>
      <h1 className="text-h1 text-foreground">Set up two-factor sign-in</h1>
      <p className="mt-2 text-body text-text-muted">
        Staff accounts need a second step to sign in. This takes about a minute.
      </p>

      <form action={formAction} className="mt-6 rounded-lg border border-border p-6">
        <input type="hidden" name="next" value={next} />

        <ol className="space-y-6">
          <Step number={1} title="Install an authenticator app">
            <p className="text-body text-text-muted">
              Any app that generates six digit codes will work: Google Authenticator, Authy, 1Password.
            </p>
          </Step>

          <Step number={2} title="Scan the code or copy the key">
            {/* The QR code is an inline image from Supabase, not a stored file. */}
            <img
              src={qrCode}
              alt="QR code to scan with an authenticator app"
              width={192}
              height={192}
              className="h-48 w-48 rounded-md border border-border bg-background p-2"
            />

            <CopyField
              className="mt-4"
              label="Setup key"
              value={groupSecret(secret)}
              copyValue={secret.replace(/\s+/g, "")}
              copyLabel="Copy key"
            />
          </Step>

          <Step number={3} title="Enter the 6 digit code">
            <CodeField id="enroll-code" error={error ?? undefined} />
          </Step>
        </ol>

        {error === null ? null : (
          <div className="mt-6">
            <FormAlert variant="error">{error}</FormAlert>
          </div>
        )}

        <div className="mt-6">
          <SubmitButton pending={pending}>Turn on two-factor</SubmitButton>
        </div>
      </form>

      <p className="mt-6 text-small text-text-muted">
        If you lose the device, another admin can reset two-factor for your account. You will then set it
        up again with a new device.
      </p>
    </div>
  )
}
