import { describe, expect, it } from "vitest"

import {
  confirmPasswordError,
  resetPasswordAlertForError,
  signInAlertForError,
} from "./auth-ui"

describe("signInAlertForError", () => {
  it("explains a failed callback", () => {
    expect(signInAlertForError("callback_failed")).toStrictEqual({
      variant: "error",
      message: "We could not complete sign-in. Please try again.",
    })
  })

  it("explains an invalid or expired link", () => {
    expect(signInAlertForError("link_invalid")).toStrictEqual({
      variant: "error",
      message: "That link is invalid or has expired. Request a new one.",
    })
  })

  it("ignores a missing or unknown value", () => {
    expect(signInAlertForError(undefined)).toBeNull()
    expect(signInAlertForError(null)).toBeNull()
    expect(signInAlertForError("")).toBeNull()
    expect(signInAlertForError("expired")).toBeNull()
    expect(signInAlertForError("<script>alert(1)</script>")).toBeNull()
  })
})

describe("resetPasswordAlertForError", () => {
  it("explains an expired reset link", () => {
    expect(resetPasswordAlertForError("expired")).toStrictEqual({
      variant: "error",
      message: "That reset link has expired. Request a new one.",
    })
  })

  it("ignores anything else", () => {
    expect(resetPasswordAlertForError(undefined)).toBeNull()
    expect(resetPasswordAlertForError("callback_failed")).toBeNull()
    expect(resetPasswordAlertForError("expired ")).toBeNull()
  })
})

describe("confirmPasswordError", () => {
  it("accepts a non-empty confirmation that matches", () => {
    expect(confirmPasswordError("correct horse battery", "correct horse battery")).toBeNull()
  })

  it("asks for a confirmation when the field is empty", () => {
    expect(confirmPasswordError("correct horse battery", "")).toBe("Confirm your new password")
  })

  it("reports a mismatch", () => {
    expect(confirmPasswordError("correct horse battery", "correct horse batterY")).toBe(
      "Passwords do not match",
    )
  })

  it("does not apply a length rule of its own", () => {
    expect(confirmPasswordError("short", "short")).toBeNull()
  })
})
