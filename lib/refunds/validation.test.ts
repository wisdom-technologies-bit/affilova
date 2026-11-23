import { describe, expect, it } from "vitest"

// The rule both refund forms share.

import {
  MIN_REJECT_NOTE,
  MIN_REFUND_REASON,
  REFUND_REASON_ERROR,
  REJECT_NOTE_ERROR,
  charactersNeeded,
  refundReasonError,
  rejectNoteError,
} from "./validation"

describe("a buyer's reason", () => {
  it("needs ten characters after trimming", () => {
    expect(refundReasonError("   too short   ")).toBe(REFUND_REASON_ERROR)
    expect(refundReasonError("short")).toBe(REFUND_REASON_ERROR)
  })

  it("accepts a real sentence", () => {
    expect(refundReasonError("The files do not open on my machine.")).toBeNull()
    expect(refundReasonError("  The files do not open.  ")).toBeNull()
  })

  it("counts the rule once", () => {
    expect(MIN_REFUND_REASON).toBe(10)
  })
})

describe("a vendor's rejection note", () => {
  it("needs ten characters after trimming", () => {
    expect(rejectNoteError("")).toBe(REJECT_NOTE_ERROR)
    expect(rejectNoteError("  nope  ")).toBe(REJECT_NOTE_ERROR)
  })

  it("accepts a reason the buyer can act on", () => {
    expect(rejectNoteError("The file was already downloaded on 20 November.")).toBeNull()
  })

  it("counts the rule once", () => {
    expect(MIN_REJECT_NOTE).toBe(10)
  })
})

describe("the helper count", () => {
  it("never goes below zero", () => {
    expect(charactersNeeded("", 10)).toBe(10)
    expect(charactersNeeded("abc", 10)).toBe(7)
    expect(charactersNeeded("a long enough reason", 10)).toBe(0)
  })
})
