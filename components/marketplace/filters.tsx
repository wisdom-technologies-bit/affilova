import Link from "next/link"

import {
  koboToNairaInput,
  MARKETPLACE_SORTS,
  sortLabel,
  type MarketplaceQuery,
} from "@/lib/marketplace/params"
import type { MarketplaceCategory } from "@/lib/marketplace/types"

import { CARD_FOCUS } from "./product-card"

// The search box and the filters.
//
// Both are plain GET forms to the same path, so they work with JavaScript off,
// the result is a URL a person can share or bookmark, and the back button
// behaves. The search form carries the current filters as hidden fields and the
// filter form carries the current search, so narrowing one does not silently
// drop the other.
//
// The filter panel is a <details> on a phone and a plain sidebar on a wide
// screen. It is rendered twice rather than moved with JavaScript, because a
// layout that only works once a script has run is not a layout.

const FIELD =
  "block w-full min-h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

const LABEL = "block text-sm font-medium text-foreground"

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

export interface SearchFormProps {
  basePath: string
  query: MarketplaceQuery
  /** The id prefix, so two forms on one page never share an id. */
  idPrefix: string
}

export function SearchForm({ basePath, query, idPrefix }: SearchFormProps) {
  const inputId = `${idPrefix}-q`

  return (
    <form action={basePath} method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor={inputId} className="sr-only">
        Search products
      </label>
      <input
        id={inputId}
        type="search"
        name="q"
        defaultValue={query.q}
        maxLength={80}
        placeholder="Search products"
        autoComplete="off"
        className={`${FIELD} sm:flex-1`}
      />
      {query.category === "" ? null : <input type="hidden" name="category" value={query.category} />}
      {query.minKobo === null ? null : (
        <input type="hidden" name="min" value={koboToNairaInput(query.minKobo)} />
      )}
      {query.maxKobo === null ? null : (
        <input type="hidden" name="max" value={koboToNairaInput(query.maxKobo)} />
      )}
      {query.sort === "newest" ? null : <input type="hidden" name="sort" value={query.sort} />}
      <button type="submit" className={BUTTON}>
        Search
      </button>
    </form>
  )
}

export interface FilterFieldsProps {
  basePath: string
  query: MarketplaceQuery
  categories: MarketplaceCategory[]
  /** False on a category page, where the category is the page itself. */
  showCategory: boolean
  idPrefix: string
}

function FilterFields({ basePath, query, categories, showCategory, idPrefix }: FilterFieldsProps) {
  const categoryId = `${idPrefix}-category`
  const minId = `${idPrefix}-min`
  const maxId = `${idPrefix}-max`
  const sortId = `${idPrefix}-sort`

  return (
    <div className="flex flex-col gap-4">
      {/* The search is kept when the filters change, and the cursor is dropped:
          a new filter starts at page one. */}
      {query.q === "" ? null : <input type="hidden" name="q" value={query.q} />}

      {showCategory ? (
        <div>
          <label htmlFor={categoryId} className={LABEL}>
            Category
          </label>
          <select id={categoryId} name="category" defaultValue={query.category} className={`${FIELD} mt-1`}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <fieldset>
        <legend className={LABEL}>Price in naira</legend>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1">
            <label htmlFor={minId} className="sr-only">
              Minimum price in naira
            </label>
            <input
              id={minId}
              name="min"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={koboToNairaInput(query.minKobo)}
              placeholder="Min"
              className={FIELD}
            />
          </div>
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            to
          </span>
          <div className="flex-1">
            <label htmlFor={maxId} className="sr-only">
              Maximum price in naira
            </label>
            <input
              id={maxId}
              name="max"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={koboToNairaInput(query.maxKobo)}
              placeholder="Max"
              className={FIELD}
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor={sortId} className={LABEL}>
          Sort by
        </label>
        <select id={sortId} name="sort" defaultValue={query.sort} className={`${FIELD} mt-1`}>
          {MARKETPLACE_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {sortLabel(sort)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <button type="submit" className={BUTTON}>
          Apply filters
        </button>
        <Link
          href={basePath}
          className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground ${CARD_FOCUS}`}
        >
          Clear filters
        </Link>
      </div>
    </div>
  )
}

/** The sidebar, on a wide screen. */
export function FiltersSidebar(props: FilterFieldsProps) {
  return (
    <form action={props.basePath} method="get" aria-label="Filter products" className="hidden lg:block">
      <FilterFields {...props} />
    </form>
  )
}

/** The collapsible panel, on a phone. */
export function FiltersDisclosure(props: FilterFieldsProps) {
  return (
    <details className="rounded-lg border border-border px-4 py-3 lg:hidden">
      <summary className={`cursor-pointer text-sm font-medium text-foreground ${CARD_FOCUS}`}>
        Filters and sorting
      </summary>
      <form action={props.basePath} method="get" aria-label="Filter products" className="mt-4">
        <FilterFields {...props} />
      </form>
    </details>
  )
}
