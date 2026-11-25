"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { formatNaira, nairaToKobo } from "@/lib/catalog/money"
import {
  previewWithdrawalAction,
  requestStepUpCodeAction,
  requestWithdrawalAction,
} from "@/lib/payouts/actions"
import { formatPayoutDay, reasonText } from "@/lib/payouts/format"
import type { PayoutScreenData, WithdrawalPreviewView } from "@/lib/payouts/screen-types"

import {
  AlertLine,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  NoteBox,
  Section,
  StatusLine,
} from "./ui"

// Withdraw now: the balance, an amount, a live preview of the fee and what the
// person receives, and a code from their email.
//
// The preview comes from the server on every change (a short pause after typing),
// and it is the only judge of whether a request is allowed: the checks here only
// give a quicker, kinder message for the two obvious cases. Every blocked rule is
// said in plain words, in a live region.

export interface WithdrawStart {
  amount?: string
  preview?: WithdrawalPreviewView | null
  previewError?: string | null
  codeRequested?: boolean
  result?: { status: string; needsApproval: boolean; outcome: string } | null
  error?: string | null
}

function BalanceCard({ label, value, help }: { label: string; value: bigint; help: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-ink">{formatNaira(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </div>
  )
}

const RESULT_EXPLANATION: Readonly<Record<string, string>> = {
  Requested: "We have your request. You will get an email when it is paid.",
  "Approved and queued": "It is approved and will be sent on the next payout run. You will get an email when it is paid.",
  "Waiting for admin approval":
    "A member of our team has to approve this amount before it is sent. You will get an email either way.",
}

export function WithdrawPanel({
  data,
  payoutDetailsHref,
  initial,
}: {
  data: PayoutScreenData
  payoutDetailsHref: string
  /** Test hook: render in a given state. */
  initial?: WithdrawStart
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(initial?.amount ?? "")
  const [preview, setPreview] = useState<WithdrawalPreviewView | null>(initial?.preview ?? null)
  const [previewError, setPreviewError] = useState<string | null>(initial?.previewError ?? null)
  const [previewing, setPreviewing] = useState(false)
  const [codeRequested, setCodeRequested] = useState(initial?.codeRequested ?? false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState(initial?.result ?? null)
  const latest = useRef(0)

  const kobo = amount.trim() === "" ? null : nairaToKobo(amount)
  const account = data.account
  const frozen = account !== null && account.frozenUntil !== null
  const settings = data.settings

  // A quick, local reason for the two plain cases. The server decides everything.
  let localReason: string | null = null

  if (kobo !== null) {
    if (BigInt(kobo) < settings.minWithdrawalKobo) {
      localReason = `The minimum withdrawal is ${formatNaira(settings.minWithdrawalKobo)}.`
    } else if (BigInt(kobo) > data.availableKobo) {
      localReason = `That is more than your available balance of ${formatNaira(data.availableKobo)}.`
    }
  }

  const blockedLocally = localReason !== null
  const hasAccount = account !== null
  const frozenForTest = initial !== undefined

  useEffect(() => {
    if (frozenForTest) {
      return
    }

    if (kobo === null || blockedLocally || !hasAccount) {
      setPreview(null)
      setPreviewError(null)

      return
    }

    const ticket = latest.current + 1
    latest.current = ticket
    setPreviewing(true)

    const timer = setTimeout(() => {
      void previewWithdrawalAction({ amountKobo: BigInt(kobo) }).then((outcome) => {
        if (latest.current !== ticket) {
          return
        }

        if (outcome.ok) {
          setPreview(outcome.data)
          setPreviewError(null)
        } else {
          setPreview(null)
          setPreviewError(outcome.error)
        }

        setPreviewing(false)
      })
    }, 350)

    return () => clearTimeout(timer)
  }, [kobo, blockedLocally, hasAccount, frozenForTest])

  async function sendCode(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)

    const outcome = await requestStepUpCodeAction({ purpose: "withdrawal" })

    if (outcome.ok) {
      setCodeRequested(true)
      setNotice(`We emailed you a 6 digit code. It expires in ${outcome.data.expiresInMinutes} minutes.`)
    } else {
      setError(outcome.error)
    }

    setBusy(false)
  }

  async function submit(): Promise<void> {
    if (kobo === null) {
      return
    }

    setBusy(true)
    setError(null)

    const outcome = await requestWithdrawalAction({ amountKobo: BigInt(kobo), code })

    if (outcome.ok) {
      setResult(outcome.data)
      setAmount("")
      setCode("")
      setCodeRequested(false)
      setPreview(null)
      router.refresh()
    } else {
      setError(outcome.error)
    }

    setBusy(false)
  }

  const reasons = preview === null || preview.allowed ? [] : preview.reasons
  const codeOk = /^[0-9]{6}$/.test(code.replace(/[\s-]/g, ""))
  const canAsk = preview !== null && preview.allowed && localReason === null

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <BalanceCard label="Available" value={data.availableKobo} help="Ready to withdraw now." />
        <BalanceCard
          label="Pending"
          value={data.pendingKobo}
          help={`Held for ${settings.holdDays} ${settings.holdDays === 1 ? "day" : "days"} after each sale.`}
        />
        <BalanceCard label="Total" value={data.totalKobo} help="Available plus pending." />
      </div>

      <Section title="Withdraw" description={`Minimum ${formatNaira(settings.minWithdrawalKobo)}. Payouts run Monday to Friday.`}>
        {account === null ? (
          <NoteBox title="Add a payout account first">
            <p>
              We need to know where to send your money.{" "}
              <Link href={payoutDetailsHref} className="font-medium text-brand-700 underline-offset-4 hover:underline">
                Add your payout account
              </Link>
              .
            </p>
          </NoteBox>
        ) : null}

        {frozen && account !== null && account.frozenUntil !== null ? (
          <NoteBox title="Withdrawals are paused after your account change">
            <p>
              They reopen after the 72 hour wait ends. See{" "}
              <Link href={payoutDetailsHref} className="font-medium text-brand-700 underline-offset-4 hover:underline">
                your payout details
              </Link>{" "}
              for the exact time.
            </p>
          </NoteBox>
        ) : null}

        {data.blackoutReason !== null ? (
          <div className="mt-3">
            <NoteBox title="Payouts are paused today">
              <p>
                {data.blackoutReason}. Next payout day: {formatPayoutDay(data.nextPayoutDay)}. You can still ask now;
                it is sent on the next payout day.
              </p>
            </NoteBox>
          </div>
        ) : null}

        {result !== null ? (
          <div className="mt-3 space-y-2" aria-live="polite">
            <StatusLine>
              <strong>{result.outcome}</strong>
            </StatusLine>
            <p className="text-sm text-muted-foreground">
              {RESULT_EXPLANATION[result.outcome] ?? "You will get an email when it is paid."}
            </p>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setResult(null)}>
              Make another withdrawal
            </button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
            }}
            aria-label="Request a withdrawal"
          >
            <div>
              <label htmlFor="withdraw-amount" className="block text-sm font-medium text-brand-ink">
                Amount in naira
              </label>
              <div className="relative mt-2 max-w-xs">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  ₦
                </span>
                <input
                  id="withdraw-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value)
                    setCodeRequested(false)
                    setCode("")
                    setError(null)
                    setNotice(null)
                  }}
                  aria-describedby="withdraw-help"
                  aria-invalid={amount.trim() !== "" && kobo === null}
                  className={`${INPUT_CLASS} pl-8 tabular-nums`}
                  disabled={account === null || busy}
                />
              </div>
              <p id="withdraw-help" className="mt-1 text-sm text-muted-foreground">
                For example 5000 or 5,000.50.
              </p>
              {amount.trim() !== "" && kobo === null ? (
                <p className="mt-1 text-sm text-destructive">Enter a valid amount in naira, with at most two decimals.</p>
              ) : null}
            </div>

            <div aria-live="polite" className="space-y-3">
              {localReason !== null ? <AlertLine>{localReason}</AlertLine> : null}
              {previewing && preview === null && previewError === null && localReason === null && kobo !== null ? (
                <p className="text-sm text-muted-foreground">Checking…</p>
              ) : null}
              {previewError !== null ? <AlertLine>{previewError}</AlertLine> : null}

              {preview !== null && localReason === null ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border border-border px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="text-right tabular-nums">{formatNaira(preview.grossKobo)}</dd>
                  <dt className="text-muted-foreground">Fee</dt>
                  <dd className="text-right tabular-nums">{formatNaira(preview.feeKobo)}</dd>
                  <dt className="font-medium text-brand-ink">You receive</dt>
                  <dd className="text-right font-semibold tabular-nums text-brand-ink">{formatNaira(preview.netKobo)}</dd>
                </dl>
              ) : null}

              {reasons.length > 0 ? (
                <ul className="space-y-2">
                  {reasons.map((reason) => (
                    <li key={reason}>
                      <AlertLine>{reasonText(reason)}</AlertLine>
                    </li>
                  ))}
                </ul>
              ) : null}

              {preview !== null && preview.allowed && preview.needsApproval ? (
                <p className="text-sm text-muted-foreground">
                  This amount needs a quick approval from our team before it is sent.
                </p>
              ) : null}
            </div>

            {canAsk && !codeRequested ? (
              <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={() => void sendCode()}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            ) : null}

            {canAsk && codeRequested ? (
              <div>
                <label htmlFor="withdraw-code" className="block text-sm font-medium text-brand-ink">
                  6 digit code from your email
                </label>
                <input
                  id="withdraw-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9\s-]/g, ""))}
                  className={`${INPUT_CLASS} mt-2 max-w-[12rem] tracking-widest`}
                  disabled={busy}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={BUTTON_PRIMARY} disabled={busy || !codeOk} onClick={() => void submit()}>
                    {busy ? "Requesting…" : "Request withdrawal"}
                  </button>
                  <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => void sendCode()}>
                    Send a new code
                  </button>
                </div>
              </div>
            ) : null}

            {notice !== null ? <StatusLine>{notice}</StatusLine> : null}
            {error !== null ? <AlertLine>{error}</AlertLine> : null}
          </form>
        )}
      </Section>
    </div>
  )
}
