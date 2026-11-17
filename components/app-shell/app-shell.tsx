import { appUrl } from "@/lib/identity/app-urls"
import type { AccountSummary } from "@/lib/identity/account-summary"
import { can } from "@/lib/identity/permissions"
import type { AppRole } from "@/lib/identity/session"

import type { SwitcherApp } from "./app-switcher"
import { SHELL_NAVIGATION, type ShellApp } from "./navigation"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"

// The frame every signed-in app is drawn in: a fixed 256px sidebar from lg up,
// a drawer below it, a 56px topbar, and the page inside a 1152px column.
//
// The role checks for the sections themselves are in the layouts, which run
// before this renders. The only decision here is which other apps the account
// may open.

const APP_ACTIONS = [
  { key: "account", label: "Account", action: "area:account" },
  { key: "affiliate", label: "Affiliate", action: "area:affiliate" },
  { key: "merchant", label: "Merchant", action: "area:merchant" },
  { key: "admin", label: "Admin", action: "area:admin" },
] as const

/**
 * The other apps this account may open, with a link to each host.
 *
 * The marketplace is listed for everyone: it is the public site, not a
 * permission. The app being viewed is left out.
 */
function switcherApps(app: ShellApp, roles: readonly AppRole[]): SwitcherApp[] {
  const entries: SwitcherApp[] = []

  for (const entry of APP_ACTIONS) {
    if (entry.key !== app && can(roles, entry.action)) {
      entries.push({
        key: entry.key,
        label: entry.label,
        href: appUrl(entry.key, "/"),
      })
    }
  }

  entries.push({ key: "public", label: "Marketplace", href: appUrl("public", "/") })

  return entries
}

export function AppShell({
  app,
  roles,
  user,
  children,
}: {
  app: ShellApp
  roles: readonly AppRole[]
  user: AccountSummary
  children: React.ReactNode
}) {
  const nav = SHELL_NAVIGATION[app]

  return (
    <div className="min-h-screen bg-background text-brand-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-ink focus:ring-2 focus:ring-brand-600"
      >
        Skip to content
      </a>

      <Sidebar app={app} label={nav.label} items={nav.items} />

      <div className="lg:pl-64">
        <Topbar app={app} label={nav.label} items={nav.items} user={user} apps={switcherApps(app, roles)} />

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1152px] px-6 py-8 focus-visible:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
