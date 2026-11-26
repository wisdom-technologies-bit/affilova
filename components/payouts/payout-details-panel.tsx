"use client"

import { Bank } from "@/components/ds/icons"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import {
  resolveAccountAction,
  requestStepUpCodeAction,
  savePayoutAccountAction,
  setAutoPayoutAction,
  type ResolvedAccountView,
} from "@/lib/payouts/actions"
import { bpsToPercent, formatPayoutDay, isWeekendDay } from "@/lib/payouts/format"
import type { BankOption, PayoutScreenData } from "@/lib/payouts/screen-types"

import {
  AlertLine,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  NoteBox,
  Section,
  StatusLine,
} from "./ui"

// The payout account, and the automatic payout switch.
//
// Changing the account is a short, fixed path, and each step has to be finished
// before the next appears:
//   1. choose the bank and type the 10 digit number, then "Check account";
//   2. the bank says whose account it is, and the person confirms that name;
//   3. "Email me a code", then type the 6 digit code;
//   4. "Save account".
// The full number lives only in this form's state until the save, is never put
// back into the page after it, and only its last four digits are ever shown.

export interface DetailsFlowStart {
  bankCode?: string
  accountNumber?: string
  resolved?: ResolvedAccountView | null
  confirmed?: boolean
  codeRequested?: boolean
  error?: string | null
}

export function PayoutDetailsPanel({
  data,
  banks,
  banksError = null,
  initialFlow,
  withdrawalsHref = null,
}: {
  /** Where "Go to withdrawals" points. Null hides the link (the merchant app has no such page). */
  withdrawalsHref?: string | null
  data: PayoutScreenData
  /** Null when the bank list could not be loaded. */
  banks: readonly BankOption[] | null
  banksError?: string | null
  /** Test hook: render the form part-way through. */
  initialFlow?: DetailsFlowStart
}) {
  const router = useRouter()
  const account = data.account
  const frozen = account !== null && account.frozenUntil !== null

  const [editing, setEditing] = useState(account === null || initialFlow !== undefined)
  const [filter, setFilter] = useState("")
  const [bankCode, setBankCode] = useState(initialFlow?.bankCode ?? "")
  const [accountNumber, setAccountNumber] = useState(initialFlow?.accountNumber ?? "")
  const [resolved, setResolved] = useState<ResolvedAccountView | null>(initialFlow?.resolved ?? null)
  const [confirmed, setConfirmed] = useState(initialFlow?.confirmed ?? false)
  const [codeRequested, setCodeRequested] = useState(initialFlow?.codeRequested ?? false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialFlow?.error ?? null)
  const [notice, setNotice] = useState<string | null>(null)

  const [auto, setAuto] = useState(data.autoPayout)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)

  const visibleBanks = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const list = banks ?? []

    return needle === "" ? list : list.filter((bank) => bank.name.toLowerCase().includes(needle))
  }, [banks, filter])

  function resetFlow(): void {
    setResolved(null)
    setConfirmed(false)
    setCodeRequested(false)
    setCode("")
    setError(null)
    setNotice(null)
  }

  async function check(): Promise<void> {
    setBusy(true)
    resetFlow()

    const result = await resolveAccountAction({ bankCode, accountNumber })

    if (result.ok) {
      setResolved(result.data)
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  async function sendCode(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)

    const result = await requestStepUpCodeAction({ purpose: "bank_change" })

    if (result.ok) {
      setCodeRequested(true)
      setNotice(`We emailed you a 6 digit code. It expires in ${result.data.expiresInMinutes} minutes.`)
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)

    const result = await savePayoutAccountAction({ bankCode, accountNumber, code })

    if (result.ok) {
      // The number leaves this component's state the moment it is saved.
      setAccountNumber("")
      setCode("")
      resetFlow()
      setEditing(false)
      setNotice(`Saved: ${result.data.bankName}, account ending ${result.data.accountLast4}.`)
      router.refresh()
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  async function toggleAuto(): Promise<void> {
    const next = !auto

    setAuto(next)
    setAutoBusy(true)
    setAutoError(null)

    const result = await setAutoPayoutAction({ enabled: next })

    if (!result.ok) {
      setAuto(!next)
      setAutoError(result.error)
    } else {
      router.refresh()
    }

    setAutoBusy(false)
  }

  const numberOk = /^[0-9]{10}$/.test(accountNumber)
  const codeOk = /^[0-9]{6}$/.test(code.replace(/[\s-]/g, ""))
  const weekend = !data.todayIsPayoutDay && data.blackoutReason === null && isWeekendDay(data.today)
  const settings = data.settings

  return (
    <div className="space-y-6">
      <Section title="Payout account" description="Your earnings are paid into this account.">
        {account === null ? (
          <p className="text-dense text-text-muted">
            You have not added a payout account yet. Add one below to withdraw.
          </p>
        ) : (
          <div className="flex items-start gap-3 rounded-md border border-border px-4 py-3">
            <Bank aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{account.accountName}</p>
              <p className="text-dense text-text-muted">
                {account.bankName}, account ending {account.accountLast4}
              </p>
            </div>
          </div>
        )}

        {frozen && account !== null && account.frozenUntil !== null ? (
          <div className="mt-4">
            <NoteBox title="Withdrawals are paused until the wait ends">
              <p>
                You changed your payout account recently. For your safety, withdrawals reopen{" "}
                <strong>{formatLagosDateTime(account.frozenUntil)}</strong> (Lagos time), 72 hours after a
                change.
              </p>
              <p className="mt-1">You can still see your balance and your history.</p>
            </NoteBox>
          </div>
        ) : null}

        {notice !== null && !editing ? (
          <div className="mt-4">
            <StatusLine>{notice}</StatusLine>
          </div>
        ) : null}

        {!editing && account !== null ? (
          <div className="mt-4">
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing(true)}>
              Change account
            </button>
            <p className="mt-2 text-dense text-text-muted">
              Changing it needs a code we email you, and pauses withdrawals for 72 hours.
            </p>
          </div>
        ) : null}

        {editing ? (
          <form
            className="mt-6 space-y-4 border-t border-border pt-6"
            onSubmit={(event) => {
              event.preventDefault()
            }}
            aria-label={account === null ? "Add a payout account" : "Change your payout account"}
          >
            <h3 className="font-medium text-foreground">{account === null ? "Add an account" : "New account"}</h3>

            {banksError !== null || banks === null ? (
              <AlertLine>{banksError ?? "The bank list could not be loaded. Refresh the page to try again."}</AlertLine>
            ) : (
              <div>
                <label htmlFor="bank-filter" className="block text-dense font-medium text-foreground">
                  Find your bank
                </label>
                <input
                  id="bank-filter"
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Start typing, for example Access"
                  autoComplete="off"
                  className={`${INPUT_CLASS} mt-2`}
                  disabled={busy || resolved !== null}
                />

                <label htmlFor="bank-select" className="mt-3 block text-dense font-medium text-foreground">
                  Bank
                </label>
                <select
                  id="bank-select"
                  value={bankCode}
                  onChange={(event) => {
                    setBankCode(event.target.value)
                    resetFlow()
                  }}
                  className={`${INPUT_CLASS} mt-2`}
                  disabled={busy || resolved !== null}
                >
                  <option value="">Choose a bank</option>
                  {visibleBanks.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-dense text-text-muted" aria-live="polite">
                  {filter.trim() === ""
                    ? `${(banks ?? []).length} banks`
                    : `${visibleBanks.length} ${visibleBanks.length === 1 ? "bank matches" : "banks match"}`}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="account-number" className="block text-dense font-medium text-foreground">
                Account number
              </label>
              <input
                id="account-number"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                pattern="[0-9]{10}"
                value={accountNumber}
                onChange={(event) => {
                  setAccountNumber(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))
                  resetFlow()
                }}
                aria-describedby="account-number-help"
                aria-invalid={accountNumber !== "" && !numberOk}
                className={`${INPUT_CLASS} mt-2`}
                disabled={busy || resolved !== null}
              />
              <p id="account-number-help" className="mt-1 text-dense text-text-muted">
                The 10 digit NUBAN number. Digits only.
              </p>
              {accountNumber !== "" && !numberOk ? (
                <p className="mt-1 text-dense text-destructive">An account number has exactly 10 digits.</p>
              ) : null}
            </div>

            {resolved === null ? (
              <button
                type="button"
                className={BUTTON_PRIMARY}
                disabled={busy || bankCode === "" || !numberOk}
                onClick={() => void check()}
              >
                {busy ? "Checking…" : "Check account"}
              </button>
            ) : null}

            {resolved !== null ? (
              <div className="space-y-4 rounded-md border border-border px-4 py-4" aria-live="polite">
                <p className="text-dense text-text-muted">The bank says this account belongs to:</p>
                <p className="text-h3 text-foreground">{resolved.accountName}</p>
                <p className="text-dense text-text-muted">Account ending {resolved.accountLast4}</p>

                {!resolved.nameMatches ? (
                  <AlertLine>
                    The name on this account does not match the name on your Affilova profile. Update your
                    profile name or use an account in your own name.
                  </AlertLine>
                ) : (
                  <>
                    <label className="flex min-h-control-md items-start gap-3 text-dense text-foreground">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                        className="mt-1 h-5 w-5"
                        disabled={busy}
                      />
                      <span>Yes, this is my account and the name is right.</span>
                    </label>

                    {confirmed && !codeRequested ? (
                      <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={() => void sendCode()}>
                        {busy ? "Sending…" : "Email me a code"}
                      </button>
                    ) : null}

                    {codeRequested ? (
                      <div>
                        <label htmlFor="bank-code" className="block text-dense font-medium text-foreground">
                          6 digit code from your email
                        </label>
                        <input
                          id="bank-code"
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
                          <button
                            type="button"
                            className={BUTTON_PRIMARY}
                            disabled={busy || !codeOk}
                            onClick={() => void save()}
                          >
                            {busy ? "Saving…" : "Save account"}
                          </button>
                          <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => void sendCode()}>
                            Send a new code
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={resetFlow}>
                  Use a different account
                </button>
              </div>
            ) : null}

            {notice !== null ? <StatusLine>{notice}</StatusLine> : null}
            {error !== null ? <AlertLine>{error}</AlertLine> : null}

            {account !== null ? (
              <p className="text-dense text-text-muted">
                After you save, withdrawals pause for 72 hours. This protects you if someone else gets into
                your account.
              </p>
            ) : null}

            {account !== null ? (
              <button
                type="button"
                className={BUTTON_SECONDARY}
                onClick={() => {
                  setEditing(false)
                  resetFlow()
                  setAccountNumber("")
                }}
              >
                Cancel
              </button>
            ) : null}
          </form>
        ) : null}
      </Section>

      <Section title="Automatic payout" description="Choose whether your available balance is paid out for you.">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="auto-label" className="font-medium text-foreground">
              Pay me automatically
            </p>
            <p className="mt-1 text-dense text-text-muted">
              {auto ? "On. " : "Off. "}
              {account === null ? "Add a payout account to switch this on." : ""}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={auto}
            aria-labelledby="auto-label"
            disabled={account === null || autoBusy}
            onClick={() => void toggleAuto()}
            className={`relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border transition-colors focus-ring disabled:opacity-60 ${
              auto ? "border-brand-600 bg-brand-600" : "border-border-control bg-surface-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-8 w-8 rounded-full bg-white shadow transition-transform ${
                auto ? "translate-x-7" : "translate-x-1"
              }`}
            />
            <span className="sr-only">{auto ? "On" : "Off"}</span>
          </button>
        </div>
        {autoError === null ? null : (
          <div className="mt-3">
            <AlertLine>{autoError}</AlertLine>
          </div>
        )}

        <ul className="mt-4 list-disc space-y-1 pl-5 text-dense text-foreground">
          <li>Payouts run Monday to Friday, except on days we have paused them.</li>
          <li>
            Your available balance is sent when it reaches the minimum of {formatNaira(settings.minWithdrawalKobo)}.
          </li>
          <li>
            Each payout has a fee of {bpsToPercent(settings.feeBps)}, at least {formatNaira(settings.feeMinKobo)}{" "}
            and at most {formatNaira(settings.feeCapKobo)}.
          </li>
          <li>
            Commission is held for {settings.holdDays} {settings.holdDays === 1 ? "day" : "days"} before it becomes
            available.
          </li>
        </ul>

        <p className="mt-4 text-dense text-foreground">
          {data.todayIsPayoutDay ? "Today is a payout day. " : ""}
          Next payout day: <strong>{formatPayoutDay(data.nextPayoutDay)}</strong>.
        </p>

        {data.blackoutReason !== null ? (
          <div className="mt-4">
            <NoteBox title="Payouts are paused today">
              <p>{data.blackoutReason}. Payouts continue on the next payout day.</p>
            </NoteBox>
          </div>
        ) : null}

        {weekend ? (
          <div className="mt-4">
            <NoteBox title="No payouts on weekends">
              <p>Payouts run Monday to Friday. Your next payout day is shown above.</p>
            </NoteBox>
          </div>
        ) : null}

        {withdrawalsHref === null ? null : (
          <p className="mt-4 text-dense">
            <Link href={withdrawalsHref} className="font-medium text-brand-700 underline-offset-4 hover:underline">
              Go to withdrawals
            </Link>
          </p>
        )}
      </Section>
    </div>
  )
}
