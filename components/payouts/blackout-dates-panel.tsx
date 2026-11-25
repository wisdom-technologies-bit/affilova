"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { addBlackoutDateAction, removeBlackoutDateAction } from "@/lib/payouts/actions"
import { formatPayoutDay } from "@/lib/payouts/format"
import type { BlackoutDay } from "@/lib/payouts/screen-types"

import { AlertLine, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_CLASS, Section, StatusLine } from "./ui"

// Days on which payouts do not run. Weekends are always blocked and need no
// entry here; these are extra days, such as public holidays.

export function BlackoutDatesPanel({
  days,
  error = null,
}: {
  days: readonly BlackoutDay[] | null
  error?: string | null
}) {
  const router = useRouter()
  const [day, setDay] = useState("")
  const [reason, setReason] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(error)

  async function add(): Promise<void> {
    setWorking(true)
    setProblem(null)
    setMessage(null)

    const result = await addBlackoutDateAction({ day, reason })

    if (result.ok) {
      setMessage(`Added ${formatPayoutDay(result.data.day)}.`)
      setDay("")
      setReason("")
      router.refresh()
    } else {
      setProblem(result.error)
    }

    setWorking(false)
  }

  async function remove(target: string): Promise<void> {
    setWorking(true)
    setProblem(null)
    setMessage(null)

    const result = await removeBlackoutDateAction({ day: target })

    if (result.ok) {
      setMessage(`Removed ${formatPayoutDay(target)}.`)
      setRemoving(null)
      router.refresh()
    } else {
      setProblem(result.error)
    }

    setWorking(false)
  }

  return (
    <div className="space-y-6">
      <Section title="How blackout dates work">
        <p className="text-sm text-brand-ink">
          Payouts never run on Saturdays and Sundays, and you do not need to add them. Add a date here to
          pause payouts on a weekday, for example a public holiday. People see the reason on their payout
          pages, and their withdrawals wait for the next payout day.
        </p>
      </Section>

      <Section title="Add a date">
        <form
          className="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
          }}
          aria-label="Add a blackout date"
        >
          <div>
            <label htmlFor="blackout-day" className="block text-sm font-medium text-brand-ink">
              Date
            </label>
            <input id="blackout-day" type="date" value={day} onChange={(event) => setDay(event.target.value)} className={`${INPUT_CLASS} mt-2`} />
          </div>
          <div>
            <label htmlFor="blackout-reason" className="block text-sm font-medium text-brand-ink">
              Reason (shown to people)
            </label>
            <input
              id="blackout-reason"
              type="text"
              maxLength={120}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Public holiday"
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
          <button type="button" className={BUTTON_PRIMARY} disabled={working || day === "" || reason.trim().length < 3} onClick={() => void add()}>
            Add date
          </button>
        </form>
        <div className="mt-3 space-y-2" aria-live="polite">
          {message === null ? null : <StatusLine>{message}</StatusLine>}
          {problem === null ? null : <AlertLine>{problem}</AlertLine>}
        </div>
      </Section>

      <Section title="Upcoming blackout dates">
        {days === null ? (
          <AlertLine>{error ?? "The dates could not be loaded. Refresh the page to try again."}</AlertLine>
        ) : days.length === 0 ? (
          <p className="text-sm text-muted-foreground">No extra blackout dates. Only weekends are blocked.</p>
        ) : (
          <ul className="divide-y divide-border">
            {days.map((entry) => (
              <li key={entry.day} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium text-brand-ink">{formatPayoutDay(entry.day)}</span>
                  <span className="block text-sm text-muted-foreground">{entry.reason}</span>
                </span>
                {removing === entry.day ? (
                  <span className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON_DANGER} disabled={working} onClick={() => void remove(entry.day)}>
                      Yes, remove it
                    </button>
                    <button type="button" className={BUTTON_SECONDARY} disabled={working} onClick={() => setRemoving(null)}>
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button type="button" className={BUTTON_SECONDARY} onClick={() => setRemoving(entry.day)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
