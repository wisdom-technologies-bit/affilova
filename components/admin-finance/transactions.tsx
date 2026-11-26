"use client"

import Link from "next/link"
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
import { formatLagosDate, formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import {
  decideDisputeAction,
  listDisputesAction,
  listLedgerAction,
  listOrdersAction,
  listRefundsAction,
  retryRefundSubmissionAction,
} from "@/lib/admin/finance-actions"
import type {
  DisputeQueueRow,
  LedgerPage,
  LedgerTransaction,
  OrderDetail,
  OrderRow,
  Page,
  ReconciliationRun,
  RefundQueueRow,
  TrialBalance,
} from "@/lib/admin/screen-types"

import {
  AlertLine,
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  DetailList,
  DetailRow,
  EmptyBlock,
  INPUT_CLASS,
  LABEL_CLASS,
  LoadingLine,
  Money,
  QuietLine,
  Section,
  StatusTag,
  type Tone,
} from "./ui"

// The transactions screens: orders, refunds, disputes, ledger, reconciliation.
//
// Every list is server-driven: a filter change asks a server action, which asks
// the database, which checks the role again. Nothing is filtered in the browser,
// so a list can never show a row the person is not allowed to see.

const ORDER_STATUSES = ["paid", "pending", "refunded", "disputed", "expired", "failed"] as const
const REFUND_STATUSES = ["requested", "approved", "processed", "failed", "rejected"] as const

function orderTone(status: string): Tone {
  if (status === "paid") return "positive"
  if (status === "disputed" || status === "failed") return "danger"
  if (status === "refunded" || status === "pending") return "warning"
  return "neutral"
}

function refundTone(status: string): Tone {
  if (status === "processed") return "positive"
  if (status === "failed" || status === "rejected") return "danger"
  if (status === "requested") return "warning"
  return "neutral"
}

function Pager({
  page,
  onMore,
  loading,
}: {
  page: Page<unknown>
  onMore: () => void
  loading: boolean
}) {
  if (page.nextCursor === null) {
    return null
  }

  return (
    <div className="mt-3 flex justify-center">
      <button type="button" className={BUTTON_SECONDARY} onClick={onMore} disabled={loading}>
        {loading ? "Loading" : "Load more"}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export function OrdersView({
  initialPage,
  initialError = null,
  initialQuery,
}: {
  initialPage: Page<OrderRow>
  initialError?: string | null
  initialQuery: { q: string; status: string; from: string; to: string }
}) {
  const [rows, setRows] = useState<readonly OrderRow[]>(initialPage.rows)
  const [page, setPage] = useState<Page<OrderRow>>(initialPage)
  const [q, setQ] = useState(initialQuery.q)
  const [status, setStatus] = useState(initialQuery.status)
  const [from, setFrom] = useState(initialQuery.from)
  const [to, setTo] = useState(initialQuery.to)
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  const load = async (cursor?: string): Promise<void> => {
    setLoading(true)
    setError(null)

    const result = await listOrdersAction({
      q,
      status: status === "" ? undefined : status,
      from: from === "" ? undefined : from,
      to: to === "" ? undefined : to,
      cursor,
    })

    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setRows(cursor === undefined ? result.data.rows : [...rows, ...result.data.rows])
    setPage(result.data)
  }

  const columns: readonly Column<OrderRow>[] = [
    {
      key: "number",
      header: "Order",
      render: (row) => (
        <Link href={`/transactions/orders/${row.id}`} className="font-medium text-brand-600 underline underline-offset-2">
          {row.number}
        </Link>
      ),
    },
    { key: "product", header: "Product", render: (row) => row.productTitle ?? "Not recorded" },
    { key: "vendor", header: "Vendor", render: (row) => row.vendorName ?? "Not recorded" },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusTag tone={orderTone(row.status)}>{row.status}</StatusTag>,
    },
    { key: "total", header: "Total", align: "end", render: (row) => <Money kobo={row.totalKobo} /> },
    {
      key: "paid",
      header: "Paid",
      render: (row) => (row.paidAt === null ? "Not paid" : formatLagosDateTime(row.paidAt)),
    },
    { key: "buyer", header: "Buyer", render: (row) => row.maskedEmail },
    { key: "affiliate", header: "Affiliate", render: (row) => (row.hasAffiliate ? "Yes" : "No") },
  ]

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <div className="xl:col-span-2">
          <label className={LABEL_CLASS} htmlFor="order-search">
            Order number, reference or exact email
          </label>
          <input
            id="order-search"
            className={INPUT_CLASS}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="AFV-1001"
            autoComplete="off"
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="order-status">
            Status
          </label>
          <select
            id="order-status"
            className={INPUT_CLASS}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any status</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="order-from">
            From
          </label>
          <input
            id="order-from"
            type="date"
            className={INPUT_CLASS}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="order-to">
            To
          </label>
          <input
            id="order-to"
            type="date"
            className={INPUT_CLASS}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2 xl:col-span-5">
          <button type="submit" className={BUTTON_PRIMARY} disabled={loading}>
            {loading ? "Searching" : "Search"}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {error === null ? null : <AlertLine message={error} />}
        {loading ? <LoadingLine label="Loading orders" /> : null}
      </div>

      <div className="hidden md:block">
        <DataTable
          caption="Orders"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyMessage="No order matches this search. An email has to be complete and exact."
        />
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <li>
            <EmptyBlock title="No order matches this search" hint="An email has to be complete and exact." />
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/transactions/orders/${row.id}`}
                  className="font-semibold text-brand-600 underline underline-offset-2"
                >
                  {row.number}
                </Link>
                <StatusTag tone={orderTone(row.status)}>{row.status}</StatusTag>
              </div>
              <p className="mt-1 text-dense text-foreground">{row.productTitle ?? "Not recorded"}</p>
              <p className="text-dense text-text-muted">
                {row.vendorName ?? "Not recorded"} · {row.maskedEmail}
              </p>
              <p className="mt-1 text-dense font-medium tabular-nums">{formatNaira(row.totalKobo)}</p>
              <p className="text-caption text-text-muted">
                {row.paidAt === null ? "Not paid" : `Paid ${formatLagosDateTime(row.paidAt)}`}
              </p>
            </li>
          ))
        )}
      </ul>

      <Pager page={page} loading={loading} onMore={() => void load(page.nextCursor ?? undefined)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export function RefundsView({
  initialPage,
  initialError = null,
  initialStatus = "",
  canManage,
}: {
  initialPage: Page<RefundQueueRow>
  initialError?: string | null
  initialStatus?: string
  canManage: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<readonly RefundQueueRow[]>(initialPage.rows)
  const [page, setPage] = useState<Page<RefundQueueRow>>(initialPage)
  const [status, setStatus] = useState(initialStatus)
  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (nextStatus: string): Promise<void> => {
    setLoading(true)
    setError(null)

    const result = await listRefundsAction({ status: nextStatus === "" ? undefined : nextStatus })

    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setRows(result.data.rows)
    setPage(result.data)
  }

  const retry = async (row: RefundQueueRow): Promise<void> => {
    setLoading(true)
    setError(null)
    setNotice(null)

    const result = await retryRefundSubmissionAction({ requestId: row.id })

    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setNotice(`Queued again for ${row.orderNumber}. The next run will submit it to Paystack.`)
    await load(status)
    router.refresh()
  }

  const columns: readonly Column<RefundQueueRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (row) => (
        <Link href={`/transactions/orders/${row.orderId}`} className="font-medium text-brand-600 underline underline-offset-2">
          {row.orderNumber}
        </Link>
      ),
    },
    { key: "product", header: "Product", render: (row) => row.productTitle ?? "Not recorded" },
    { key: "amount", header: "Amount", align: "end", render: (row) => <Money kobo={row.amountKobo} /> },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusTag tone={refundTone(row.status)}>{row.status}</StatusTag>,
    },
    { key: "auto", header: "Auto approved", render: (row) => (row.autoApproved ? "Yes" : "No") },
    {
      key: "requested",
      header: "Requested",
      render: (row) => (row.requestedAt === null ? "Not recorded" : formatLagosDateTime(row.requestedAt)),
    },
    {
      key: "decided",
      header: "Decided",
      render: (row) => (row.decidedAt === null ? "Waiting" : formatLagosDateTime(row.decidedAt)),
    },
    { key: "reference", header: "Paystack reference", render: (row) => (row.hasProviderReference ? "Recorded" : "None") },
    {
      key: "actions",
      header: "Action",
      render: (row) => {
        if (!canManage) {
          return <span className="text-dense text-text-muted">Finance or admin</span>
        }

        if (row.status === "requested") {
          return (
            <Link href={`/transactions/orders/${row.orderId}`} className="text-dense font-semibold text-brand-600 underline underline-offset-2">
              Approve or reject
            </Link>
          )
        }

        if (row.status === "failed") {
          return (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void retry(row)} disabled={loading}>
              Retry
            </button>
          )
        }

        return <span className="text-dense text-text-muted">Nothing to do</span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={LABEL_CLASS} htmlFor="refund-status">
            Status
          </label>
          <select
            id="refund-status"
            className={INPUT_CLASS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              void load(event.target.value)
            }}
          >
            <option value="">Any status</option>
            {REFUND_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div aria-live="polite" className="space-y-1">
        {error === null ? null : <AlertLine message={error} />}
        {notice === null ? null : <p className="text-dense font-medium text-foreground">{notice}</p>}
        {loading ? <LoadingLine label="Loading refunds" /> : null}
      </div>

      <DataTable
        caption="Refund requests"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage="No refund request has this status."
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export function DisputesView({
  initialPage,
  initialError = null,
  canDecide,
}: {
  initialPage: Page<DisputeQueueRow>
  initialError?: string | null
  canDecide: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<readonly DisputeQueueRow[]>(initialPage.rows)
  const [error, setError] = useState<string | null>(initialErr(initialError))
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ row: DisputeQueueRow; outcome: "won" | "lost" } | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    const result = await listDisputesAction({})

    if (result.ok) {
      setRows(result.data.rows)
    }
  }

  async function submit(): Promise<void> {
    if (dialog === null) {
      return
    }

    setBusy(true)
    setError(null)

    const result = await decideDisputeAction({
      orderId: dialog.row.orderId,
      outcome: dialog.outcome,
      note,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setNotice(
      dialog.outcome === "won"
        ? `${dialog.row.orderNumber} stays with the buyer: the downloads are available again and the vendor keeps the money.`
        : `${dialog.row.orderNumber} is refunded: the downloads stay revoked and the vendor's balance is reversed.`,
    )
    setDialog(null)
    setNote("")
    await refresh()
    router.refresh()
  }

  const columns: readonly Column<DisputeQueueRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (row) => (
        <Link href={`/transactions/orders/${row.orderId}`} className="font-medium text-brand-600 underline underline-offset-2">
          {row.orderNumber}
        </Link>
      ),
    },
    { key: "product", header: "Product", render: (row) => row.productTitle ?? "Not recorded" },
    { key: "amount", header: "Amount", align: "end", render: (row) => <Money kobo={row.amountKobo} /> },
    { key: "buyer", header: "Buyer", render: (row) => row.maskedEmail },
    { key: "outcome", header: "Outcome", render: (row) => <StatusTag tone={row.outcome === "open" ? "warning" : "neutral"}>{row.outcome}</StatusTag> },
    {
      key: "provider",
      header: "Paystack said",
      render: (row) => (row.providerResolution === null ? "Nothing yet" : row.providerResolution),
    },
    {
      key: "needs",
      header: "Decision",
      render: (row) =>
        row.needsDecision ? <StatusTag tone="danger">Needs your decision</StatusTag> : <span className="text-dense text-text-muted">Recorded</span>,
    },
    {
      key: "actions",
      header: "Action",
      render: (row) => {
        if (!canDecide || row.outcome !== "open") {
          return <span className="text-dense text-text-muted">Nothing to do</span>
        }

        return (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} onClick={() => setDialog({ row, outcome: "won" })}>
              Won
            </button>
            <button type="button" className={BUTTON_DANGER} onClick={() => setDialog({ row, outcome: "lost" })}>
              Lost
            </button>
          </span>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="space-y-1">
        {error === null ? null : <AlertLine message={error} />}
        {notice === null ? null : <p className="text-dense font-medium text-foreground">{notice}</p>}
      </div>

      <DataTable
        caption="Disputes"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyMessage="No dispute has been opened."
      />

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
            setNote("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.outcome === "won" ? "Mark this dispute as won" : "Mark this dispute as lost"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.outcome === "won"
                ? "The buyer keeps the order. Their downloads become available again and the vendor keeps the money. No refund is sent."
                : "The buyer is refunded. Their downloads stay revoked, the vendor's balance is reversed and the platform fee comes back off revenue. A refund is submitted to Paystack."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-dense text-text-muted">
              Paystack said: <strong>{dialog?.row.providerResolution ?? "nothing recorded yet"}</strong>. You are the
              person who decides, and the note is what the next person reads.
            </p>
            <div>
              <label className={LABEL_CLASS} htmlFor="dispute-note">
                Why (at least 10 characters)
              </label>
              <textarea
                id="dispute-note"
                className={`${INPUT_CLASS} min-h-24 py-2`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
              />
              {note.trim().length > 0 && note.trim().length < 10 ? (
                <p className="mt-1 text-dense text-danger">Write at least 10 characters.</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={dialog?.outcome === "lost" ? BUTTON_DANGER : BUTTON_PRIMARY}
                onClick={() => void submit()}
                disabled={busy || note.trim().length < 10}
              >
                {busy ? "Saving" : dialog?.outcome === "won" ? "Confirm won" : "Confirm lost"}
              </button>
              <button
                type="button"
                className={BUTTON_SECONDARY}
                onClick={() => {
                  setDialog(null)
                  setNote("")
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function initialErr(value: string | null): string | null {
  return value
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export function LedgerView({
  initialPage,
  initialError = null,
  balanced,
}: {
  initialPage: LedgerPage
  initialError?: string | null
  balanced: { balanced: boolean; differenceKobo: bigint } | null
}) {
  const [rows, setRows] = useState<readonly LedgerTransaction[]>(initialPage.rows)
  const [accounts, setAccounts] = useState(initialPage.accounts)
  const [page, setPage] = useState<Page<LedgerTransaction>>(initialPage)
  const [account, setAccount] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  const load = async (cursor?: string): Promise<void> => {
    setLoading(true)
    setError(null)

    const result = await listLedgerAction({
      account: account === "" ? undefined : account,
      from: from === "" ? undefined : from,
      to: to === "" ? undefined : to,
      cursor,
    })

    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setAccounts(result.data.accounts)
    setRows(cursor === undefined ? result.data.rows : [...rows, ...result.data.rows])
    setPage(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={LABEL_CLASS} htmlFor="ledger-account">
            Account
          </label>
          <select
            id="ledger-account"
            className={INPUT_CLASS}
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          >
            <option value="">Every account</option>
            {accounts.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="ledger-from">
            From
          </label>
          <input id="ledger-from" type="date" className={INPUT_CLASS} value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="ledger-to">
            To
          </label>
          <input id="ledger-to" type="date" className={INPUT_CLASS} value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <button type="button" className={BUTTON_PRIMARY} onClick={() => void load()} disabled={loading}>
          {loading ? "Filtering" : "Filter"}
        </button>
      </div>

      {balanced === null ? null : (
        <p className="flex items-center gap-2 text-dense font-medium text-foreground">
          <span aria-hidden="true">{balanced.balanced ? "✓" : "!"}</span>
          {balanced.balanced
            ? "Balanced: every debit has a credit."
            : `Not balanced: the postings differ by ${formatNaira(balanced.differenceKobo)}.`}
        </p>
      )}

      <div aria-live="polite">{error === null ? null : <AlertLine message={error} />}</div>

      {rows.length === 0 ? (
        <EmptyBlock title="No posting in this range" hint="Clear the filters to see the whole ledger." />
      ) : (
        <ul className="space-y-3">
          {rows.map((txn) => (
            <li key={txn.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-foreground">{txn.kind}</p>
                <p className="text-dense text-text-muted">
                  {txn.createdAt === null ? "Not recorded" : formatLagosDateTime(txn.createdAt)}
                </p>
              </div>
              {txn.description === null ? null : <p className="text-dense text-text-muted">{txn.description}</p>}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-dense">
                  <caption className="sr-only">{`Entries of the ${txn.kind} transaction`}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Account
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Party
                      </th>
                      <th scope="col" className="py-1 pr-3 text-right font-semibold">
                        Debit
                      </th>
                      <th scope="col" className="py-1 text-right font-semibold">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {txn.entries.map((entry, index) => (
                      <tr key={`${txn.id}-${entry.accountCode}-${index}`} className="border-b border-border last:border-0">
                        <th scope="row" className="py-1 pr-3 text-left font-medium">
                          {entry.accountCode}
                        </th>
                        <td className="py-1 pr-3">{entry.party ?? "—"}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {entry.debitKobo === BigInt(0) ? "—" : formatNaira(entry.debitKobo)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {entry.creditKobo === BigInt(0) ? "—" : formatNaira(entry.creditKobo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pager page={page} loading={loading} onMore={() => void load(page.nextCursor ?? undefined)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function ReconciliationView({
  balance,
  runs,
  error: initialError = null,
}: {
  balance: TrialBalance
  runs: readonly ReconciliationRun[]
  error?: string | null
}) {
  return (
    <div className="space-y-6">
      <Section
        title="Trial balance"
        description="Every account, its debits, its credits and its balance. The book is balanced when the two grand totals agree."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-dense">
            <caption className="sr-only">Trial balance per ledger account</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Account
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Type
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Debits
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Credits
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {balance.accounts.map((account) => (
                <tr key={account.code} className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {account.name}
                  </th>
                  <td className="py-2 pr-3 text-text-muted">{account.kind}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(account.debitKobo)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(account.creditKobo)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNaira(account.balanceKobo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <th scope="row" colSpan={2} className="py-2 pr-3 text-left">
                  Total
                </th>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(balance.totals.debitKobo)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(balance.totals.creditKobo)}</td>
                <td className="py-2 text-right tabular-nums">{formatNaira(balance.totals.differenceKobo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <dl className="mt-4 space-y-2 text-dense">
          <div className="flex items-center gap-2">
            <span aria-hidden="true">{balance.balanced ? "✓" : "!"}</span>
            <dt className="font-medium text-foreground">Debits equal credits:</dt>
            <dd>{balance.balanced ? "Yes" : `No, off by ${formatNaira(balance.totals.differenceKobo)}`}</dd>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true">{balance.payables.match ? "✓" : "!"}</span>
            <dt className="font-medium text-foreground">Party balances match the payable accounts:</dt>
            <dd>
              {balance.payables.match
                ? "Yes"
                : `No, parties hold ${formatNaira(balance.payables.partySumKobo)} and the accounts ${formatNaira(balance.payables.accountsKobo)}`}
            </dd>
          </div>
        </dl>

        {initialError === null ? null : <AlertLine message={initialError} />}
      </Section>

      <Section
        title="Reconciliation runs"
        description="What Paystack held and what our ledger says we hold, once a day. A small difference is usually money in flight."
      >
        {runs.length === 0 ? (
          <EmptyBlock title="No run recorded yet" hint="The first run happens at 02:00 Lagos time." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-dense">
              <caption className="sr-only">The last reconciliation runs</caption>
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Run
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Ledger
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Paystack
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {run.runAt === null ? "Not recorded" : formatLagosDateTime(run.runAt)}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(run.ledgerBalanceKobo)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(run.providerBalanceKobo)}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden="true">{run.diffKobo === BigInt(0) ? "✓" : "!"}</span>
                        {formatNaira(run.diffKobo)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-dense text-text-muted">
          A difference is not automatically an error. Settlement in flight, a payout Paystack has not confirmed, or a
          fee we have not seen yet all show up here for a day or two.
        </p>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------

export function OrderDetailView({
  detail,
  canManageRefunds,
  canDecideDisputes,
}: {
  detail: OrderDetail
  canManageRefunds: boolean
  canDecideDisputes: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const failed = detail.refundRequests.filter((request) => request.status === "failed")

  const retry = async (requestId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)

    const result = await retryRefundSubmissionAction({ requestId })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setNotice("Queued again. The next run submits it to Paystack.")
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="space-y-1">
        {error === null ? null : <AlertLine message={error} />}
        {notice === null ? null : <p className="text-dense font-medium text-foreground">{notice}</p>}
      </div>

      <Section title="Order">
        <DetailList>
          <DetailRow label="Number">{detail.number}</DetailRow>
          <DetailRow label="Status">
            <StatusTag tone={orderTone(detail.status)}>{detail.status}</StatusTag>
          </DetailRow>
          <DetailRow label="Total">{formatNaira(detail.totalKobo)}</DetailRow>
          <DetailRow label="Subtotal">{formatNaira(detail.subtotalKobo)}</DetailRow>
          <DetailRow label="Tax">
            {formatNaira(detail.taxKobo)} {detail.taxIncluded ? "(included in the price)" : "(added on top)"}
          </DetailRow>
          <DetailRow label="Processor fee">{formatNaira(detail.processorFeeKobo)}</DetailRow>
          <DetailRow label="Paid">
            {detail.paidAt === null ? "Not paid" : formatLagosDateTime(detail.paidAt)}
          </DetailRow>
          <DetailRow label="Created">
            {detail.createdAt === null ? "Not recorded" : formatLagosDateTime(detail.createdAt)}
          </DetailRow>
        </DetailList>
      </Section>

      <Section title="Buyer">
        <DetailList>
          <DetailRow label="Email">
            {detail.buyer.fullEmailVisible
              ? (detail.buyer.email ?? "Not recorded")
              : `${detail.buyer.maskedEmail} (masked for finance)`}
          </DetailRow>
          <DetailRow label="Name">{detail.buyer.name ?? "Not recorded"}</DetailRow>
          <DetailRow label="Vendor">{detail.vendor.businessName ?? "Not recorded"}</DetailRow>
          <DetailRow label="Affiliate">{detail.affiliate?.username ?? "No affiliate"}</DetailRow>
        </DetailList>
        {detail.buyer.fullEmailVisible ? (
          <p className="mt-2 text-caption text-text-muted">
            Opening this page as admin or support is recorded against your account.
          </p>
        ) : null}
      </Section>

      <Section title="The split">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-dense">
            <caption className="sr-only">What each party takes from this order</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Item
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Price
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Platform fee
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Affiliate
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Tax
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Vendor net
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, index) => (
                <tr key={`${item.title}-${index}`} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {item.title}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(item.unitPriceKobo)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(item.platformFeeKobo)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(item.affiliateCommissionKobo)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(item.taxDeductedKobo)}</td>
                  <td className="py-2 text-right tabular-nums">{formatNaira(item.vendorNetKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail.taxLines.length === 0 ? (
          <QuietLine>No tax was charged on this order.</QuietLine>
        ) : (
          <ul className="mt-3 space-y-1 text-dense text-text-muted">
            {detail.taxLines.map((line, index) => (
              <li key={`${line.basis}-${index}`}>
                {line.basis} at {(line.rateBps / 100).toFixed(2)}% on {formatNaira(line.baseKobo)} ={" "}
                {formatNaira(line.taxKobo)}, supplier {line.supplier}
                {line.included ? ", included in the price" : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Access">
        <DetailList>
          <DetailRow label="Files">{detail.entitlements.files}</DetailRow>
          <DetailRow label="Downloads used">{detail.entitlements.downloadsUsed}</DetailRow>
          <DetailRow label="Download limit">{detail.entitlements.downloadsAllowed}</DetailRow>
          <DetailRow label="Revoked">{detail.entitlements.revoked}</DetailRow>
        </DetailList>
      </Section>

      <Section title="Refunds">
        {detail.refundRequests.length === 0 ? (
          <EmptyBlock title="No refund request" />
        ) : (
          <ul className="space-y-2">
            {detail.refundRequests.map((request) => (
              <li key={request.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusTag tone={refundTone(request.status)}>{request.status}</StatusTag>
                  <span className="text-dense text-text-muted">
                    {request.requestedAt === null ? "Not recorded" : formatLagosDateTime(request.requestedAt)}
                  </span>
                </div>
                <p className="mt-1 text-dense text-foreground">{request.reason}</p>
                {request.decisionNote === null ? null : (
                  <p className="text-dense text-text-muted">Decision note: {request.decisionNote}</p>
                )}
                {request.status === "failed" && canManageRefunds ? (
                  <button type="button" className={`${BUTTON_SECONDARY} mt-2`} onClick={() => void retry(request.id)} disabled={busy}>
                    {busy ? "Queuing" : "Retry submission"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManageRefunds ? (
          <p className="mt-3 text-dense text-text-muted">
            Approving or rejecting a request uses the same decision as the vendor screen, and approving queues the
            Paystack refund.
          </p>
        ) : null}
      </Section>

      <Section title="Disputes">
        {detail.disputes.length === 0 ? (
          <EmptyBlock title="No dispute" />
        ) : (
          <ul className="space-y-2">
            {detail.disputes.map((dispute) => (
              <li key={dispute.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusTag tone={dispute.outcome === "open" ? "warning" : "neutral"}>{dispute.outcome}</StatusTag>
                  {dispute.needsDecision ? <StatusTag tone="danger">Needs your decision</StatusTag> : null}
                </div>
                <p className="mt-1 text-dense text-text-muted">
                  Opened {dispute.openedAt === null ? "unknown" : formatLagosDateTime(dispute.openedAt)}
                  {dispute.providerResolution === null
                    ? ""
                    : ` · Paystack said ${dispute.providerResolution}${
                        dispute.providerResolvedAt === null ? "" : ` on ${formatLagosDate(dispute.providerResolvedAt)}`
                      }`}
                </p>
                {dispute.note === null ? null : <p className="text-dense text-foreground">{dispute.note}</p>}
              </li>
            ))}
          </ul>
        )}
        {canDecideDisputes ? (
          <Link href="/transactions?tab=disputes" className="mt-3 inline-block text-dense font-semibold text-brand-600 underline underline-offset-2">
            Decide a dispute
          </Link>
        ) : null}
      </Section>

      <Section title="Paystack events">
        {detail.webhooks.length === 0 ? (
          <EmptyBlock title="No event recorded for this reference" />
        ) : (
          <ul className="space-y-1 text-dense">
            {detail.webhooks.map((event, index) => (
              <li key={`${event.eventType ?? "event"}-${index}`} className="flex flex-wrap justify-between gap-2">
                <span className="text-foreground">
                  {event.eventType ?? "Unknown event"} · {event.status}
                  {event.error === null ? "" : ` · ${event.error}`}
                </span>
                <span className="text-text-muted">
                  {event.processedAt === null
                    ? event.receivedAt === null
                      ? "Not recorded"
                      : formatLagosDateTime(event.receivedAt)
                    : formatLagosDateTime(event.processedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Emails">
        {detail.emails.length === 0 ? (
          <EmptyBlock title="No email sent for this order" />
        ) : (
          <ul className="space-y-1 text-dense">
            {detail.emails.map((email, index) => (
              <li key={`${email.kind}-${index}`} className="flex flex-wrap justify-between gap-2">
                <span className="text-foreground">
                  {email.kind} · {email.status}
                </span>
                <span className="text-text-muted">
                  {email.createdAt === null ? "Not recorded" : formatLagosDateTime(email.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {detail.ledger === null ? (
        <Section title="Ledger">
          <QuietLine>The ledger is visible to admin and finance only.</QuietLine>
        </Section>
      ) : (
        <Section title="Ledger postings">
          {detail.ledger.transactions.length === 0 ? (
            <EmptyBlock title="Nothing has been posted for this order" />
          ) : (
            <ul className="space-y-3">
              {detail.ledger.transactions.map((txn) => (
                <li key={txn.id}>
                  <p className="text-dense font-semibold text-foreground">
                    {txn.kind}{" "}
                    <span className="font-normal text-text-muted">
                      {txn.createdAt === null ? "" : formatLagosDateTime(txn.createdAt)}
                    </span>
                  </p>
                  <ul className="mt-1 space-y-1 text-dense">
                    {txn.entries.map((entry, index) => (
                      <li key={`${entry.accountCode}-${index}`} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {entry.accountCode}
                          {entry.party === null ? "" : ` · ${entry.party}`}
                        </span>
                        <span className="tabular-nums text-text-muted">
                          {entry.debitKobo === BigInt(0) ? "" : `debit ${formatNaira(entry.debitKobo)}`}
                          {entry.creditKobo === BigInt(0) ? "" : ` credit ${formatNaira(entry.creditKobo)}`}
                          {entry.availableAt === null ? "" : ` · available ${formatLagosDate(entry.availableAt)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  )
}
