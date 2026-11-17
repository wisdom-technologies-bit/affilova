"use client"

import Link from "next/link"
import { useState } from "react"

import { listReviewQueueAction } from "@/lib/catalog/actions/admin"
import type { ReviewQueueItem } from "@/lib/catalog/action-types"
import { formatLagosDateTime, timeAgo } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Products waiting for a decision, oldest first.
//
// The oldest is at the top on purpose: the queue is a promise to vendors about
// how long a review takes, and sorting by newest would quietly break it.

export function ReviewQueue({
  initialItems,
  initialCursor,
  initialError = null,
  nowIso,
}: {
  initialItems: readonly ReviewQueueItem[]
  initialCursor: string | null
  initialError?: string | null
  /** The server's clock, so the age column is the same on both sides. */
  nowIso: string
}) {
  const [items, setItems] = useState<ReviewQueueItem[]>([...initialItems])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  const now = new Date(nowIso)

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) {
      return
    }

    setLoading(true)
    setError(null)

    const result = await listReviewQueueAction({ cursor })

    if (result.ok) {
      setItems((current) => [...current, ...result.items])
      setCursor(result.nextCursor)
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  return (
    <div className="space-y-4">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-md border border-border px-6 py-10 text-center">
          <p className="text-sm text-brand-ink">No products are waiting for review.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Products waiting for review, oldest submission first</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Product
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Vendor
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Submitted
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Files
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-border align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      <Link
                        href={`/products/${item.id}`}
                        className="text-brand-ink underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      >
                        {item.title}
                      </Link>
                    </th>
                    <td className="py-3 pr-4 text-brand-ink">{item.businessName}</td>
                    <td className="py-3 pr-4">
                      <span className="block text-brand-ink">{formatLagosDateTime(item.submittedAt)}</span>
                      <span className="block text-xs text-muted-foreground">
                        waiting {timeAgo(item.submittedAt, now)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-brand-ink">{item.fileCount}</td>
                    <td className="py-3 tabular-nums text-brand-ink">{formatNaira(item.priceKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {items.map((item) => (
              <li key={item.id} className="rounded-md border border-border p-4">
                <Link
                  href={`/products/${item.id}`}
                  className="block min-h-[44px] text-sm font-medium text-brand-ink underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  {item.title}
                </Link>
                <p className="text-sm text-brand-ink">{item.businessName}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Submitted {formatLagosDateTime(item.submittedAt)}, waiting {timeAgo(item.submittedAt, now)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.fileCount === 1 ? "1 file" : `${item.fileCount} files`} ·{" "}
                  <span className="tabular-nums">{formatNaira(item.priceKobo)}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {cursor === null ? null : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
