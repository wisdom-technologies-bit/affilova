import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AppShell } from "@/components/app-shell/app-shell"
import { getRequestPath } from "@/lib/current-app"
import { getAccountSummary } from "@/lib/identity/account-summary"
import { requirePermission } from "@/lib/identity/guards"
import { requireStaffAal2 } from "@/lib/identity/mfa"

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

// The Admin shell. The guard runs first: nothing below it renders for an
// account that may not be here.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const nextPath = await getRequestPath()
  const { user, roles } = await requirePermission("area:admin", nextPath, "not-found")

  // After the permission guard, never before it: a visitor who may not be here
  // is sent away without learning anything about two-factor enrolment.
  await requireStaffAal2(nextPath)

  const summary = await getAccountSummary(user.id, user.email)

  return (
    <AppShell app="admin" roles={roles} user={summary}>
      {children}
    </AppShell>
  )
}
