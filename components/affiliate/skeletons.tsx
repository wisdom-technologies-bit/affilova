// Loading shapes.
//
// A skeleton is a placeholder with the size of the thing that is coming, so the
// page does not jump when the data arrives. It is hidden from screen readers,
// which hear one short "Loading" instead, because a row of grey blocks is noise
// to them.

export function SkeletonRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <p className="sr-only" role="status">
        {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex items-center gap-4 rounded-md border border-border px-4 py-4"
        >
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-4 w-1/6 rounded bg-muted" />
          <div className="h-4 w-1/6 rounded bg-muted" />
          <div className="ml-auto h-4 w-1/5 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ cards = 3, label = "Loading" }: { cards?: number; label?: string }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <p className="sr-only" role="status">
        {label}
      </p>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} aria-hidden="true" className="rounded-md border border-border p-4">
          <div className="h-4 w-1/2 rounded bg-muted" />
          <div className="mt-3 h-3 w-3/4 rounded bg-muted" />
          <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonKpis({ cards = 4, label = "Loading the numbers" }: { cards?: number; label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <p className="sr-only" role="status">
        {label}
      </p>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} aria-hidden="true" className="rounded-md border border-border px-4 py-3">
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="mt-3 h-5 w-1/2 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
