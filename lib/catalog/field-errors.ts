// Which form field an action's error belongs to.
//
// The actions answer with one safe sentence rather than a per-field map (see
// lib/catalog/errors.ts), so the sentence is matched back to the code it came
// from and then to the field that produces it. An error that matches nothing
// stays a form-level message, which is honest but still visible.

import { catalogErrorMessage } from "./errors"

export type ProductFieldName =
  | "title"
  | "slug"
  | "category"
  | "shortDescription"
  | "description"
  | "price"
  | "compareAtPrice"
  | "commission"
  | "approval"
  | "refund"
  | "downloads"

const FIELD_FOR_CODE: Readonly<Record<string, ProductFieldName>> = {
  invalid_title: "title",
  invalid_slug: "slug",
  slug_taken: "slug",
  invalid_category: "category",
  invalid_short_description: "shortDescription",
  invalid_description: "description",
  invalid_price: "price",
  invalid_compare_price: "compareAtPrice",
  invalid_commission: "commission",
  invalid_approval: "approval",
  invalid_refund_window: "refund",
  invalid_max_downloads: "downloads",
}

/** The field an action error belongs to, or null when it is form-level. */
export function fieldForError(error: string): ProductFieldName | null {
  for (const [code, field] of Object.entries(FIELD_FOR_CODE)) {
    if (catalogErrorMessage(code) === error) {
      return field
    }
  }

  return null
}

/** Split one action error into a field error and whatever is left over. */
export function splitActionError(error: string): {
  field: ProductFieldName | null
  message: string
} {
  return { field: fieldForError(error), message: error }
}
