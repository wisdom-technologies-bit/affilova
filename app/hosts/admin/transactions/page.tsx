import { ErrorNotice } from "@/components/affiliate/status-pill"
import { PageHeader } from "@/components/app-shell/page-header"
import { DisputesView, LedgerView, OrdersView, RefundsView } from "@/components/admin-finance/transactions"
import { ReconciliationView } from "@/components/admin-finance/transactions"
import {
  getTrialBalanceAction,
  listDisputesAction,
  listLedgerAction,
  listOrdersAction,
  listReconciliationAction,
  listRefundsAction,
} from "@/lib/admin/finance-actions"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"
import Link from "next/link"
import type React from "react"

export const dynamic = "force-dynamic"

// Transactions: orders, refunds, disputes, ledger and reconciliation, as five
// tabs. The tab is in the URL so a link can point at one.
//
// Each tab only asks for its own data, and the database checks the role again:
// a support member who types ?tab=ledger by hand gets the "no access" line, not a
// ledger.

const TABS = [
  { key: "orders", label: "Orders", permission: "orders:read" },
  { key: "refunds", label: "Refunds", permission: "orders:read" },
  { key: "disputes", label: "Disputes", permission: "orders:read" },
  { key: "ledger", label: "Ledger", permission: "ledger:read" },
  { key: "reconciliation", label: "Reconciliation", permission: "reconciliation:read" },
] as const

type TabKey = (typeof TABS)[number]["key"]

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (key: string): string | undefined => {
    const value = params[key]

    return Array.isArray(value) ? value[0] : value
  }

  const requested = first("tab") ?? "orders"
  const tab: TabKey = TABS.some((entry) => entry.key === requested) ? (requested as TabKey) : "orders"

  const user = await getAuthUser()

  if (user === null) {
    return (
      <>
        <PageHeader title="Transactions" />
        <ErrorNotice message="Sign in to continue." />
      </>
    )
  }

  const roles = await getUserRoles(user.id)
  const active = TABS.find((entry) => entry.key === tab)

  if (active === undefined || !can(roles, active.permission)) {
    return (
      <>
        <PageHeader title="Transactions" />
        <ErrorNotice message="You do not have access to that." />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Transactions" />

      <nav aria-label="Transaction views" className="mb-6">
        <ul className="flex flex-wrap gap-1">
          {TABS.filter((entry) => can(roles, entry.permission)).map((entry) => (
            <li key={entry.key}>
              <Link
                href={`/transactions?tab=${entry.key}`}
                aria-current={entry.key === tab ? "page" : undefined}
                className={
                  entry.key === tab
                    ? "inline-flex min-h-11 items-center rounded-md bg-brand-ink px-4 text-sm font-semibold text-white"
                    : "inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-brand-ink"
                }
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {await renderTab(tab, {
        q: first("q") ?? "",
        status: first("status") ?? "",
        from: first("from") ?? "",
        to: first("to") ?? "",
        canManageRefunds: can(roles, "refunds:manage"),
        canDecideDisputes: can(roles, "disputes:manage"),
      })}
    </>
  )
}

/**
 * The tab's own content, awaited before it is rendered.
 *
 * An async component rendered as a child suspends, and a suspended tree cannot
 * be rendered statically. Awaiting the work here keeps the page one plain tree.
 */
async function renderTab(
  tab: TabKey,
  input: {
    q: string
    status: string
    from: string
    to: string
    canManageRefunds: boolean
    canDecideDisputes: boolean
  },
): Promise<React.ReactElement> {
  if (tab === "refunds") {
    return RefundsTab({ status: input.status, canManage: input.canManageRefunds })
  }

  if (tab === "disputes") {
    return DisputesTab({ canDecide: input.canDecideDisputes })
  }

  if (tab === "ledger") {
    return LedgerTab()
  }

  if (tab === "reconciliation") {
    return ReconciliationTab()
  }

  return OrdersTab({
    searchParams: { q: input.q, status: input.status, from: input.from, to: input.to },
  })
}

async function OrdersTab({ searchParams }: { searchParams: { q: string; status: string; from: string; to: string } }) {
  const result = await listOrdersAction({
    q: searchParams.q === "" ? undefined : searchParams.q,
    status: searchParams.status === "" ? undefined : searchParams.status,
    from: searchParams.from === "" ? undefined : searchParams.from,
    to: searchParams.to === "" ? undefined : searchParams.to,
  })

  return (
    <OrdersView
      initialPage={result.ok ? result.data : { rows: [], nextCursor: null }}
      initialError={result.ok ? null : result.error}
      initialQuery={searchParams}
    />
  )
}

async function RefundsTab({ status, canManage }: { status: string; canManage: boolean }) {
  const result = await listRefundsAction({ status: status === "" ? undefined : status })

  return (
    <RefundsView
      initialPage={result.ok ? result.data : { rows: [], nextCursor: null }}
      initialError={result.ok ? null : result.error}
      initialStatus={status}
      canManage={canManage}
    />
  )
}

async function DisputesTab({ canDecide }: { canDecide: boolean }) {
  const result = await listDisputesAction({})

  return (
    <DisputesView
      initialPage={result.ok ? result.data : { rows: [], nextCursor: null }}
      initialError={result.ok ? null : result.error}
      canDecide={canDecide}
    />
  )
}

async function LedgerTab() {
  const [page, balance] = await Promise.all([listLedgerAction({}), getTrialBalanceAction()])

  return (
    <LedgerView
      initialPage={page.ok ? page.data : { rows: [], nextCursor: null, accounts: [] }}
      initialError={page.ok ? null : page.error}
      balanced={balance.ok ? { balanced: balance.data.balanced, differenceKobo: balance.data.totals.differenceKobo } : null}
    />
  )
}

async function ReconciliationTab() {
  const [balance, runs] = await Promise.all([getTrialBalanceAction(), listReconciliationAction({ limit: 30 })])

  if (!balance.ok) {
    return <ErrorNotice message={balance.error} />
  }

  return (
    <ReconciliationView
      balance={balance.data}
      runs={runs.ok ? runs.data.rows : []}
      error={runs.ok ? null : runs.error}
    />
  )
}
