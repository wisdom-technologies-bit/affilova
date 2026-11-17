import "server-only"

import { catalogErrorMessage } from "./errors"
import { asRecord, readNumber, readString } from "./rows"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// The categories a product can be filed under.
//
// public.product_categories is fixed reference data, readable by everyone and
// written by nobody (see the catalog migration), so this reads it with the
// ordinary server client rather than the service role: the request carries the
// signed-in vendor's own session.

export type ProductCategory = {
  /** The smallint primary key, which is what products.category_id stores. */
  id: number
  slug: string
  name: string
}

export type CategoriesResult =
  | { ok: true; categories: ProductCategory[] }
  | { ok: false; error: string }

export async function listProductCategories(): Promise<CategoriesResult> {
  try {
    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase
      .from("product_categories")
      .select("id, slug, name")
      .order("sort", { ascending: true })

    if (error) {
      return { ok: false, error: catalogErrorMessage(error) }
    }

    const categories: ProductCategory[] = []

    for (const row of Array.isArray(data) ? data : []) {
      const record = asRecord(row)
      const id = record === null ? null : readNumber(record, "id")
      const slug = record === null ? null : readString(record, "slug")
      const name = record === null ? null : readString(record, "name")

      if (id !== null && slug !== null && name !== null) {
        categories.push({ id, slug, name })
      }
    }

    return { ok: true, categories }
  } catch (error) {
    return { ok: false, error: catalogErrorMessage(error) }
  }
}
