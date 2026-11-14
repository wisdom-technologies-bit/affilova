import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AppShell } from "@/components/app-shell/app-shell"
import { getAccountSummary } from "@/lib/identity/account-summary"
import { requirePermission } from "@/lib/identity/guards"

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

// The Admin shell. The guard runs first: nothing below it renders for an
// account that may not be here.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, roles } = await requirePermission("area:admin", "/", "not-found")
  const summary = await getAccountSummary(user.id, user.email)

  return (
    <AppShell app="admin" roles={roles} user={summary}>
      {children}
    </AppShell>
  )
}
