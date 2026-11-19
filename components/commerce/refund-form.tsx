"use client"

import { useState } from "react"

import { requestRefundForOrderAction } from "@/app/access/[token]/actions"

// Ask for a refund, while the window is open.
//
// The server decides: this form only collects a reason long enough to be useful
// (10 characters) and short enough to read (1000), and shows what came back.

export const REFUND_MIN = 10
export const REFUND_MAX = 1000

export interface RefundFormProps {
  token: string
}

export function RefundForm({ token }: RefundFormProps) {
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const trimmed = reason.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < REFUND_MIN
  const canSubmit = trimmed.length >= REFUND_MIN && trimmed.length <= REFUND_MAX && !busy && !done

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    setBusy(true)
    setStatus("")

    try {
      const result = await requestRefundForOrderAction({ token, reason: trimmed })

      setStatus(result.message ?? "")
      setDone(result.ok)
    } catch {
      setStatus("We could not send the request. Please try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="refund-reason" className="block text-sm font-medium text-foreground">
        Why are you asking for a refund?
      </label>
      <textarea
        id="refund-reason"
        name="reason"
        rows={4}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-describedby="refund-reason-hint"
        aria-invalid={tooShort ? true : undefined}
        className="mt-1.5 block w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
      />
      <p id="refund-reason-hint" className="mt-1.5 text-xs text-muted-foreground">
        {`${REFUND_MIN} to ${REFUND_MAX} characters. ${trimmed.length} so far.`}
      </p>
      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-md border border-brand-600 bg-background px-4 text-sm font-semibold text-brand-700 transition-colors duration-150 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Sending…" : "Request a refund"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-foreground">
        {status}
      </p>
    </form>
  )
}
