"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { formatLagosDateTime } from "@/lib/catalog/format"
import { updatePayoutSettingAction } from "@/lib/payouts/actions"
import type { PayoutSettingKey, PayoutSettingsSnapshot } from "@/lib/payouts/screen-types"
import {
  changedFields,
  initialValues,
  invalidFields,
  settingDescribe,
  settingShown,
  settingToValue,
} from "@/lib/payouts/setting-values"
import { SETTING_GROUPS, type SettingField, type SettingGroup } from "@/lib/payouts/setting-groups"

import { AlertLine, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_CLASS, Section, StatusLine } from "./ui"

// Payout settings: one form per group. Values are shown the way people think of
// them (naira, percent, days) and sent as kobo, basis points and whole days. Save
// asks for one confirmation that lists exactly what will change. The database
// checks every range and writes the history; the changes below come from it.

function GroupForm({ group, snapshot }: { group: SettingGroup; snapshot: PayoutSettingsSnapshot }) {
  const router = useRouter()
  const initial = initialValues(group, snapshot.values)
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const changed = changedFields(group, values, initial)
  const invalid = invalidFields(changed, values)

  async function save(): Promise<void> {
    setWorking(true)
    setError(null)
    setSaved(false)

    // One key at a time: the database checks related keys (minimum and cap)
    // against what is already saved, so the first refusal stops the rest.
    for (const field of changed) {
      const value = settingToValue(field, values[field.key] ?? "")

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
                <label className="flex min-h-control-md items-start gap-3 text-dense text-foreground">
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
                  <label htmlFor={id} className="block text-dense font-medium text-foreground">
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
              <p id={`${id}-help`} className="mt-1 text-dense text-text-muted">
                {field.help} Now: {settingDescribe(field, settingShown(field, snapshot.values[field.key]))}.
              </p>
            </div>
          )
        })}

        {confirming ? (
          <div className="space-y-3 rounded-md border border-border px-4 py-3" aria-live="polite">
            <p className="font-medium text-foreground">Confirm these changes</p>
            <ul className="list-disc space-y-1 pl-5 text-dense">
              {changed.map((field) => (
                <li key={field.key}>
                  {field.label}: {settingDescribe(field, initial[field.key] ?? "")} to {settingDescribe(field, values[field.key] ?? "")}
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

  return settingDescribe(field, settingShown(field, value))
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
          <p className="text-dense text-text-muted">No payout settings have been changed yet.</p>
        ) : (
          <ul className="divide-y divide-border text-dense">
            {snapshot.changes.map((change, index) => (
              <li key={`${change.key}-${change.changedAt}-${index}`} className="py-2">
                <span className="font-medium text-foreground">{LABELS[change.key as PayoutSettingKey]?.label ?? change.key}</span>
                : {historyValue(change.key, change.oldValue)} to {historyValue(change.key, change.newValue)}
                <span className="block text-text-muted">{formatLagosDateTime(change.changedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
