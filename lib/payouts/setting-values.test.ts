import { describe, expect, it } from "vitest"

import type { SettingField, SettingGroup } from "./setting-groups"
import { SETTING_GROUPS } from "./setting-groups"
import {
  changedFields,
  initialValues,
  invalidFields,
  settingDescribe,
  settingShown,
  settingToValue,
} from "./setting-values"

// The arithmetic of the payout settings form: naira to kobo, percent to basis
// points, days, and which fields a save would send. The database still enforces
// every range; what is checked here is that the form sends the right numbers and
// refuses to send something it cannot read.

const FEES = SETTING_GROUPS.find((group) => group.id === "fees") as SettingGroup
const LIMITS = SETTING_GROUPS.find((group) => group.id === "limits") as SettingGroup
const APPROVAL = SETTING_GROUPS.find((group) => group.id === "approval") as SettingGroup
const COMMISSION = SETTING_GROUPS.find((group) => group.id === "commission") as SettingGroup

function field(group: SettingGroup, key: string): SettingField {
  const found = group.fields.find((entry) => entry.key === key)

  if (found === undefined) {
    throw new Error(`no field ${key}`)
  }

  return found
}

describe("showing a saved value in its field", () => {
  it("writes kobo as whole naira, and keeps the kobo when there are any", () => {
    expect(settingShown(field(FEES, "withdrawal_fee_min_kobo"), BigInt(5_000))).toBe("50")
    expect(settingShown(field(LIMITS, "min_withdrawal_kobo"), BigInt(100_000))).toBe("1000")
    expect(settingShown(field(FEES, "withdrawal_fee_cap_kobo"), BigInt(250_050))).toBe("2500.50")
    expect(settingShown(field(LIMITS, "min_withdrawal_kobo"), BigInt(0))).toBe("0")
  })

  it("does not lose a large cap to floating point", () => {
    expect(settingShown(field(FEES, "withdrawal_fee_cap_kobo"), BigInt("999999999999"))).toBe("9999999999.99")
  })

  it("writes basis points as the percent a person types", () => {
    expect(settingShown(field(FEES, "withdrawal_fee_bps"), BigInt(250))).toBe("2.5")
    expect(settingShown(field(COMMISSION, "platform_fee_bps"), BigInt(750))).toBe("7.5")
  })

  it("writes days and switches as they are", () => {
    expect(settingShown(field(COMMISSION, "commission_hold_days"), BigInt(14))).toBe("14")
    expect(settingShown(field(APPROVAL, "payout_first_requires_approval"), true)).toBe("true")
    expect(settingShown(field(APPROVAL, "payout_first_requires_approval"), false)).toBe("false")
  })

  it("leaves a number field empty when the database has no value, and a switch off", () => {
    expect(settingShown(field(LIMITS, "min_withdrawal_kobo"), undefined)).toBe("")
    expect(settingShown(field(APPROVAL, "payout_first_requires_approval"), undefined)).toBe("false")
  })

  it("fills a whole group from the snapshot", () => {
    expect(
      initialValues(FEES, {
        withdrawal_fee_bps: BigInt(100),
        withdrawal_fee_min_kobo: BigInt(5_000),
        withdrawal_fee_cap_kobo: BigInt(250_000),
      }),
    ).toEqual({
      withdrawal_fee_bps: "1",
      withdrawal_fee_min_kobo: "50",
      withdrawal_fee_cap_kobo: "2500",
    })
  })
})

describe("reading a value the way a person does", () => {
  it("shows naira with the symbol and the separators", () => {
    expect(settingDescribe(field(FEES, "withdrawal_fee_min_kobo"), "50")).toBe("₦50")
    expect(settingDescribe(field(LIMITS, "withdrawal_daily_limit_kobo"), "500000")).toBe("₦500,000")
  })

  it("shows a percent with the sign", () => {
    expect(settingDescribe(field(FEES, "withdrawal_fee_bps"), "1")).toBe("1%")
    expect(settingDescribe(field(COMMISSION, "platform_fee_bps"), "7.5")).toBe("7.5%")
  })

  it("shows days with the word, and one day in the singular", () => {
    expect(settingDescribe(field(COMMISSION, "commission_hold_days"), "7")).toBe("7 days")
    expect(settingDescribe(field(COMMISSION, "commission_hold_days"), "1")).toBe("1 day")
    expect(settingDescribe(field(COMMISSION, "commission_hold_days"), "0")).toBe("0 days")
  })

  it("shows a switch as on or off, never true or false", () => {
    expect(settingDescribe(field(APPROVAL, "payout_first_requires_approval"), "true")).toBe("On")
    expect(settingDescribe(field(APPROVAL, "payout_first_requires_approval"), "false")).toBe("Off")
  })

  it("falls back to the text it was given when it cannot read it", () => {
    expect(settingDescribe(field(LIMITS, "min_withdrawal_kobo"), "abc")).toBe("abc")
    expect(settingDescribe(field(FEES, "withdrawal_fee_bps"), "1.234")).toBe("1.234")
  })
})

describe("turning a field back into a value to send", () => {
  it("sends kobo for a naira field", () => {
    expect(settingToValue(field(LIMITS, "min_withdrawal_kobo"), "1000")).toBe(100_000)
    expect(settingToValue(field(FEES, "withdrawal_fee_min_kobo"), "50")).toBe(5_000)
    expect(settingToValue(field(FEES, "withdrawal_fee_min_kobo"), "50.50")).toBe(5_050)
  })

  it("sends basis points for a percent field", () => {
    expect(settingToValue(field(FEES, "withdrawal_fee_bps"), "2.5")).toBe(250)
    expect(settingToValue(field(COMMISSION, "platform_fee_bps"), "7.5")).toBe(750)
  })

  it("sends whole days for a days field", () => {
    expect(settingToValue(field(COMMISSION, "commission_hold_days"), "7")).toBe(7)
    expect(settingToValue(field(COMMISSION, "commission_hold_days"), "0")).toBe(0)
  })

  it("sends a boolean for a switch", () => {
    expect(settingToValue(field(APPROVAL, "payout_first_requires_approval"), "true")).toBe(true)
    expect(settingToValue(field(APPROVAL, "payout_first_requires_approval"), "false")).toBe(false)
  })

  it("refuses a value it cannot read", () => {
    expect(settingToValue(field(LIMITS, "min_withdrawal_kobo"), "")).toBeNull()
    expect(settingToValue(field(LIMITS, "min_withdrawal_kobo"), "0")).toBeNull()
    expect(settingToValue(field(LIMITS, "min_withdrawal_kobo"), "10,00")).toBeNull()
    expect(settingToValue(field(FEES, "withdrawal_fee_bps"), "2.555")).toBeNull()
    expect(settingToValue(field(COMMISSION, "commission_hold_days"), "7.5")).toBeNull()
    expect(settingToValue(field(COMMISSION, "commission_hold_days"), "7000")).toBeNull()
  })
})

describe("deciding what a save would send", () => {
  const initial = { withdrawal_fee_bps: "1", withdrawal_fee_min_kobo: "50", withdrawal_fee_cap_kobo: "2500" }

  it("sends nothing when nothing changed", () => {
    expect(changedFields(FEES, { ...initial }, initial)).toEqual([])
  })

  it("sends only the fields that changed", () => {
    const changed = changedFields(FEES, { ...initial, withdrawal_fee_bps: "2.5" }, initial)

    expect(changed.map((entry) => entry.key)).toEqual(["withdrawal_fee_bps"])
  })

  it("treats an emptied field as a change that cannot be sent", () => {
    const values = { ...initial, withdrawal_fee_min_kobo: "" }
    const changed = changedFields(FEES, values, initial)

    expect(changed.map((entry) => entry.key)).toEqual(["withdrawal_fee_min_kobo"])
    expect(invalidFields(changed, values).map((entry) => entry.key)).toEqual(["withdrawal_fee_min_kobo"])
  })

  it("accepts a group where every changed field can be read", () => {
    const values = { ...initial, withdrawal_fee_bps: "2.5", withdrawal_fee_cap_kobo: "3000" }
    const changed = changedFields(FEES, values, initial)

    expect(changed.map((entry) => entry.key)).toEqual(["withdrawal_fee_bps", "withdrawal_fee_cap_kobo"])
    expect(invalidFields(changed, values)).toEqual([])
  })

  it("never asks the database to check a range the form can already see is nonsense", () => {
    const values = { ...initial, withdrawal_fee_bps: "not a number" }

    expect(invalidFields(changedFields(FEES, values, initial), values).map((entry) => entry.key)).toEqual([
      "withdrawal_fee_bps",
    ])
  })
})
