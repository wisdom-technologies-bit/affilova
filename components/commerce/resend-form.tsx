"use client"

import { useState } from "react"

import { Turnstile } from "@/components/auth/turnstile"
import { resendAccessAction } from "@/app/access/resend/actions"

// "Send me a new link".
//
// The answer is the same sentence whatever happened, so this component has one
// success path and no error copy: showing a different message for "no such
// buyer" would turn the form into a way to test whether an address has bought
// anything.

export function ResendForm() {
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [resetSignal, setResetSignal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const canSubmit = email.trim() !== "" && token !== "" && !busy

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    setBusy(true)
    setMessage("")

    try {
      const result = await resendAccessAction({ email, turnstileToken: token })

      setMessage(result.message)
    } catch {
      setMessage("If that address has paid orders, we have emailed the links again.")
    } finally {
      setToken("")
      setResetSignal((value) => value + 1)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="resend-email" className="block text-sm font-medium text-foreground">
        Email address
      </label>
      <input
        id="resend-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1.5 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
      />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Use the address you paid with. We send one link per paid order.
      </p>

      <div className="mt-4">
        <Turnstile
          action="checkout"
          onToken={(value) => setToken(value)}
          onExpire={() => setToken("")}
          onError={() => setToken("")}
          resetSignal={resetSignal}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Sending…" : "Send me a new link"}
      </button>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-foreground">
        {message}
      </p>
    </form>
  )
}
