"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { DataTable, type Column } from "@/components/affiliate/data-table"
import { SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { decideRefundAction } from "@/lib/commerce/actions"
import { getVendorRefundRequestsAction } from "@/lib/merchant/actions"
import { refundStatusLabel, type Page, type VendorRefundRow } from "@/lib/merchant/types"
import {
  MIN_REJECT_NOTE,
  charactersNeeded,
  rejectNoteError,
} from "@/lib/refunds/validation"

// The refund requests on the vendor's own orders.
//
// A request that is still waiting has two buttons: Approve, which approves the
// refund, and Reject, which needs a reason of at least 10 characters so the buyer
// is told why. Both go through the existing decideRefundAction unchanged; the
// database checks again that this vendor owns the order and that the request has
// not already been decided.
//
// No buyer name and no buyer email is shown, because none is returned.

export function RefundRequestsPanel({
  initialPage,
  initialError = null,
}: {
  initialPage: Page<VendorRefundRow>
  initialError?: string | null
}) {
  const router = useRouter()
  const [items, setItems] = useState<VendorRefundRow[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [loadingMore, setLoadingMore] = useState(false)

  async function decide(
    request: VendorRefundRow,
    decision: "approve" | "reject",
  ): Promise<void> {
    const trimmed = note.trim()

    if (decision === "reject") {
      const problem = rejectNoteError(note)

      if (problem !== null) {
        setError(problem)
        return
      }
    }

    setWorking(true)
    setError(null)

    const result = await decideRefundAction({
      requestId: request.requestId,
      decision,
      note: trimmed === "" ? undefined : trimmed,
    })

    if (result.ok) {
      setItems((current) =>
        current.map((row) =>
          row.requestId === request.requestId
            ? { ...row, status: decision === "approve" ? "approved" : "rejected" }
            : row,
        ),
      )
      setOpen(null)
      setNote("")
      router.refresh()
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  async function loadMore(): Promise<void> {
    if (cursor === null || loadingMore) {
      return
    }

    setLoadingMore(true)
    setError(null)

    const result = await getVendorRefundRequestsAction({ limit: 20, cursor })

    if (result.ok) {
      setItems((current) => [...current, ...result.data.items])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setLoadingMore(false)
  }

  if (error !== null && items.length === 0) {
    return <ErrorNotice message={error} />
  }

  const columns: readonly Column<VendorRefundRow>[] = [
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
      key: "reason",
      header: "Reason",
      render: (row) => <span className="text-sm text-brand-ink">{row.reason}</span>,
    },
    {
      key: "requested",
      header: "Requested",
      render: (row) => formatLagosDateTime(row.requestedAt),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      render: (row) => formatNaira(row.amountKobo),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill status={pillStatus(row.status)} label={refundStatusLabel(row.status)} />
      ),
    },
    {
      key: "actions",
      header: "Decision",
      render: (row) =>
        row.status === "requested" ? (
          <div className="flex flex-wrap gap-2">
            <Dialog
              open={open === `${row.requestId}-approve`}
              onOpenChange={(next) => {
                setOpen(next ? `${row.requestId}-approve` : null)
                setNote("")
                setError(null)
              }}
            >
              <DialogTrigger className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
                Approve
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve this refund?</DialogTitle>
                  <DialogDescription>
                    {formatNaira(row.amountKobo)} goes back to the buyer for order {row.orderNumber}
                    , and the files from that order stop being downloadable.
                  </DialogDescription>
                </DialogHeader>

                {error === null ? null : <ErrorNotice message={error} />}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    disabled={working}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void decide(row, "approve")
                    }}
                    disabled={working}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {working ? "Saving…" : "Approve refund"}
                  </button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog
              open={open === `${row.requestId}-reject`}
              onOpenChange={(next) => {
                setOpen(next ? `${row.requestId}-reject` : null)
                setNote("")
                setError(null)
              }}
            >
              <DialogTrigger className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
                Reject
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject this refund?</DialogTitle>
                  <DialogDescription>
                    The buyer keeps their files and the money stays as it is. Tell them why, in at
                    least {MIN_REJECT_NOTE} characters.
                  </DialogDescription>
                </DialogHeader>

                <div>
                  <label
                    htmlFor={`reject-note-${row.requestId}`}
                    className="block text-sm font-medium text-brand-ink"
                  >
                    Reason for the buyer
                  </label>
                  <textarea
                    id={`reject-note-${row.requestId}`}
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 1000))}
                    maxLength={1000}
                    rows={3}
                    aria-describedby={`reject-help-${row.requestId}`}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  />
                  <p id={`reject-help-${row.requestId}`} className="mt-1 text-xs text-muted-foreground">
                    {note.trim().length < MIN_REJECT_NOTE
                      ? `${charactersNeeded(note, MIN_REJECT_NOTE)} more characters needed.`
                      : "Ready to send."}
                  </p>
                </div>

                {error === null ? null : <ErrorNotice message={error} />}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    disabled={working}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void decide(row, "reject")
                    }}
                    disabled={working || rejectNoteError(note) !== null}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {working ? "Saving…" : "Reject request"}
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {row.decidedAt === null ? "—" : formatLagosDateTime(row.decidedAt)}
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      {error === null ? null : <ErrorNotice message={error} />}

      <DataTable
        caption="Refund requests"
        columns={columns}
        rows={items}
        rowKey={(row) => row.requestId}
        emptyMessage="No refund requests yet."
      />

      <div className="flex items-center gap-3">
        {cursor === null ? null : (
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            disabled={loadingMore}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {loadingMore ? "Loading more requests" : ""}
        </p>
      </div>
    </div>
  )
}

/** The loading shape, used while the first page is on its way. */
export function RefundRequestsLoading() {
  return <SkeletonRows rows={3} label="Loading refund requests" />
}
