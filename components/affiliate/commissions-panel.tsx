"use client"

import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import { formatCount } from "@/lib/affiliate/definitions"
import { getCommissionsAction } from "@/lib/affiliate/read-actions"
import type { Balance, CommissionRow, Page } from "@/lib/affiliate/read-types"
import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Earnings: what is held, what has cleared, and every commission behind them.
//
// The hold is explained with the number of days the platform actually stores,
// not a number this page chose. Withdrawals are not built yet, and the page says
// so plainly instead of showing a button that cannot work.

export function BalanceSummary({ balance }: { balance: Balance }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-border px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pending
        </dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums text-brand-ink">
          {formatNaira(balance.pendingKobo)}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">Still inside the hold.</dd>
      </div>
      <div className="rounded-md border border-border px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Available
        </dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums text-brand-ink">
          {formatNaira(balance.availableKobo)}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">Cleared the hold.</dd>
      </div>
      <div className="rounded-md border border-border px-4 py-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Total
        </dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums text-brand-ink">
          {formatNaira(balance.totalKobo)}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">Everything credited, minus refunds.</dd>
      </div>
    </dl>
  )
}

export function CommissionsPanel({
  initialPage,
  initialError,
  balance,
  holdDays,
  loading: initialLoading = false,
}: {
  initialPage: Page<CommissionRow>
  initialError: string | null
  balance: Balance
  holdDays: number
  /** True while the first page is still on its way. */
  loading?: boolean
}) {
  const [items, setItems] = useState<CommissionRow[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function loadMore(): Promise<void> {
    if (cursor === null || busy) {
      return
    }

    setBusy(true)
    setError(null)

    const result = await getCommissionsAction({ limit: 20, cursor })

    if (result.ok) {
      setItems((current) => [...current, ...result.data.items])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  const columns: readonly Column<CommissionRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (row) => (
        <span className="text-brand-ink">
          {row.orderNumber}
          <span className="block text-xs font-normal text-muted-foreground">{row.productTitle}</span>
        </span>
      ),
    },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      render: (row) => formatNaira(row.commissionKobo),
    },
    {
      key: "status",
      header: "Order status",
      render: (row) => <StatusPill status={pillStatus(row.status)} />,
    },
    {
      key: "paid",
      header: "Paid",
      render: (row) => formatLagosDate(row.paidAt),
    },
    {
      key: "available",
      header: "Hold ends",
      render: (row) =>
        row.availableAt === null ? "Not held" : formatLagosDate(row.availableAt),
    },
  ]

  return (
    <div className="space-y-6">
      <BalanceSummary balance={balance} />

      {balance.negative ? (
        <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          Your balance is below zero by {formatNaira(Math.abs(balance.totalKobo))}. A refunded sale
          can do this. New commission pays it back first.
        </p>
      ) : null}

      <div className="rounded-md border border-border px-4 py-3 text-sm text-brand-ink">
        <p>
          Commission is held for {formatCount(holdDays)} {holdDays === 1 ? "day" : "days"} after an
          order is paid, then it moves from pending to available.
        </p>
        <p className="mt-2 text-muted-foreground">Withdrawals are not available yet.</p>
      </div>

      {error === null ? null : <ErrorNotice message={error} />}

      {initialLoading || (busy && items.length === 0) ? (
        <SkeletonRows rows={4} label="Loading your commissions" />
      ) : (
        <DataTable
          caption="Your commissions, newest first"
          columns={columns}
          rows={items}
          rowKey={(row) => `${row.orderNumber}-${row.paidAt ?? ""}-${row.commissionKobo}`}
          emptyMessage="No commission yet. When an order through your link is paid, it appears here."
        />
      )}

      {busy ? <SkeletonRows rows={2} label="Loading more commissions" /> : null}

      {cursor !== null && !busy ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  )
}
