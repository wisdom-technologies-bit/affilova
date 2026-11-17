"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Logo } from "@/components/brand/logo"
import { cn } from "@/lib/utils"

import { shellPath, type NavItem, type ShellApp } from "./navigation"

// The section list, shared by the fixed sidebar and the mobile drawer.
//
// The current section is worked out from the normalized pathname (see
// shellPath), so the item marked aria-current is the same during the server
// render and after hydration.

const ITEM_BASE =
  "flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function SidebarNav({
  app,
  items,
  ariaLabel,
  onNavigate,
}: {
  app: ShellApp
  items: readonly NavItem[]
  ariaLabel: string
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const current = shellPath(pathname, app)

  return (
    <nav aria-label={ariaLabel}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = item.path === current

          return (
            <li key={item.path}>
              <Link
                href={item.path}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  ITEM_BASE,
                  active
                    ? "bg-brand-50 text-brand-600"
                    : "text-brand-ink/80 hover:bg-muted hover:text-brand-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function Sidebar({
  app,
  label,
  items,
}: {
  app: ShellApp
  label: string
  items: readonly NavItem[]
}) {
  return (
    <aside
      aria-label={`${label} sidebar`}
      className="hidden border-r border-border bg-background lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-64 lg:flex-col"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <Link
          href="/"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <Logo variant="horizontal" className="h-6 w-auto" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <SidebarNav app={app} items={items} ariaLabel={`${label} sections`} />
      </div>
    </aside>
  )
}
