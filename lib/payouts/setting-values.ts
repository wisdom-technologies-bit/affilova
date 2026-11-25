import { formatNaira, nairaToKobo } from "@/lib/catalog/money"

import { bpsToPercent, bpsToPercentInput, percentToBps } from "./format"
import type { SettingField, SettingGroup } from "./setting-groups"

// The arithmetic behind the payout settings form.
//
// People think in naira, percent and days; the database stores kobo, basis points
// and whole days. These pure functions do the two conversions and decide which
// fields changed and which cannot be sent. No server call, no React: the form and
// its tests use the same code.

/** A saved value as the text of its field: 250000 kobo is "2500", 250 bps is "2.5". */
export function settingShown(field: SettingField, value: boolean | bigint | undefined): string {
  if (value === undefined) {
    return field.kind === "switch" ? "false" : ""
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (field.kind === "naira") {
    // Exact: no Number() of a bigint, which would lose precision on a large cap.
    const kobo = BigInt(value)
    const whole = kobo / BigInt(100)
    const rest = kobo % BigInt(100)

    return rest === BigInt(0) ? whole.toString() : `${whole.toString()}.${rest.toString().padStart(2, "0")}`
  }

  if (field.kind === "percent") {
    return bpsToPercentInput(Number(value))
  }

  return value.toString()
}

/** The same value as a person reads it: "₦2,500", "2.5%", "14 days", "On". */
export function settingDescribe(field: SettingField, text: string): string {
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

/**
 * The text of a field as the value the action sends, or null when it is not a
 * number the database would accept. Ranges are checked there, not here.
 */
export function settingToValue(field: SettingField, text: string): boolean | number | null {
  if (field.kind === "switch") {
    return text === "true"
  }

  if (field.kind === "naira") {
    return nairaToKobo(text)
  }

  if (field.kind === "percent") {
    return percentToBps(text)
  }

  return /^[0-9]{1,3}$/.test(text.trim()) ? Number(text.trim()) : null
}

/** The fields whose text is not what was loaded: only these are saved. */
export function changedFields(
  group: SettingGroup,
  values: Readonly<Record<string, string>>,
  initial: Readonly<Record<string, string>>,
): SettingField[] {
  return group.fields.filter((field) => (values[field.key] ?? "") !== (initial[field.key] ?? ""))
}

/** The changed fields that cannot be read as a value, so the form must not save. */
export function invalidFields(
  fields: readonly SettingField[],
  values: Readonly<Record<string, string>>,
): SettingField[] {
  return fields.filter((field) => settingToValue(field, values[field.key] ?? "") === null)
}

/** Every field of a group, filled in from the saved snapshot. */
export function initialValues(
  group: SettingGroup,
  values: Readonly<Record<string, boolean | bigint>>,
): Record<string, string> {
  return Object.fromEntries(group.fields.map((field) => [field.key, settingShown(field, values[field.key])]))
}
