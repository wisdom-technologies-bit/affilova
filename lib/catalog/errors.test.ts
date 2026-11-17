import { describe, expect, it } from "vitest"

import {
  actionFailure,
  catalogErrorCode,
  catalogErrorMessage,
  CATALOG_ERROR_CODES,
  GENERIC_ERROR,
} from "./errors"

describe("catalogErrorCode", () => {
  it("recognises a code raised by a function", () => {
    expect(catalogErrorCode("invalid_price")).toBe("invalid_price")
    expect(catalogErrorCode({ message: "slug_taken" })).toBe("slug_taken")
    expect(catalogErrorCode(new Error("not_ready"))).toBe("not_ready")
  })

  it("does not recognise raw database text", () => {
    expect(catalogErrorCode('new row violates check constraint "products_price_kobo_check"')).toBeNull()
    expect(
      catalogErrorCode({
        message: 'duplicate key value violates unique constraint "products_slug_key"',
        code: "23505",
        details: "Key (slug)=(keto) already exists.",
      }),
    ).toBeNull()
  })

  it("does not match a code embedded in a longer message", () => {
    expect(catalogErrorCode("invalid_price because 5 < 10000")).toBeNull()
  })

  it("survives anything that is not an error", () => {
    expect(catalogErrorCode(null)).toBeNull()
    expect(catalogErrorCode(undefined)).toBeNull()
    expect(catalogErrorCode(42)).toBeNull()
    expect(catalogErrorCode({})).toBeNull()
  })
})

describe("catalogErrorMessage", () => {
  it("maps every known code to its own sentence", () => {
    for (const code of CATALOG_ERROR_CODES) {
      const message = catalogErrorMessage(code)

      expect(message, code).not.toBe(GENERIC_ERROR)
      expect(message.length, code).toBeGreaterThan(0)
    }
  })

  it("answers the generic sentence for anything else", () => {
    expect(catalogErrorMessage("relation \"public.products\" does not exist")).toBe(GENERIC_ERROR)
    expect(catalogErrorMessage(null)).toBe(GENERIC_ERROR)
    expect(catalogErrorMessage(undefined)).toBe(GENERIC_ERROR)
  })

  it("never returns raw database text", () => {
    const raw = 'insert or update on table "product_files" violates foreign key constraint'

    expect(catalogErrorMessage(raw)).toBe(GENERIC_ERROR)
    expect(catalogErrorMessage(raw)).not.toContain("product_files")
  })

  it("keeps the sentences short enough to show next to a field", () => {
    for (const code of CATALOG_ERROR_CODES) {
      expect(catalogErrorMessage(code).length, code).toBeLessThanOrEqual(120)
    }
  })
})

describe("actionFailure", () => {
  it("wraps a code and an unknown error", () => {
    expect(actionFailure("last_file")).toEqual({
      ok: false,
      error: catalogErrorMessage("last_file"),
    })
    expect(actionFailure({ message: "boom" })).toEqual({ ok: false, error: GENERIC_ERROR })
  })
})
