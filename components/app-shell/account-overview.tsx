import { Badge } from "@/components/ui/badge"
import type { AccountSummary } from "@/lib/identity/account-summary"

import { PageHeader } from "./page-header"

/**
 * The first page of every app.
 *
 * It shows the account's own data and nothing else: the display name as the
 * heading, the email address and every role with the status it is stored with.
 * There are no counts, no activity and no placeholder figures, because none of
 * those exist yet.
 */
export function AccountOverview({ summary }: { summary: AccountSummary }) {
  const heading = summary.displayName === null ? "Welcome" : `Welcome, ${summary.displayName}`

  return (
    <>
      <PageHeader title={heading} />

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Email
          </dt>
          <dd className="mt-1 text-sm text-brand-ink">{summary.email ?? "Not set"}</dd>
        </div>

        <div className="rounded-md border border-border bg-background px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Roles
          </dt>
          <dd className="mt-2 flex flex-wrap gap-1">
            {summary.roles.length === 0 ? (
              <span className="text-sm text-brand-ink">None</span>
            ) : (
              summary.roles.map((entry) => (
                <Badge
                  key={entry.role}
                  variant={entry.status === "active" ? "secondary" : "outline"}
                  className="text-xs capitalize"
                >
                  {`${entry.role} · ${entry.status}`}
                </Badge>
              ))
            )}
          </dd>
        </div>
      </dl>
    </>
  )
}
