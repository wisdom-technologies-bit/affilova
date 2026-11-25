"use client"

import { ShieldAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import {
  approveWithdrawalAction,
  listWithdrawalsAction,
  rejectWithdrawalAction,
} from "@/lib/payouts/actions"
import {
  ADMIN_QUEUE_TABS,
  type AdminQueuePage,
  type AdminQueueRow,
  type AdminQueueTab,
} from "@/lib/payouts/screen-types"

import { AlertLine, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT_CLASS, WithdrawalStatusBadge } from "./ui"

// The admin withdrawal queue: four tabs, a table (cards on a phone), and Approve
// and Reject dialogs. A person cannot act on their own withdrawal: the buttons
// say so, and the database refuses it too.

export function AdminWithdrawalsQueue({
  currentUserId,
  initialTab,
  initialPage,
  initialError = null,
}: {
  currentUserId: string
  initialTab: AdminQueueTab
  initialPage: AdminQueuePage
  initialError?: string | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<AdminQueueTab>(initialTab)
  const [rows, setRows] = useState<readonly AdminQueueRow[]>(initialPage.rows)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [dialog, setDialog] = useState<{ kind: "approve" | "reject"; row: AdminQueueRow } | null>(null)
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load(next: AdminQueueTab, from: typeof cursor): Promise<void> {
    setLoading(true)
    setError(null)

    const result = await listWithdrawalsAction({ tab: next, cursor: from })

    if (result.ok) {
      setRows(from === null ? result.data.rows : [...rows, ...result.data.rows])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  function choose(next: AdminQueueTab): void {
    setTab(next)
    setRows([])
    setCursor(null)
    setMessage(null)
    void load(next, null)
  }

  async function decide(): Promise<void> {
    if (dialog === null) {
      return
    }

    setWorking(true)
    setDialogError(null)

    const result =
      dialog.kind === "approve"
        ? await approveWithdrawalAction({ withdrawalId: dialog.row.id })
        : await rejectWithdrawalAction({ withdrawalId: dialog.row.id, reason })

    if (result.ok) {
      setMessage(
        dialog.kind === "reject"
          ? "Rejected. The money is back in the user's balance and they have been told."
          : "needsSecondApproval" in result.data && result.data.needsSecondApproval
            ? "Your approval is recorded. A second, different approver is still needed."
            : "Approved. It is queued for the next payout run.",
      )
      setDialog(null)
      setReason("")
      await load(tab, null)
      router.refresh()
    } else {
      setDialogError(result.error)
    }

    setWorking(false)
  }

  function actions(row: AdminQueueRow) {
    if (row.status !== "requested") {
      return row.failureReason === null ? null : <span className="text-sm text-muted-foreground">{row.failureReason}</span>
    }

    if (row.userId === currentUserId) {
      return <span className="text-sm text-muted-foreground">Your own withdrawal: someone else must approve it.</span>
    }

    const alreadyApproved = row.firstApprover !== null && row.firstApprover === currentUserId

    return (
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={alreadyApproved}
          onClick={() => setDialog({ kind: "approve", row })}
        >
          Approve
        </button>
        <button type="button" className={BUTTON_DANGER} onClick={() => setDialog({ kind: "reject", row })}>
          Reject
        </button>
        {alreadyApproved ? (
          <span className="basis-full text-sm text-muted-foreground">You approved this. A second approver is needed.</span>
        ) : null}
      </span>
    )
  }

  const columns: readonly Column<AdminQueueRow>[] = [
    { key: "requested", header: "Requested", render: (row) => formatLagosDateTime(row.requestedAt) },
    { key: "amount", header: "Amount", align: "end", render: (row) => formatNaira(row.grossKobo) },
    { key: "fee", header: "Fee", align: "end", render: (row) => formatNaira(row.feeKobo) },
    { key: "net", header: "Net", align: "end", render: (row) => formatNaira(row.netKobo) },
    { key: "kind", header: "Kind", render: (row) => (row.kind === "auto" ? "Automatic" : "Manual") },
    {
      key: "bank",
      header: "Account",
      render: (row) => (
        <span>
          {row.accountName}
          <br />
          <span className="text-muted-foreground">
            {row.bankName}, ending {row.accountLast4}
          </span>
        </span>
      ),
    },
    {
      key: "flags",
      header: "Checks",
      render: (row) => (
        <span className="flex flex-col gap-1 text-sm">
          {row.isFirst ? <span>First withdrawal for this user</span> : null}
          {row.hasRiskFlag ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <ShieldAlert aria-hidden="true" className="h-4 w-4" />
              Risk flag
            </span>
          ) : null}
          {row.needsTwoApprovers ? (
            <span>
              Approvals: {row.approvals} of 2
              {row.needsSecondApprover ? ", needs a second approver" : ""}
            </span>
          ) : (
            <span>Approvals: {row.approvals} of 1</span>
          )}
          {!row.isFirst && !row.hasRiskFlag && !row.needsTwoApprovers ? <span className="text-muted-foreground">None</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row) => <WithdrawalStatusBadge status={row.status} /> },
    { key: "actions", header: "Action", render: actions },
  ]

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Withdrawal queue" className="flex flex-wrap gap-2">
        {ADMIN_QUEUE_TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => choose(entry.value)}
            className={`min-h-[44px] rounded-md border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
              tab === entry.value ? "border-brand-600 bg-brand-50 text-brand-800" : "border-input text-brand-ink hover:bg-accent"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="space-y-3">
        {message === null ? null : <p role="status" className="rounded-md border border-brand-600/40 bg-brand-50 px-3 py-2 text-sm">{message}</p>}
        {error === null ? null : <AlertLine>{error}</AlertLine>}
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      </div>

      {loading && rows.length === 0 ? null : (
        <DataTable
          caption="Withdrawals in this tab"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyMessage="Nothing here right now."
        />
      )}

      {cursor !== null ? (
        <button type="button" className={BUTTON_SECONDARY} disabled={loading} onClick={() => void load(tab, cursor)}>
          Load more
        </button>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? undefined : (setDialog(null), setDialogError(null)))}>
        <DialogContent>
          {dialog === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>{dialog.kind === "approve" ? "Approve this withdrawal?" : "Reject this withdrawal?"}</DialogTitle>
                <DialogDescription>
                  {formatNaira(dialog.row.grossKobo)} to {dialog.row.accountName}, {dialog.row.bankName} ending{" "}
                  {dialog.row.accountLast4}.{" "}
                  {dialog.kind === "approve"
                    ? dialog.row.needsTwoApprovers
                      ? "This amount needs two different approvers."
                      : "It will be sent on the next payout run."
                    : "The money goes back to the user's balance and they are emailed the reason."}
                </DialogDescription>
              </DialogHeader>

              {dialog.kind === "reject" ? (
                <div>
                  <label htmlFor="reject-reason" className="block text-sm font-medium text-brand-ink">
                    Reason (at least 10 characters, shown to the user)
                  </label>
                  <textarea
                    id="reject-reason"
                    rows={3}
                    maxLength={300}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className={`${INPUT_CLASS} mt-2 py-2`}
                  />
                </div>
              ) : null}

              {dialogError === null ? null : <AlertLine>{dialogError}</AlertLine>}

              <div className="flex justify-end gap-2">
                <button type="button" className={BUTTON_SECONDARY} disabled={working} onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={dialog.kind === "approve" ? BUTTON_PRIMARY : BUTTON_DANGER}
                  disabled={working || (dialog.kind === "reject" && reason.trim().length < 10)}
                  onClick={() => void decide()}
                >
                  {working ? "Working…" : dialog.kind === "approve" ? "Approve" : "Reject withdrawal"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
