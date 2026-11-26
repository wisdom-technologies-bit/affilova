import Link from "next/link"
import { notFound } from "next/navigation"

import { UserControls } from "@/components/admin/user-controls"
import { PageHeader } from "@/components/app-shell/page-header"
import { getUserAction } from "@/lib/admin/users-actions"

// One account.
//
// The read is a single function that returns the profile and every role the
// person has held, including revoked ones, so the screen can show what was taken
// away as well as what is in place. A missing id is a 404, not an empty page.

export const dynamic = "force-dynamic"

function when(iso: string): string {
  if (iso === "") {
    return "—"
  }

  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getUserAction(id)

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Account" />
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {result.error}
        </p>
        <Link href="/users" className="mt-4 inline-block text-sm text-brand-700 underline-offset-4 hover:underline">
          Back to users
        </Link>
      </>
    )
  }

  if (result.data === null) {
    notFound()
  }

  const user = result.data

  return (
    <>
      <PageHeader title={user.displayName ?? user.email ?? "Account"} />

      <dl className="mb-6 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
          <dd className="mt-1 text-sm text-foreground">{user.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Joined</dt>
          <dd className="mt-1 text-sm text-foreground">{when(user.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Account id</dt>
          <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">{user.id}</dd>
        </div>
      </dl>

      <UserControls
        userId={user.id}
        roles={user.roles.map((entry) => ({ role: entry.role, status: entry.status }))}
        status={user.status}
        verificationLevel={user.verificationLevel}
      />

      <Link href="/users" className="mt-6 inline-block text-sm text-brand-700 underline-offset-4 hover:underline">
        Back to users
      </Link>
    </>
  )
}
