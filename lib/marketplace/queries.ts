import "server-only"

import { logger } from "@/lib/logger"
import { decodeCursor, encodeCursor } from "@/lib/pagination/cursor"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { PAGE_SIZE, type MarketplaceQuery } from "./params"
import {
  categorySchema,
  marketplaceItemSchema,
  marketplacePageSchema,
  sitemapEntriesSchema,
  storePageSchema,
  toMarketplaceItem,
  type MarketplaceCategory,
  type MarketplaceItem,
  type MarketplacePage,
  type SitemapEntries,
  type StorePage,
} from "./types"

// The server's only way into the public marketplace functions.
//
// Every call goes through one helper, which does four things in one place: it
// applies a three second timeout, it never throws, it logs a short reason, and
// it hands the answer to a strict schema before anything renders. A failure is
// therefore always the same shape to the caller, and a page can show an honest
// error state instead of a half-rendered grid.
//
// The client is injected, so the tests drive these functions with fakes and no
// database.

/** How long a public read may take before the page gives up on it. */
export const TIMEOUT_MS = 3000

export type RpcResult = { data: unknown; error: unknown }

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>

export interface MarketplaceDeps {
  rpc: Rpc
  timeoutMs?: number
}

type Call = { ok: true; data: unknown } | { ok: false }

function defaultDeps(): MarketplaceDeps {
  return {
    rpc: async (fn, args) => {
      const { data, error } = await getSupabaseAdminClient().rpc(fn, args)

      return { data, error }
    },
    timeoutMs: TIMEOUT_MS,
  }
}

function shortMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim().slice(0, 200)
  }

  if (typeof error === "object" && error !== null) {
    const message: unknown = (error as { message?: unknown }).message

    if (typeof message === "string" && message.trim() !== "") {
      return message.trim().slice(0, 200)
    }
  }

  return "unexpected error"
}

/** The marker a slow call resolves to, so nothing is left rejecting. */
const TIMED_OUT = Symbol("timeout")

/**
 * Race a promise against a timer.
 *
 * Resolves to the timeout marker rather than rejecting, so a slow call is not an
 * unhandled rejection when the page has already moved on.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise<T | typeof TIMED_OUT>((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        logger.error("marketplace_query_failed", { reason: shortMessage(error) })
        resolve(TIMED_OUT)
      },
    )
  })
}

async function call(deps: MarketplaceDeps, fn: string, args: Record<string, unknown>): Promise<Call> {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS

  let result: RpcResult | typeof TIMED_OUT

  try {
    result = await withTimeout(deps.rpc(fn, args), timeoutMs)
  } catch (error) {
    logger.error("marketplace_query_failed", { fn, reason: shortMessage(error) })

    return { ok: false }
  }

  if (result === TIMED_OUT) {
    logger.error("marketplace_query_timeout", { fn, timeout_ms: timeoutMs })

    return { ok: false }
  }

  if (result.error !== null && result.error !== undefined) {
    logger.error("marketplace_query_failed", { fn, reason: shortMessage(result.error) })

    return { ok: false }
  }

  return { ok: true, data: result.data }
}

/** The cursor object to send to the database, or null for the first page. */
export function cursorArgument(cursor: string): unknown {
  if (cursor === "") {
    return null
  }

  const decoded = decodeCursor(cursor)

  if (!decoded.ok || typeof decoded.value !== "object" || decoded.value === null) {
    // A cursor that does not decode is not an error the person can act on: the
    // page simply starts again from the first one.
    return null
  }

  return decoded.value
}

function nextCursorOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }

  return encodeCursor(value)
}

/**
 * One page of the public listing.
 *
 * Answers null when the read failed or the answer did not match the shape, so a
 * page can tell "nothing matched" (an empty page) from "we could not ask" (null).
 */
export async function getMarketplacePage(
  query: MarketplaceQuery,
  deps?: MarketplaceDeps,
): Promise<MarketplacePage | null> {
  const resolved = deps ?? defaultDeps()

  const answer = await call(resolved, "public_marketplace", {
    p_q: query.q === "" ? null : query.q,
    p_category: query.category === "" ? null : query.category,
    p_min_price_kobo: query.minKobo,
    p_max_price_kobo: query.maxKobo,
    p_sort: query.sort,
    p_limit: PAGE_SIZE,
    p_cursor: cursorArgument(query.cursor),
  })

  if (!answer.ok) {
    return null
  }

  const parsed = marketplacePageSchema.safeParse(answer.data)

  if (!parsed.success) {
    logger.error("marketplace_query_shape", { fn: "public_marketplace" })

    return null
  }

  return {
    items: parsed.data.items.map(toMarketplaceItem),
    nextCursor: nextCursorOf(parsed.data.next_cursor),
    total: parsed.data.total_estimate,
  }
}

/** Every category with at least one live product, ordered by name. */
export async function getMarketplaceCategories(deps?: MarketplaceDeps): Promise<MarketplaceCategory[] | null> {
  const resolved = deps ?? defaultDeps()
  const answer = await call(resolved, "public_categories", {})

  if (!answer.ok) {
    return null
  }

  const parsed = categorySchema.array().safeParse(answer.data)

  if (!parsed.success) {
    logger.error("marketplace_query_shape", { fn: "public_categories" })

    return null
  }

  return parsed.data.map((row) => ({
    slug: row.slug,
    name: row.name,
    productCount: row.product_count,
  }))
}

/** Up to four other live products in the same category, newest first. */
export async function getRelatedProducts(
  productId: string,
  deps?: MarketplaceDeps,
): Promise<MarketplaceItem[] | null> {
  const resolved = deps ?? defaultDeps()
  const answer = await call(resolved, "public_product_related", {
    p_product: productId,
    p_limit: 4,
  })

  if (!answer.ok) {
    return null
  }

  const parsed = marketplaceItemSchema.array().safeParse(answer.data)

  if (!parsed.success) {
    logger.error("marketplace_query_shape", { fn: "public_product_related" })

    return null
  }

  return parsed.data.map(toMarketplaceItem)
}

/** One vendor's storefront, or null when it is not public. */
export async function getStorePage(
  slug: string,
  cursor: string,
  deps?: MarketplaceDeps,
): Promise<StorePage | null> {
  const resolved = deps ?? defaultDeps()
  const answer = await call(resolved, "public_store", {
    p_vendor_slug: slug,
    p_limit: PAGE_SIZE,
    p_cursor: cursorArgument(cursor),
  })

  if (!answer.ok) {
    return null
  }

  if (answer.data === null) {
    return null
  }

  const parsed = storePageSchema.safeParse(answer.data)

  if (!parsed.success) {
    logger.error("marketplace_query_shape", { fn: "public_store" })

    return null
  }

  return {
    vendorName: parsed.data.vendor_name,
    vendorSlug: parsed.data.vendor_slug,
    productCount: parsed.data.product_count,
    items: parsed.data.items.map(toMarketplaceItem),
    nextCursor: nextCursorOf(parsed.data.next_cursor),
  }
}

/** Everything a crawler may index: products, categories and stores. */
export async function getSitemapEntries(deps?: MarketplaceDeps): Promise<SitemapEntries | null> {
  const resolved = deps ?? defaultDeps()
  const answer = await call(resolved, "public_sitemap_entries", {})

  if (!answer.ok) {
    return null
  }

  const parsed = sitemapEntriesSchema.safeParse(answer.data)

  if (!parsed.success) {
    logger.error("marketplace_query_shape", { fn: "public_sitemap_entries" })

    return null
  }

  return {
    products: parsed.data.products.map((row) => ({ slug: row.slug, updatedAt: row.updated_at })),
    categories: parsed.data.categories,
    stores: parsed.data.stores,
  }
}

// ----------------------------------------------------------------------------
// The vendor's public handle, for a product page that must link to the store.
//
// A product page already knows the vendor's business name (lib/catalog/public.ts
// reads it), but not the handle its storefront lives at. One narrow read answers
// that: the slug of the vendor of a live product, and nothing else about them.
// The row is refused unless the product is live and the vendor active, which is
// the same pair of conditions every other public read applies.
// ----------------------------------------------------------------------------

export interface ProductStoreDeps {
  /** The vendor's slug for a live product, or null. Injected for tests. */
  loadStoreSlug: (productId: string) => Promise<unknown | null>
}

const STORE_SELECT = "vendor_profiles!inner(slug,status)"

async function loadStoreSlug(productId: string): Promise<unknown | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("products")
    .select(STORE_SELECT)
    .eq("id", productId)
    .eq("status", "live")
    .eq("vendor_profiles.status", "active")
    .maybeSingle()

  if (error !== null) {
    return null
  }

  return data
}

/** The vendor's public slug for a live product, or null when there is none. */
export async function getProductStoreSlug(
  productId: string,
  deps?: ProductStoreDeps,
): Promise<string | null> {
  const load = deps?.loadStoreSlug ?? loadStoreSlug

  let row: unknown

  try {
    row = await load(productId)
  } catch (error) {
    logger.error("marketplace_query_failed", {
      fn: "product_store_slug",
      reason: shortMessage(error),
    })

    return null
  }

  if (typeof row !== "object" || row === null) {
    return null
  }

  const vendor = (row as { vendor_profiles?: unknown }).vendor_profiles

  if (typeof vendor !== "object" || vendor === null) {
    return null
  }

  const slug = (vendor as { slug?: unknown }).slug

  if (typeof slug !== "string") {
    return null
  }

  const trimmed = slug.trim().toLowerCase()

  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(trimmed) ? trimmed : null
}
