import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { listUsersAction } from "@/lib/admin/users-actions"
import { ACCOUNT_STATUSES, STAFF_ROLES, type AccountStatus, type StaffRole } from "@/lib/admin/users-types"

// The admin Users list.
//
// One page of people at a time, twenty-five rows, with a search box and two
// filters. The filters are a GET form on purpose: the result is a URL, so a
// filtered list can be linked, bookmarked and reloaded without JavaScript.
//
// What the screen never does: invent a count, sort by a column the function does
// not order by, or show a number it did not read from the row.

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asStatus(value: string | undefined): AccountStatus | null {
  return ACCOUNT_STATUSES.find((status) => status === value) ?? null
}

function asRole(value: string | undefined): StaffRole | null {
  return STAFF_ROLES.find((role) => role === value) ?? null
}

function asPage(value: string | undefined): number {
  const parsed = Number(value ?? "1")
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function label(value: string): string {
  return value.replace(/_/g, " ")
}

function joined(iso: string): string {
  if (iso === "") {
    return "—"
  }

  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function hrefWith(
  base: { q: string; status: AccountStatus | null; role: StaffRole | null },
  page: number,
): string {
  const params = new URLSearchParams()

  if (base.q !== "") params.set("q", base.q)
  if (base.status !== null) params.set("status", base.status)
  if (base.role !== null) params.set("role", base.role)
  if (page > 1) params.set("page", String(page))

  const query = params.toString()

  return query === "" ? "/users" : `/users?${query}`
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = (single(params.q) ?? "").slice(0, 120)
  const status = asStatus(single(params.status))
  const role = asRole(single(params.role))
  const page = asPage(single(params.page))

  const result = await listUsersAction({ search: q, status, role, page: page - 1 })

  const rows = result.ok ? result.data.rows : []
  const total = result.ok ? result.data.total : 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filters = { q, status, role }

  return (
    <>
      <PageHeader title="Users" />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="user-search" className="block text-sm font-medium text-foreground">
            Search
          </label>
          <input
            id="user-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Email or name"
            className="mt-1.5 block w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div>
          <label htmlFor="user-status" className="block text-sm font-medium text-foreground">
            Status
          </label>
          <select
            id="user-status"
            name="status"
            defaultValue={status ?? ""}
            className="mt-1.5 block min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">Any status</option>
            {ACCOUNT_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {label(entry)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="user-role" className="block text-sm font-medium text-foreground">
            Staff role
          </label>
          <select
            id="user-role"
            name="role"
            defaultValue={role ?? ""}
            className="mt-1.5 block min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">Any role</option>
            {STAFF_ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {label(entry)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      {!result.ok ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {result.error}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
          No accounts match that.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {total === 1 ? "1 account" : `${total} accounts`}
            {q === "" && status === null && role === null ? "" : " match this filter"}.
          </p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Accounts, newest first</caption>
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Account</th>
                  <th scope="col" className="px-4 py-3 font-medium">Roles</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Verification</th>
                  <th scope="col" className="px-4 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/users/${row.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                        {row.displayName ?? row.email ?? "Account"}
                      </Link>
                      {row.email === null ? null : (
                        <span className="block text-xs text-muted-foreground">{row.email}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.roles.length === 0 ? "—" : row.roles.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{label(row.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{label(row.verificationLevel)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{joined(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 1 ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={hrefWith(filters, page - 1)} className="text-brand-700 underline-offset-4 hover:underline">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Page {page} of {lastPage}
              </span>
              {page < lastPage ? (
                <Link href={hrefWith(filters, page + 1)} className="text-brand-700 underline-offset-4 hover:underline">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
