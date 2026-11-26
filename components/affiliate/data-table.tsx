import type { ReactNode } from "react"

import { DataTable as DsDataTable } from "@/components/ds/data-table"

// One table, two shapes: a real table on a wide screen and one card per row on a
// narrow one. The same columns feed both, so a fact cannot be missing from the
// phone.
//
// This is the affiliate screens' name for the design system's DataTable, kept so
// every existing call site still compiles. The rules the table keeps live in
// components/ds/data-table: a caption for screen readers, real column headers
// with scope, a row header in the first column, right-aligned tabular numbers,
// a sticky header, and loading, empty and error as states of the same table.

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: "start" | "end"
  /** false hides the column in the mobile card (a redundant badge, say). */
  card?: boolean
  /** A shorter heading for the phone card, when the full one wraps. */
  cardLabel?: string
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyMessage,
}: {
  caption: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  emptyMessage: string
}) {
  return (
    <DsDataTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={rowKey}
      empty={{ title: emptyMessage }}
    />
  )
}
