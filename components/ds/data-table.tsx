import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { EmptyState } from "./empty-state"
import { InlineAlert } from "./inline-alert"

// A table, and the same table as cards on a phone.
//
// One set of column definitions feeds both shapes, so a fact cannot be on the
// desktop table and missing from the phone. The rules:
//
//   * a real <table> with a <caption> for screen readers, <th scope="col"> for
//     every column and <th scope="row"> for the first cell of every row, so a
//     screen reader can say "Commission, 12 Nov, ₦1,200";
//   * numeric columns are right aligned and tabular, so a column of money lines
//     up on the decimal;
//   * the header sticks while the body scrolls (56px down, which is the app
//     shell's topbar) and is opaque, so a row never shows through it;
//   * sorting and "load more" are links, not buttons. The state lives in the URL,
//     the page can be shared or bookmarked, and the table works before any
//     JavaScript loads. That is also why this component has no hooks: it can be
//     rendered on the server, in a test, or inside a client panel;
//   * loading, empty and error are states of the same table rather than three
//     different layouts, so the page does not jump between them.

/** One column. The same definition draws the header, the cell and the card row. */
export interface DataColumn<Row> {
  /** A stable key: the column name, not the index. */
  key: string
  /** The column heading. Sentence case, and specific: "Commission", not "Value". */
  header: string
  /** The cell. Return text, a badge, a link, a Money. */
  render: (row: Row) => ReactNode
  /** `end` right aligns and sets tabular figures. Use it for every number. */
  align?: "start" | "end"
  /** false keeps the column out of the phone card, for a redundant badge. */
  card?: boolean
  /** The word used in the phone card when the header is too long for a phone. */
  cardLabel?: string
  /** The header is visually hidden, for a column whose meaning is in the cell. */
  hideHeader?: boolean
}

/** The current sort, and where each sortable column links to. */
export interface DataTableSort {
  /** The column key being sorted, and the direction. */
  state: { column: string; direction: "asc" | "desc" }
  /** Column key to href. Sorting is a navigation, so it survives a reload. */
  links: Readonly<Record<string, string>>
}

export interface DataTableEmpty {
  /** What is missing: "No commissions in this range". */
  title: string
  /** Why, and what to do: one or two sentences. */
  description?: string
  /** The one action that would create a row, if there is one. */
  action?: ReactNode
}

export interface DataTableProps<Row> {
  /** The table's accessible name: what it lists, and for which range. */
  caption: string
  columns: readonly DataColumn<Row>[]
  rows: readonly Row[]
  /** A stable identity for each row. */
  rowKey: (row: Row) => string
  /** Shown when there are no rows and nothing went wrong. */
  empty: DataTableEmpty
  /** Draws skeleton rows in place of the body. */
  loading?: boolean
  /** How many skeleton rows to draw while loading. */
  loadingRows?: number
  /** A read failure. Drawn above the table as a danger alert. */
  error?: string | null
  /** Adds the sort affordance to the header. Omit for an unsorted list. */
  sort?: DataTableSort
  /** A link to the next page, drawn under the table. */
  loadMore?: { href: string; label?: string }
  /** Sticks the header 56px down, under the app shell's topbar. */
  stickyHeader?: boolean
  className?: string
}

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr aria-hidden="true" className="border-b border-border">
      {Array.from({ length: columns }, (_, index) => (
        <td key={index} className="px-3 py-3">
          <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-surface-muted" />
        </td>
      ))}
    </tr>
  )
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  loading = false,
  loadingRows = 4,
  error = null,
  sort,
  loadMore,
  stickyHeader = true,
  className,
}: DataTableProps<Row>) {
  const cardColumns = columns.filter((column) => column.card !== false)

  if (error !== null) {
    return (
      <InlineAlert tone="danger" title="This list did not load">
        {error}
      </InlineAlert>
    )
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={empty.title} description={empty.description} primaryAction={empty.action} />
  }

  return (
    <div className={className}>
      {/* The table, from md up. */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-dense">
          <caption className="sr-only">{caption}</caption>

          <thead>
            <tr className="border-b border-border">
              {columns.map((column) => {
                const active = sort?.state.column === column.key
                const href = sort?.links[column.key]
                const ariaSort = active ? (sort?.state.direction === "asc" ? "ascending" : "descending") : "none"

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={sort === undefined ? undefined : ariaSort}
                    className={cn(
                      "whitespace-nowrap bg-surface-subtle px-3 py-2 text-left font-medium text-text-muted",
                      column.align === "end" ? "text-right" : undefined,
                      stickyHeader ? "sticky top-14 z-10" : undefined,
                    )}
                  >
                    {column.hideHeader ? (
                      <span className="sr-only">{column.header}</span>
                    ) : href === undefined ? (
                      column.header
                    ) : (
                      <a
                        href={href}
                        className="inline-flex items-center gap-1 rounded-sm underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-ring"
                      >
                        {column.header}
                        {active ? (
                          sort?.state.direction === "asc" ? (
                            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 text-text-subtle" />
                        )}
                      </a>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {loading
              ? Array.from({ length: loadingRows }, (_, index) => (
                  <SkeletonRow key={`skeleton-${index}`} columns={columns.length} />
                ))
              : rows.map((row) => (
                  <tr key={rowKey(row)} className="border-b border-border last:border-b-0 hover:bg-surface-subtle">
                    {columns.map((column, index) => {
                      const content = column.render(row)
                      const cellClass = cn(
                        "px-3 py-2.5 align-middle",
                        column.align === "end" ? "tabular text-right" : "text-left",
                      )

                      if (index === 0) {
                        return (
                          <th key={column.key} scope="row" className={cn(cellClass, "font-medium text-foreground")}>
                            {content}
                          </th>
                        )
                      }

                      return (
                        <td key={column.key} className={cn(cellClass, "text-foreground")}>
                          {content}
                        </td>
                      )
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* The same rows as cards, below md. */}
      <ul className="space-y-2 md:hidden">
        {loading
          ? Array.from({ length: loadingRows }, (_, index) => (
              <li
                key={`skeleton-${index}`}
                aria-hidden="true"
                className="rounded-md border border-border px-3 py-3"
              >
                <span className="block h-3 w-1/2 animate-pulse rounded-sm bg-surface-muted" />
                <span className="mt-2 block h-3 w-2/3 animate-pulse rounded-sm bg-surface-muted" />
              </li>
            ))
          : rows.map((row) => (
              <li key={rowKey(row)} className="rounded-md border border-border px-3 py-3">
                <dl className="space-y-1.5">
                  {cardColumns.map((column, index) => (
                    <div
                      key={column.key}
                      className={cn(
                        index === 0
                          ? "text-body font-medium text-foreground"
                          : "flex items-baseline justify-between gap-3",
                      )}
                    >
                      {index === 0 ? (
                        column.render(row)
                      ) : (
                        <>
                          <dt className="text-caption text-text-muted">{column.cardLabel ?? column.header}</dt>
                          <dd
                            className={cn(
                              "text-right text-small text-foreground",
                              column.align === "end" ? "tabular" : undefined,
                            )}
                          >
                            {column.render(row)}
                          </dd>
                        </>
                      )}
                    </div>
                  ))}
                </dl>
              </li>
            ))}
      </ul>

      {loadMore === undefined ? null : (
        <div className="mt-4 flex justify-center">
          <a
            href={loadMore.href}
            className="focus-ring inline-flex h-control-md items-center justify-center rounded-md border border-border-control bg-background px-4 text-small font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
          >
            {loadMore.label ?? "Load more"}
          </a>
        </div>
      )}
    </div>
  )
}
