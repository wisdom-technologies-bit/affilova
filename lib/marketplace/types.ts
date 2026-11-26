import { z } from "zod"

// The shapes the public marketplace functions answer with, checked before use.
//
// The data arrives over the network from a function we wrote but cannot see the
// output of at compile time, so every field is parsed. A row that does not match
// is dropped rather than rendered: a page with a missing title is worse than a
// page with one fewer card.
//
// The schemas are strict, which is the guarantee that no field we did not ask
// for (a commission, an affiliate, a vendor's email) can travel into a page even
// if a function is changed later.

/**
 * An integer amount of kobo.
 *
 * PostgREST sends a bigint as a JSON number, but a value above the safe integer
 * range arrives as a string, so both are accepted and both become a number. The
 * catalogue's own ceiling is ten million naira, well inside the safe range.
 */
const kobo = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d{1,15}$/)
    .transform((value) => Number(value)),
])

export const marketplaceItemSchema = z
  .object({
    product_id: z.string().uuid(),
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    short_description: z.string().max(400),
    cover_public_id: z.string().min(1).max(400).nullable(),
    price_kobo: kobo,
    compare_at_price_kobo: kobo.nullable(),
    category_slug: z.string().min(1).max(60),
    category_name: z.string().min(1).max(60),
    vendor_name: z.string().min(1).max(100),
    vendor_slug: z.string().min(1).max(60),
  })
  .strict()

/** One card on a grid, in the camelCase the components use. */
export interface MarketplaceItem {
  productId: string
  slug: string
  title: string
  shortDescription: string
  coverPublicId: string | null
  priceKobo: number
  compareAtPriceKobo: number | null
  categorySlug: string
  categoryName: string
  vendorName: string
  vendorSlug: string
}

export type MarketplaceItemRow = z.infer<typeof marketplaceItemSchema>

export function toMarketplaceItem(row: MarketplaceItemRow): MarketplaceItem {
  return {
    productId: row.product_id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.short_description,
    coverPublicId: row.cover_public_id,
    priceKobo: row.price_kobo,
    compareAtPriceKobo: row.compare_at_price_kobo,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    vendorName: row.vendor_name,
    vendorSlug: row.vendor_slug,
  }
}

export const marketplacePageSchema = z
  .object({
    items: z.array(marketplaceItemSchema).max(24),
    next_cursor: z.unknown().nullable(),
    total_estimate: kobo,
  })
  .strict()

export const categorySchema = z
  .object({
    slug: z.string().min(1).max(60),
    name: z.string().min(1).max(60),
    product_count: kobo,
  })
  .strict()

export interface MarketplaceCategory {
  slug: string
  name: string
  productCount: number
}

export const storePageSchema = z
  .object({
    vendor_name: z.string().min(1).max(100),
    vendor_slug: z.string().min(1).max(60),
    product_count: kobo,
    items: z.array(marketplaceItemSchema).max(24),
    next_cursor: z.unknown().nullable(),
  })
  .strict()

export const sitemapEntriesSchema = z
  .object({
    products: z.array(
      z
        .object({
          slug: z.string().min(1).max(80),
          updated_at: z.string().min(1).max(40),
        })
        .strict(),
    ),
    categories: z.array(z.string().min(1).max(60)),
    stores: z.array(z.string().min(1).max(60)),
  })
  .strict()

export interface SitemapEntries {
  products: { slug: string; updatedAt: string }[]
  categories: string[]
  stores: string[]
}

/** A page of results, after parsing. */
export interface MarketplacePage {
  items: MarketplaceItem[]
  /** The cursor for the next page, already encoded for a URL, or null. */
  nextCursor: string | null
  /** How many products match the query, not how many are on this page. */
  total: number
}

export interface StorePage {
  vendorName: string
  vendorSlug: string
  productCount: number
  items: MarketplaceItem[]
  nextCursor: string | null
}
