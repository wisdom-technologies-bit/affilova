import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { isValidReference } from "./checkout-return"

// The one server-only read the return page makes.
//
// It answers a single question: which product page should "Try again" point at?
// Only a live product's slug is read, and nothing else about the order leaves
// this function. Any failure answers null, because a retry link is a convenience
// and never a reason to fail the page.
//
// It lives apart from lib/commerce/checkout-return.ts so the polling panel, which
// runs in the browser, can import the sentences without dragging the service-role
// client into a client bundle.

/**
 * The product page a "Try again" link should point at, or null.
 */
export async function loadRetryPath(reference: string): Promise<string | null> {
  if (!isValidReference(reference)) {
    return null
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("orders")
      .select("order_items(product_id, products(slug, status))")
      .eq("paystack_reference", reference)
      .maybeSingle()

    if (error !== null || data === null) {
      return null
    }

    return readRetryPath(data)
  } catch {
    return null
  }
}

/** Read the slug out of the embedded order row. Anything unexpected is null. */
export function readRetryPath(row: unknown): string | null {
  if (typeof row !== "object" || row === null) {
    return null
  }

  const items: unknown = (row as Record<string, unknown>).order_items

  if (!Array.isArray(items) || items.length === 0) {
    return null
  }

  const item: unknown = items[0]

  if (typeof item !== "object" || item === null) {
    return null
  }

  const product: unknown = (item as Record<string, unknown>).products

  if (typeof product !== "object" || product === null) {
    return null
  }

  const candidate = product as Record<string, unknown>
  const slug: unknown = candidate.slug
  const status: unknown = candidate.status

  if (
    status !== "live" ||
    typeof slug !== "string" ||
    !/^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$/.test(slug)
  ) {
    return null
  }

  return `/p/${slug}`
}
