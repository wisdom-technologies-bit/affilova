"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { cancelWithdrawalAction } from "@/lib/payouts/actions"
import type { ScreenWithdrawal } from "@/lib/payouts/screen-types"

import { AlertLine, BUTTON_DANGER, BUTTON_SECONDARY, WithdrawalStatusBadge } from "./ui"

// The user's last withdrawals: a table on a wide screen, one card per row on a
// phone. Status is a word and an icon. A requested withdrawal can be cancelled,
// after one confirming click, and the money goes straight back to the balance.

export function WithdrawalHistory({
  withdrawals,
  initialConfirming = null,
  initialError = null,
}: {
  withdrawals: readonly ScreenWithdrawal[]
  /** Test hook: render with the confirm step already open for this id. */
  initialConfirming?: string | null
  initialError?: string | null
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<string | null>(initialConfirming)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function cancel(id: string): Promise<void> {
    setBusy(true)
    setError(null)

    const result = await cancelWithdrawalAction({ withdrawalId: id })

    if (result.ok) {
      setConfirming(null)
      router.refresh()
    } else {
      setError(result.error)
    }

    setBusy(false)
  }

  function actions(row: ScreenWithdrawal) {
    if (row.status !== "requested") {
      return row.status === "rejected" && row.reason !== null ? (
        <span className="text-dense text-text-muted">Reason: {row.reason}</span>
      ) : null
    }

    if (confirming === row.id) {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON_DANGER} disabled={busy} onClick={() => void cancel(row.id)}>
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => setConfirming(null)}>
            Keep it
          </button>
        </span>
      )
    }

    return (
      <button type="button" className={BUTTON_SECONDARY} onClick={() => setConfirming(row.id)}>
        Cancel
      </button>
    )
  }

  const columns: readonly Column<ScreenWithdrawal>[] = [
    { key: "requested", header: "Requested", render: (row) => formatLagosDateTime(row.requestedAt) },
    { key: "amount", header: "Amount", align: "end", render: (row) => formatNaira(row.grossKobo) },
    { key: "fee", header: "Fee", align: "end", render: (row) => formatNaira(row.feeKobo) },
    { key: "net", header: "You receive", align: "end", render: (row) => formatNaira(row.netKobo) },
    { key: "kind", header: "Type", render: (row) => (row.kind === "auto" ? "Automatic" : "Requested by you") },
    { key: "status", header: "Status", render: (row) => <WithdrawalStatusBadge status={row.status} /> },
    { key: "actions", header: "Action", render: actions },
  ]

  return (
    <div className="space-y-3">
      {error === null ? null : <AlertLine>{error}</AlertLine>}
      <DataTable
        caption="Your recent withdrawals"
        columns={columns}
        rows={withdrawals}
        rowKey={(row) => row.id}
        emptyMessage="No withdrawals yet. When you withdraw, or an automatic payout runs, it appears here."
      />
    </div>
  )
}
