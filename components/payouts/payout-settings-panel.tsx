"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira, nairaToKobo } from "@/lib/catalog/money"
import { updatePayoutSettingAction } from "@/lib/payouts/actions"
import { bpsToPercent, bpsToPercentInput, percentToBps } from "@/lib/payouts/format"
import type { PayoutSettingKey, PayoutSettingsSnapshot } from "@/lib/payouts/screen-types"
import { SETTING_GROUPS, type SettingField, type SettingGroup } from "@/lib/payouts/setting-groups"

import { AlertLine, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_CLASS, Section, StatusLine } from "./ui"

// Payout settings: one form per group. Values are shown the way people think of
// them (naira, percent, days) and sent as kobo, basis points and whole days. Save
// asks for one confirmation that lists exactly what will change. The database
// checks every range and writes the history; the changes below come from it.

function shown(field: SettingField, value: boolean | bigint | undefined): string {
  if (value === undefined) {
    return field.kind === "switch" ? "false" : ""
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (field.kind === "naira") {
    return (Number(value) / 100).toString()
  }

  if (field.kind === "percent") {
    return bpsToPercentInput(Number(value))
  }

  return value.toString()
}

function describe(field: SettingField, text: string): string {
  if (field.kind === "switch") {
    return text === "true" ? "On" : "Off"
  }

  if (field.kind === "naira") {
    const kobo = nairaToKobo(text)

    return kobo === null ? text : formatNaira(kobo)
  }

  if (field.kind === "percent") {
    const bps = percentToBps(text)

    return bps === null ? text : bpsToPercent(bps)
  }

  return `${text} ${text === "1" ? "day" : "days"}`
}

function toValue(field: SettingField, text: string): boolean | number | null {
  if (field.kind === "switch") {
    return text === "true"
  }

  if (field.kind === "naira") {
    return nairaToKobo(text)
  }

  if (field.kind === "percent") {
    return percentToBps(text)
  }

  return /^[0-9]{1,3}$/.test(text.trim()) ? Number(text) : null
}

function GroupForm({ group, snapshot }: { group: SettingGroup; snapshot: PayoutSettingsSnapshot }) {
  const router = useRouter()
  const initial = Object.fromEntries(group.fields.map((field) => [field.key, shown(field, snapshot.values[field.key])]))
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const changed = group.fields.filter((field) => values[field.key] !== initial[field.key])
  const invalid = changed.filter((field) => toValue(field, values[field.key] ?? "") === null)

  async function save(): Promise<void> {
    setWorking(true)
    setError(null)
    setSaved(false)

    // One key at a time: the database checks related keys (minimum and cap)
    // against what is already saved, so the first refusal stops the rest.
    for (const field of changed) {
      const value = toValue(field, values[field.key] ?? "")

      if (value === null) {
        setError(`Check the value for ${field.label}.`)
        setWorking(false)

        return
      }

      const result = await updatePayoutSettingAction({ key: field.key, value })

      if (!result.ok) {
        setError(`${field.label}: ${result.error}`)
        setWorking(false)
        setConfirming(false)
        router.refresh()

        return
      }
    }

    setSaved(true)
    setConfirming(false)
    setWorking(false)
    router.refresh()
  }

  return (
    <Section title={group.title} description={group.description}>
      <form
        className="space-y-4"
        aria-label={group.title}
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        {group.fields.map((field) => {
          const id = `setting-${field.key}`

          return (
            <div key={field.key}>
              {field.kind === "switch" ? (
                <label className="flex min-h-[44px] items-start gap-3 text-sm text-brand-ink">
                  <input
                    type="checkbox"
                    checked={values[field.key] === "true"}
                    onChange={(event) => {
                      setValues({ ...values, [field.key]: event.target.checked ? "true" : "false" })
                      setConfirming(false)
                    }}
                    className="mt-1 h-5 w-5"
                    aria-describedby={`${id}-help`}
                  />
                  <span>{field.label}</span>
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="block text-sm font-medium text-brand-ink">
                    {field.label}
                  </label>
                  <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[field.key] ?? ""}
                    onChange={(event) => {
                      setValues({ ...values, [field.key]: event.target.value })
                      setConfirming(false)
                    }}
                    aria-describedby={`${id}-help`}
                    aria-invalid={invalid.includes(field)}
                    className={`${INPUT_CLASS} mt-2 max-w-xs tabular-nums`}
                  />
                </>
              )}
              <p id={`${id}-help`} className="mt-1 text-sm text-muted-foreground">
                {field.help} Now: {describe(field, shown(field, snapshot.values[field.key]))}.
              </p>
            </div>
          )
        })}

        {confirming ? (
          <div className="space-y-3 rounded-md border border-border px-4 py-3" aria-live="polite">
            <p className="font-medium text-brand-ink">Confirm these changes</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {changed.map((field) => (
                <li key={field.key}>
                  {field.label}: {describe(field, initial[field.key] ?? "")} to {describe(field, values[field.key] ?? "")}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON_PRIMARY} disabled={working} onClick={() => void save()}>
                {working ? "Saving…" : "Confirm and save"}
              </button>
              <button type="button" className={BUTTON_SECONDARY} disabled={working} onClick={() => setConfirming(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={changed.length === 0 || invalid.length > 0}
            onClick={() => setConfirming(true)}
          >
            Review changes
          </button>
        )}

        {invalid.length > 0 ? <AlertLine>Check the value for {invalid.map((field) => field.label).join(", ")}.</AlertLine> : null}
        {error === null ? null : <AlertLine>{error}</AlertLine>}
        {saved ? <StatusLine>Saved. The change is in the history below.</StatusLine> : null}
      </form>
    </Section>
  )
}

const LABELS: Readonly<Record<string, SettingField>> = Object.fromEntries(
  SETTING_GROUPS.flatMap((group) => group.fields).map((field) => [field.key, field]),
)

function historyValue(key: string, value: boolean | bigint | null): string {
  const field = LABELS[key as PayoutSettingKey]

  if (value === null || field === undefined) {
    return "not set"
  }

  return describe(field, shown(field, value))
}

export function PayoutSettingsPanel({
  snapshot,
  error = null,
}: {
  snapshot: PayoutSettingsSnapshot | null
  error?: string | null
}) {
  if (snapshot === null) {
    return <AlertLine>{error ?? "Settings could not be loaded. Refresh the page to try again."}</AlertLine>
  }

  return (
    <div className="space-y-6">
      {SETTING_GROUPS.map((group) => (
        <GroupForm key={group.id} group={group} snapshot={snapshot} />
      ))}

      <Section title="Recent changes" description="Every change is recorded with who made it and when.">
        {snapshot.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payout settings have been changed yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {snapshot.changes.map((change, index) => (
              <li key={`${change.key}-${change.changedAt}-${index}`} className="py-2">
                <span className="font-medium text-brand-ink">{LABELS[change.key as PayoutSettingKey]?.label ?? change.key}</span>
                : {historyValue(change.key, change.oldValue)} to {historyValue(change.key, change.newValue)}
                <span className="block text-muted-foreground">{formatLagosDateTime(change.changedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
