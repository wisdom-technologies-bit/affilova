"use client"

import { useState } from "react"

import { Turnstile } from "@/components/auth/turnstile"
import { startCheckoutAction } from "@/lib/commerce/actions"
import { CHECKOUT_TURNSTILE_ACTION } from "@/lib/commerce/turnstile-action"
import { submitPurchase } from "@/lib/commerce/purchase"

// The buy box.
//
// Everything that decides whether a payment may start is in
// lib/commerce/purchase.ts; this component owns the fields, the Turnstile widget
// and the sentences. The button stays disabled until the widget has handed over
// a token, because a token is single use and there is nothing to send without it.

export interface PurchaseCardProps {
  productId: string
  priceLabel: string
  /** Prefilled from the signed-in account, and then read-only. */
  initialEmail?: string
  emailReadOnly?: boolean
}

const FIELD =
  "mt-1.5 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"

const LABEL = "block text-sm font-medium text-foreground"

const PRIMARY =
  "mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

/**
 * The card's markup, with nothing but props.
 *
 * The stateful half below owns the fields and the action; this half is what a
 * test or a design review renders, including the error state that a real
 * submission produces.
 */
export interface PurchaseCardViewProps {
  priceLabel: string
  email: string
  name: string
  emailReadOnly: boolean
  emailError: string
  status: string
  token: string
  submitting: boolean
  onEmailChange: (value: string) => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onToken: (token: string) => void
  onExpire: () => void
  onError: () => void
  resetSignal: number
}

export function PurchaseCardView(props: PurchaseCardViewProps) {
  const { priceLabel, email, name, emailReadOnly, emailError, status, token, submitting } = props
  const canSubmit = token !== "" && !submitting

  return (
    <section
      aria-labelledby="purchase-heading"
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <h2 id="purchase-heading" className="text-base font-semibold text-foreground">
        Buy this product
      </h2>
      <p className="mt-1 text-2xl font-semibold text-foreground">{priceLabel}</p>

      <form onSubmit={props.onSubmit} noValidate className="mt-4">
        <label className={LABEL} htmlFor="buyer-email">
          Email address
        </label>
        <input
          id="buyer-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          readOnly={emailReadOnly}
          aria-describedby={emailError === "" ? "buyer-email-hint" : "buyer-email-error"}
          aria-invalid={emailError === "" ? undefined : true}
          className={FIELD}
          value={email}
          onChange={(event) => props.onEmailChange(event.target.value)}
        />
        <p id="buyer-email-hint" className="mt-1.5 text-xs text-muted-foreground">
          {emailReadOnly
            ? "Your download link goes to the email on your account."
            : "Your download link goes to this address. Check it before paying."}
        </p>
        {emailError === "" ? null : (
          <p id="buyer-email-error" className="mt-1.5 text-sm font-medium text-destructive">
            {emailError}
          </p>
        )}

        <label className={`${LABEL} mt-4`} htmlFor="buyer-name">
          Name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="buyer-name"
          name="name"
          type="text"
          autoComplete="name"
          className={FIELD}
          value={name}
          onChange={(event) => props.onNameChange(event.target.value)}
        />

        <div className="mt-4">
          <Turnstile
            action={CHECKOUT_TURNSTILE_ACTION}
            onToken={props.onToken}
            onExpire={props.onExpire}
            onError={props.onError}
            resetSignal={props.resetSignal}
          />
        </div>

        <p role="status" aria-live="polite" className="mt-3 text-sm text-foreground">
          {status === "" ? (token === "" ? "Complete the verification challenge to continue." : "") : status}
        </p>

        <button type="submit" className={PRIMARY} disabled={!canSubmit}>
          {submitting ? "Starting the payment…" : `Buy for ${priceLabel}`}
        </button>
      </form>

      <p className="mt-4 text-xs text-muted-foreground">
        Payments are processed by Paystack. By paying you agree to our{" "}
        <a
          href="/terms-of-service"
          className="font-medium text-brand-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          terms of service
        </a>{" "}
        and{" "}
        <a
          href="/privacy-policy"
          className="font-medium text-brand-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          privacy policy
        </a>
        .
      </p>
    </section>
  )
}

export function PurchaseCard({
  productId,
  priceLabel,
  initialEmail = "",
  emailReadOnly = false,
}: PurchaseCardProps) {
  const [email, setEmail] = useState(initialEmail)
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)
  const [status, setStatus] = useState("")
  const [emailError, setEmailError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = token !== "" && !submitting

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setStatus("")
    setEmailError("")

    const outcome = await submitPurchase(
      { productId, email, name, turnstileToken: token },
      {
        startCheckout: startCheckoutAction,
        assign: (url) => {
          window.location.assign(url)
        },
      },
    )

    if (!outcome.ok) {
      setStatus(outcome.error)
      setEmailError(outcome.fieldErrors?.email ?? "")
      // The token has been spent by the attempt, so the widget must be solved
      // again before a second one can be made.
      setToken("")
      setResetSignal((value) => value + 1)
      setSubmitting(false)
    }
  }

  return (
    <PurchaseCardView
      priceLabel={priceLabel}
      email={email}
      name={name}
      emailReadOnly={emailReadOnly}
      emailError={emailError}
      status={status}
      token={token}
      submitting={submitting}
      onEmailChange={setEmail}
      onNameChange={setName}
      onSubmit={handleSubmit}
      onToken={(value) => setToken(value)}
      onExpire={() => setToken("")}
      onError={() => setToken("")}
      resetSignal={resetSignal}
    />
  )
}
