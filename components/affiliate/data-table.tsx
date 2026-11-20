import type { ReactNode } from "react"

// One table, two shapes: a real table on a wide screen and one card per row on a
// narrow one. The same columns feed both, so a fact cannot be missing from the
// phone.
//
// The table has a caption for screen readers, real column headers with scope,
// and a row header in the first column. Numeric columns are right aligned and
// tabular so the eye can compare them.

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: "start" | "end"
  /** false hides the column in the mobile card (a redundant badge, say). */
  card?: boolean
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
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  const cardColumns = columns.filter((column) => column.card !== false)

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`py-2 pr-4 font-medium last:pr-0 ${
                    column.align === "end" ? "text-right" : ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border align-middle">
                {columns.map((column, index) => {
                  const content = column.render(row)
                  const align = column.align === "end" ? "text-right tabular-nums" : "text-left"

                  if (index === 0) {
                    return (
                      <th key={column.key} scope="row" className={`py-3 pr-4 font-medium ${align}`}>
                        {content}
                      </th>
                    )
                  }

                  return (
                    <td key={column.key} className={`py-3 pr-4 last:pr-0 ${align}`}>
                      {content}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-md border border-border p-4">
            <dl className="space-y-2">
              {cardColumns.map((column, index) => (
                <div key={column.key} className={index === 0 ? "text-sm font-medium text-brand-ink" : "flex items-baseline justify-between gap-3"}>
                  {index === 0 ? (
                    column.render(row)
                  ) : (
                    <>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {column.header}
                      </dt>
                      <dd className="text-right text-sm tabular-nums text-brand-ink">
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
    </>
  )
}
