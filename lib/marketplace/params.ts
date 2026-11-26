import { nairaToKobo } from "@/lib/catalog/money"

// The marketplace's URL vocabulary, as pure functions.
//
// Nothing here reads Next.js, the environment or the database: a page hands in
// the search params it received and gets back a query it may safely use, and a
// link is built from the same shape. That makes the rules readable on their own
// and testable without a request.
//
// Every value is treated as hostile. A query is length-limited and stripped of
// control characters, a category must look like a slug, a price must be a real
// naira amount and a cursor must look like a cursor. Anything else falls back to
// its default rather than raising: a page that 500s because someone typed a
// letter into the price box is worse than a page that ignores it.

export const MARKETPLACE_SORTS = ["newest", "price_low", "price_high", "best_selling"] as const

export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number]

/** The number of cards on a page. The database caps its own limit at 24. */
export const PAGE_SIZE = 12

/** The longest search a person may make. The database cuts at the same length. */
export const MAX_QUERY_LENGTH = 80

const MAX_CURSOR_LENGTH = 512

const MAX_CATEGORY_LENGTH = 40

// A category slug: lowercase letters, digits and hyphens, never starting with a
// hyphen. The catalogue's own slugs are all shorter than this.
const CATEGORY_SLUG = /^[a-z0-9][a-z0-9-]*$/

// A cursor is base64url: the alphabet below and nothing else. Its meaning is
// decided by the database; here it only has to be the right shape.
const CURSOR = /^[A-Za-z0-9_-]+$/

export interface MarketplaceQuery {
  /** The search text, "" when there is none. */
  q: string
  /** A category slug, "" when there is none. */
  category: string
  /** The lowest price in kobo, null when there is no lower bound. */
  minKobo: number | null
  /** The highest price in kobo, null when there is no upper bound. */
  maxKobo: number | null
  sort: MarketplaceSort
  /** The opaque page cursor, "" on the first page. */
  cursor: string
}

export const EMPTY_QUERY: MarketplaceQuery = {
  q: "",
  category: "",
  minKobo: null,
  maxKobo: null,
  sort: "newest",
  cursor: "",
}

export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * The first value of a repeated parameter.
 *
 * "?q=a&q=b" arrives as an array. Taking the first entry is what the form would
 * have sent, and it keeps one URL from meaning two different searches.
 */
function first(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : ""
  }

  return ""
}

/** The search text, cleaned: control characters gone, trimmed, length-limited. */
export function cleanQuery(value: string): string {
  // Control characters become spaces one code point at a time, so no regular
  // expression has to spell them out and a pasted tab cannot reach the database.
  const stripped = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0

    return code < 32 || code === 127 ? " " : character
  }).join("")

  // Sliced by code point, not by UTF-16 unit, so a limit that lands inside an
  // emoji cannot produce half a character.
  return Array.from(stripped.trim()).slice(0, MAX_QUERY_LENGTH).join("")
}

/** A category slug, or "" when the value is not shaped like one. */
export function cleanCategory(value: string): string {
  const trimmed = value.trim().toLowerCase()

  if (trimmed.length === 0 || trimmed.length > MAX_CATEGORY_LENGTH) {
    return ""
  }

  return CATEGORY_SLUG.test(trimmed) ? trimmed : ""
}

// A vendor's handle: three to forty characters, the same shape the database
// enforces on vendor_profiles.slug.
const VENDOR_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** A vendor slug, or "" when the value is not shaped like one. */
export function cleanVendorSlug(value: string): string {
  const trimmed = value.trim().toLowerCase()

  return VENDOR_SLUG.test(trimmed) ? trimmed : ""
}

/** A cursor, or "" when the value is not shaped like one. */
export function cleanCursor(value: string): string {
  const trimmed = value.trim()

  if (trimmed.length === 0 || trimmed.length > MAX_CURSOR_LENGTH) {
    return ""
  }

  return CURSOR.test(trimmed) ? trimmed : ""
}

/** A naira amount from the URL, as kobo, or null when it is not a real amount. */
export function cleanNaira(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed === "") {
    return null
  }

  return nairaToKobo(trimmed)
}

export function cleanSort(value: string): MarketplaceSort {
  const trimmed = value.trim().toLowerCase()

  return (MARKETPLACE_SORTS as readonly string[]).includes(trimmed)
    ? (trimmed as MarketplaceSort)
    : "newest"
}

/**
 * The query a set of search params means, with every invalid value replaced by
 * its default.
 *
 * A minimum above a maximum is left as it is: the database then answers with an
 * empty page, which is the honest answer to an impossible range, and the filter
 * panel still shows the person what they asked for.
 */
export function parseMarketplaceQuery(input: RawSearchParams): MarketplaceQuery {
  return {
    q: cleanQuery(first(input.q)),
    category: cleanCategory(first(input.category)),
    minKobo: cleanNaira(first(input.min)),
    maxKobo: cleanNaira(first(input.max)),
    sort: cleanSort(first(input.sort)),
    cursor: cleanCursor(first(input.cursor)),
  }
}

/**
 * True when the person has asked for something narrower than the plain listing.
 *
 * Those pages are noindex: a search result page, a page two of a list and a
 * price-filtered view are all the same products in a different order, and letting
 * a crawler index every combination of them buries the real pages.
 */
export function isFiltered(query: MarketplaceQuery): boolean {
  return (
    query.q !== "" ||
    query.category !== "" ||
    query.minKobo !== null ||
    query.maxKobo !== null ||
    query.sort !== "newest" ||
    query.cursor !== ""
  )
}

/** Kobo as the naira text a price input holds: "1500" or "1500.50". */
export function koboToNairaInput(kobo: number | null): string {
  if (kobo === null || !Number.isInteger(kobo) || kobo < 0) {
    return ""
  }

  const naira = Math.floor(kobo / 100)
  const remainder = kobo % 100

  if (remainder === 0) {
    return String(naira)
  }

  return `${naira}.${String(remainder).padStart(2, "0")}`
}

export interface HrefOptions {
  /** The path the query is for, for example "/marketplace". */
  basePath: string
  /** The query to express. Missing fields are omitted from the URL. */
  query: Partial<MarketplaceQuery>
  /** Leave the cursor out, for a form that must start at page one. */
  withoutCursor?: boolean
}

/**
 * The URL for a query.
 *
 * Only values that differ from the default are written, so the plain listing is
 * "/marketplace" and not "/marketplace?q=&category=&sort=newest". Parameters are
 * written in a fixed order so two equal queries always produce the same URL.
 */
export function buildMarketplaceHref(options: HrefOptions): string {
  const params = new URLSearchParams()
  const query = options.query

  const q = query.q === undefined ? "" : cleanQuery(query.q)
  const category = query.category === undefined ? "" : cleanCategory(query.category)
  const sort = query.sort === undefined ? "newest" : cleanSort(query.sort)
  const cursor = options.withoutCursor === true ? "" : query.cursor === undefined ? "" : cleanCursor(query.cursor)

  if (q !== "") {
    params.set("q", q)
  }

  if (category !== "") {
    params.set("category", category)
  }

  if (query.minKobo !== undefined && query.minKobo !== null) {
    const min = koboToNairaInput(query.minKobo)

    if (min !== "") {
      params.set("min", min)
    }
  }

  if (query.maxKobo !== undefined && query.maxKobo !== null) {
    const max = koboToNairaInput(query.maxKobo)

    if (max !== "") {
      params.set("max", max)
    }
  }

  if (sort !== "newest") {
    params.set("sort", sort)
  }

  if (cursor !== "") {
    params.set("cursor", cursor)
  }

  const search = params.toString()

  return search === "" ? options.basePath : `${options.basePath}?${search}`
}

/** The label a sort option shows. */
export function sortLabel(sort: MarketplaceSort): string {
  switch (sort) {
    case "price_low":
      return "Price: low to high"
    case "price_high":
      return "Price: high to low"
    case "best_selling":
      return "Best selling"
    case "newest":
      return "Newest"
  }
}

/** The sentence above the grid: "12 products" / "1 product" / "No products". */
export function resultCountLabel(count: number, total: number): string {
  if (total === 0) {
    return "No products found"
  }

  const noun = total === 1 ? "product" : "products"

  // The count shown is the total the database reports, not the number of cards
  // on this page, so "12 products" on page one and page two agree.
  return `${total} ${noun}`
}
