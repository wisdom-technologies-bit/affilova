import { describe, expect, it } from "vitest"

import { catalogErrorMessage } from "./errors"
import { fieldForError, splitActionError } from "./field-errors"

describe("an action error is put back on the field that caused it", () => {
  it("knows the price and the commission", () => {
    expect(fieldForError(catalogErrorMessage("invalid_price"))).toBe("price")
    expect(fieldForError(catalogErrorMessage("invalid_commission"))).toBe("commission")
  })

  it("knows the two descriptions", () => {
    expect(fieldForError(catalogErrorMessage("invalid_short_description"))).toBe("shortDescription")
    expect(fieldForError(catalogErrorMessage("invalid_description"))).toBe("description")
  })

  it("knows a taken address", () => {
    expect(fieldForError(catalogErrorMessage("slug_taken"))).toBe("slug")
  })

  it("leaves a form-level sentence alone", () => {
    expect(fieldForError("Something went wrong. Try again.")).toBeNull()
    expect(fieldForError(catalogErrorMessage("forbidden"))).toBeNull()
  })

  it("splits the message without changing it", () => {
    expect(splitActionError(catalogErrorMessage("invalid_price"))).toEqual({
      field: "price",
      message: catalogErrorMessage("invalid_price"),
    })
  })
})
