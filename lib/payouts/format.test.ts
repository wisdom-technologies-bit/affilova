import { describe, expect, it } from "vitest"

import {
  bpsToPercent,
  bpsToPercentInput,
  formatPayoutDay,
  isWeekendDay,
  nairaOrDash,
  percentToBps,
  reasonText,
  requestOutcomeText,
  withdrawalStatusLabel,
} from "./format"

// The words and numbers on the payout screens. Pure functions only: money is
// kobo, days are Lagos days, and every unknown value has an honest answer
// instead of a blank or a zero.

describe("money and percent", () => {
  it("writes basis points as a percent without trailing zeros", () => {
    expect(bpsToPercent(0)).toBe("0%")
    expect(bpsToPercent(50)).toBe("0.5%")
    expect(bpsToPercent(100)).toBe("1%")
    expect(bpsToPercent(125)).toBe("1.25%")
    expect(bpsToPercent(200)).toBe("2%")
    expect(bpsToPercent(250)).toBe("2.5%")
    expect(bpsToPercent(750)).toBe("7.5%")
    expect(bpsToPercent(1000)).toBe("10%")
  })

  it("shows a setting in naira, and says when it is not set", () => {
    expect(nairaOrDash(BigInt(0))).toBe("₦0")
    expect(nairaOrDash(BigInt(100_000))).toBe("₦1,000")
    expect(nairaOrDash(BigInt(250_050))).toBe("₦2,500.50")
    expect(nairaOrDash(null)).toBe("Not set")
    expect(nairaOrDash(undefined)).toBe("Not set")
  })

  it("reads a percent typed by a person back into basis points", () => {
    expect(percentToBps("2.5")).toBe(250)
    expect(percentToBps("2.5%")).toBe(250)
    expect(percentToBps(" 7.5 ")).toBe(750)
    expect(percentToBps("0")).toBe(0)
    expect(percentToBps("10")).toBe(1000)
  })

  it("refuses a percent that is not a number with at most two decimals", () => {
    expect(percentToBps("2.555")).toBeNull()
    expect(percentToBps("-1")).toBeNull()
    expect(percentToBps("abc")).toBeNull()
    expect(percentToBps("")).toBeNull()
    expect(percentToBps("1000")).toBeNull()
  })

  it("writes basis points back into the text of a percent field", () => {
    expect(bpsToPercentInput(250)).toBe("2.5")
    expect(bpsToPercentInput(750)).toBe("7.5")
    expect(bpsToPercentInput(100)).toBe("1")
    expect(bpsToPercentInput(0)).toBe("0")
  })
})

describe("days", () => {
  it("writes a payout day in Lagos time", () => {
    expect(formatPayoutDay("2026-11-25")).toBe("25 Nov 2026")
    expect(formatPayoutDay("2026-12-01")).toBe("01 Dec 2026")
    expect(formatPayoutDay("2027-01-05")).toBe("05 Jan 2027")
  })

  it("says a day is not scheduled rather than showing nothing", () => {
    expect(formatPayoutDay(null)).toBe("Not scheduled")
    expect(formatPayoutDay("")).toBe("Not scheduled")
  })

  it("knows weekends, which never pay out", () => {
    expect(isWeekendDay("2026-11-28")).toBe(true) // Saturday
    expect(isWeekendDay("2026-11-29")).toBe(true) // Sunday
    expect(isWeekendDay("2026-11-30")).toBe(false) // Monday
    expect(isWeekendDay("2026-11-27")).toBe(false) // Friday
  })

  it("does not treat a malformed day as a weekend", () => {
    expect(isWeekendDay("28/11/2026")).toBe(false)
    expect(isWeekendDay("")).toBe(false)
  })
})

describe("withdrawal words", () => {
  it("names every status the screens can show", () => {
    expect(withdrawalStatusLabel("requested")).toBe("Requested")
    expect(withdrawalStatusLabel("approved")).toBe("Approved, queued")
    expect(withdrawalStatusLabel("processing")).toBe("Sending to your bank")
    expect(withdrawalStatusLabel("paid")).toBe("Paid")
    expect(withdrawalStatusLabel("failed")).toBe("Failed, money returned")
    expect(withdrawalStatusLabel("reversed")).toBe("Reversed, money returned")
    expect(withdrawalStatusLabel("rejected")).toBe("Rejected, money returned")
    expect(withdrawalStatusLabel("cancelled")).toBe("Cancelled, money returned")
  })

  it("says a status it does not know is unknown, not a guess", () => {
    expect(withdrawalStatusLabel("something_else")).toBe("Unknown")
    expect(withdrawalStatusLabel("toString")).toBe("Unknown")
  })

  it("turns every blocked rule into one plain sentence", () => {
    expect(reasonText("user_not_active")).toContain("Your account is not active")
    expect(reasonText("no_account")).toBe("Add a payout account first.")
    expect(reasonText("account_frozen")).toContain("72 hour wait ends")
    expect(reasonText("account_too_new")).toContain("too new to withdraw yet")
    expect(reasonText("below_minimum")).toContain("below the minimum withdrawal")
    expect(reasonText("insufficient_balance")).toContain("more than your available balance")
    expect(reasonText("daily_limit")).toContain("today's withdrawal limit")
    expect(reasonText("not_payout_day")).toBe("Payouts do not run today.")
  })

  it("never shows a raw reason code to a person", () => {
    expect(reasonText("a_reason_added_later")).toBe("This withdrawal cannot be requested right now.")
    expect(reasonText("")).toBe("This withdrawal cannot be requested right now.")
  })

  it("says what happens next after a request", () => {
    expect(requestOutcomeText("approved", false)).toBe("Approved and queued")
    expect(requestOutcomeText("approved", true)).toBe("Approved and queued")
    expect(requestOutcomeText("requested", true)).toBe("Waiting for admin approval")
    expect(requestOutcomeText("requested", false)).toBe("Requested")
  })
})
