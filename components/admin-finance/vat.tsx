"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { formatLagosDate, formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira, nairaToKobo } from "@/lib/catalog/money"
import {
  addVatAdjustmentAction,
  setVatPeriodStatusAction,
} from "@/lib/admin/finance-actions"
import type { VatPeriod, VatPeriodDetail } from "@/lib/admin/screen-types"

import {
  AlertLine,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  EmptyBlock,
  INPUT_CLASS,
  LABEL_CLASS,
  QuietLine,
  Section,
  StatusTag,
  type Tone,
} from "./ui"

// The VAT screens: the twelve months, and one month in detail.
//
// The status is always a sentence, never a colour: "Due in 6 days", "Overdue by
// 3 days", "Filed", "Remitted". A remitted month can only change through an
// adjustment, and the screen says so rather than showing a button that fails.

export type VatStatusText = { text: string; tone: Tone }

/** The plain sentence for one month, from its status and how close the due date is. */
export function vatStatusText(period: VatPeriod, today: string): VatStatusText {
  if (period.status === "remitted") {
    return { text: "Remitted", tone: "positive" }
  }

  if (period.status === "filed") {
    return { text: "Filed", tone: "positive" }
  }

  const days = period.daysUntilDue

  if (days < 0) {
    return { text: `Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`, tone: "danger" }
  }

  if (days === 0) {
    return { text: "Due today", tone: "warning" }
  }

  if (period.netPayableKobo === BigInt(0)) {
    return { text: "Not due yet", tone: "neutral" }
  }

  return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, tone: days <= 7 ? "warning" : "neutral" }
}

export function VatPeriodsView({
  periods,
  year,
  vatEnabled,
  rateBps,
  basis,
  today,
}: {
  periods: readonly VatPeriod[]
  year: number
  vatEnabled: boolean
  rateBps: number
  basis: string
  today: string
}) {
  return (
    <div className="space-y-4">
      {vatEnabled ? null : (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <p className="text-dense font-semibold text-foreground">VAT is switched off</p>
          <p className="mt-1 text-dense text-text-muted">
            New orders are not being charged VAT. The settings say {rateBps / 100}% on the {basis.replace(/_/g, " ")}.
            Months below show what was charged while it was on.
          </p>
        </div>
      )}

      <nav aria-label="Year" className="flex flex-wrap gap-1">
        {[year - 1, year, year + 1].map((value) => (
          <Link
            key={value}
            href={`/vat?year=${value}`}
            aria-current={value === year ? "page" : undefined}
            className={
              value === year
                ? "inline-flex min-h-control-md items-center rounded-md bg-brand-ink px-4 text-dense font-semibold text-white"
                : "inline-flex min-h-control-md items-center rounded-md border border-border px-4 text-dense font-semibold text-foreground"
            }
          >
            {value}
          </Link>
        ))}
      </nav>

      <div className="hidden md:block">
        <table className="w-full border-collapse text-dense">
          <caption className="sr-only">The twelve VAT months of {year}</caption>
          <thead>
            <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Month
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Status
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Output VAT
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Net payable
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Due
              </th>
              <th scope="col" className="py-2 font-semibold">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const status = vatStatusText(period, today)

              return (
                <tr key={period.period} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {formatLagosDate(`${period.period}T12:00:00+01:00`)}
                  </th>
                  <td className="py-2 pr-3">
                    <StatusTag tone={status.tone}>{status.text}</StatusTag>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(period.outputVatKobo)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(period.netPayableKobo)}</td>
                  <td className="py-2 pr-3">{period.dueDate === null ? "—" : formatLagosDate(`${period.dueDate}T12:00:00+01:00`)}</td>
                  <td className="py-2">
                    <Link href={`/vat/${period.period}`} className="font-semibold text-brand-600 underline underline-offset-2">
                      Open
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {periods.map((period) => {
          const status = vatStatusText(period, today)

          return (
            <li key={period.period} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {formatLagosDate(`${period.period}T12:00:00+01:00`)}
                </span>
                <StatusTag tone={status.tone}>{status.text}</StatusTag>
              </div>
              <p className="mt-1 text-dense text-text-muted">
                Output VAT {formatNaira(period.outputVatKobo)} · net payable {formatNaira(period.netPayableKobo)}
              </p>
              <Link href={`/vat/${period.period}`} className="mt-1 inline-block text-dense font-semibold text-brand-600 underline underline-offset-2">
                Open the month
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type WorkflowDialog = "filed" | "remitted" | "adjustment" | null

export function VatDetailView({
  detail,
  period,
  today,
  vatEnabled,
}: {
  detail: VatPeriodDetail
  period: string
  today: string
  vatEnabled: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<WorkflowDialog>(null)
  const [filedDate, setFiledDate] = useState(today)
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [adjustment, setAdjustment] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const summary = detail.summary
  const status = vatStatusText(summary, today)
  const remitted = summary.status === "remitted"

  async function markFiled(): Promise<void> {
    setBusy(true)
    setError(null)

    const result = await setVatPeriodStatusAction({ period, status: "filed", note: `Filed on ${filedDate}` })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setDialog(null)
    setNotice("Marked as filed.")
    router.refresh()
  }

  async function markRemitted(): Promise<void> {
    const kobo = nairaToKobo(amount)

    if (kobo === null || kobo <= 0) {
      setError("Enter the amount that was paid, in naira.")
      return
    }

    setBusy(true)
    setError(null)

    const result = await setVatPeriodStatusAction({
      period,
      status: "remitted",
      remittedAmountKobo: kobo,
      paymentReference: reference,
      note,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setDialog(null)
    setNotice("Marked as remitted.")
    router.refresh()
  }

  async function addAdjustment(): Promise<void> {
    const kobo = nairaToKobo(adjustment)

    if (kobo === null || kobo === 0) {
      setError("Enter a signed amount in naira, for example 1500 or -1500.")
      return
    }

    setBusy(true)
    setError(null)

    const result = await addVatAdjustmentAction({ period, amountKobo: kobo, reason })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setDialog(null)
    setAdjustment("")
    setReason("")
    setNotice("Adjustment recorded.")
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="space-y-1">
        {error === null ? null : <AlertLine message={error} />}
        {notice === null ? null : <p className="text-dense font-medium text-foreground">{notice}</p>}
      </div>

      {vatEnabled ? null : (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-dense text-foreground">
          VAT is switched off, so no new order is charged. What is below is what was charged at the time.
        </div>
      )}

      <Section
        title={`VAT for ${formatLagosDate(`${period}T12:00:00+01:00`)}`}
        description="Output tax on the platform's own supplies for the month, less credit notes and adjustments."
        actions={<StatusTag tone={status.tone}>{status.text}</StatusTag>}
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Output VAT", value: summary.outputVatKobo },
            { label: "Credit notes", value: summary.creditNotesKobo },
            { label: "Adjustments", value: summary.adjustmentsKobo },
            { label: "Net payable", value: summary.netPayableKobo },
          ].map((item) => (
            <div key={item.label} className="rounded-md border border-border px-4 py-3">
              <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">{item.label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatNaira(item.value)}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-dense text-text-muted">
          Due {summary.dueDate === null ? "—" : formatLagosDate(`${summary.dueDate}T12:00:00+01:00`)}.{" "}
          {remitted
            ? `Remitted ${summary.remittedAmountKobo === BigInt(0) ? "" : formatNaira(summary.remittedAmountKobo)}${
                summary.paymentReference === null ? "" : ` · reference ${summary.paymentReference}`
              }${summary.remittedAt === null ? "" : ` · recorded ${formatLagosDateTime(summary.remittedAt)}`}.`
            : "File it with the tax authority, pay it, then record the payment here."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <a className={BUTTON_SECONDARY} href={`/exports/vat?period=${period}`}>
            Export CSV
          </a>
          {remitted ? null : (
            <>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog("filed")}>
                Mark as filed
              </button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => setDialog("remitted")}>
                Mark as remitted
              </button>
            </>
          )}
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog("adjustment")}>
            Add adjustment
          </button>
        </div>

        {remitted ? (
          <p className="mt-2 text-dense text-text-muted">
            A remitted month is closed. A correction goes in as an adjustment, so the history of what was filed stays
            intact.
          </p>
        ) : null}
      </Section>

      <Section title="Adjustments" description="Signed amounts. A negative one reduces what is payable.">
        {detail.adjustments.length === 0 ? (
          <EmptyBlock title="No adjustment for this month" hint="Add one if a correction is needed." />
        ) : (
          <ul className="space-y-2 text-dense">
            {detail.adjustments.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="text-foreground">{item.reason}</span>
                <span className="tabular-nums">{formatNaira(item.amountKobo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tax lines" description="One row per order item that carried VAT, on the Lagos day it was paid.">
        {detail.lines.rows.length === 0 ? (
          <EmptyBlock title="No VAT was charged in this month" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-dense">
              <caption className="sr-only">Tax lines for the month</caption>
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Order
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Paid
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Basis
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Rate
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Base
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Tax
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Supplier
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.rows.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {line.orderNumber}
                      {line.refunded ? <span className="ml-2 text-caption text-text-muted">(refunded)</span> : null}
                    </th>
                    <td className="py-2 pr-3">
                      {line.paidDateLagos === null ? "—" : formatLagosDate(`${line.paidDateLagos}T12:00:00+01:00`)}
                    </td>
                    <td className="py-2 pr-3">{line.basis.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{(line.rateBps / 100).toFixed(2)}%</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(line.baseKobo)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(line.taxKobo)}</td>
                    <td className="py-2">{line.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.lines.nextCursor === null ? null : (
          <QuietLine>The export holds every line, including any beyond this page.</QuietLine>
        )}
      </Section>

      {dialog === null ? null : (
        <div className="rounded-md border border-border p-4">
          {dialog === "filed" ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Mark this month as filed</h2>
              <p className="text-dense text-text-muted">
                Record the day the return was filed with the tax authority. The money is recorded separately.
              </p>
              <div>
                <label className={LABEL_CLASS} htmlFor="filed-date">
                  Filed on
                </label>
                <input
                  id="filed-date"
                  type="date"
                  className={INPUT_CLASS}
                  value={filedDate}
                  onChange={(event) => setFiledDate(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON_PRIMARY} onClick={() => void markFiled()} disabled={busy}>
                  {busy ? "Saving" : "Mark as filed"}
                </button>
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {dialog === "remitted" ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Record the payment</h2>
              <p className="text-dense text-text-muted">
                Type the amount that was actually paid and the reference the tax authority or bank gave you. The
                amount is never filled in for you.
              </p>
              <div>
                <label className={LABEL_CLASS} htmlFor="remitted-amount">
                  Amount paid, in naira
                </label>
                <input
                  id="remitted-amount"
                  className={INPUT_CLASS}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="31000.00"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="remitted-reference">
                  Payment reference
                </label>
                <input
                  id="remitted-reference"
                  className={INPUT_CLASS}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="remitted-note">
                  Note (optional)
                </label>
                <input
                  id="remitted-note"
                  className={INPUT_CLASS}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON_PRIMARY} onClick={() => void markRemitted()} disabled={busy}>
                  {busy ? "Saving" : "Mark as remitted"}
                </button>
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {dialog === "adjustment" ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Add an adjustment</h2>
              <p className="text-dense text-text-muted">
                A signed amount in naira. Use a minus for a correction that reduces what is payable. A reason is
                required, because this is what an auditor reads.
              </p>
              <div>
                <label className={LABEL_CLASS} htmlFor="adjustment-amount">
                  Amount, in naira
                </label>
                <input
                  id="adjustment-amount"
                  className={INPUT_CLASS}
                  value={adjustment}
                  onChange={(event) => setAdjustment(event.target.value)}
                  inputMode="decimal"
                  placeholder="-1500"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="adjustment-reason">
                  Reason
                </label>
                <input
                  id="adjustment-reason"
                  className={INPUT_CLASS}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON_PRIMARY}
                  onClick={() => void addAdjustment()}
                  disabled={busy || reason.trim().length < 5}
                >
                  {busy ? "Saving" : "Add adjustment"}
                </button>
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
