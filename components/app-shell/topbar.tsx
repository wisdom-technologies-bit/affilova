"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu } from "lucide-react"

import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { AccountSummary } from "@/lib/identity/account-summary"

import { AppSwitcher, type SwitcherApp } from "./app-switcher"
import type { NavItem, ShellApp } from "./navigation"
import { SidebarNav } from "./sidebar"
import { UserMenu } from "./user-menu"

// The 56px bar across the top: the drawer trigger and logo on small screens,
// then the app switcher and the account menu.

export function Topbar({
  app,
  label,
  items,
  user,
  apps,
}: {
  app: ShellApp
  label: string
  items: readonly NavItem[]
  user: AccountSummary
  apps: readonly SwitcherApp[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 border-r border-border p-0">
          <SheetHeader className="border-b border-border px-6 py-4 text-left">
            <SheetTitle className="text-sm font-semibold text-brand-ink">{label}</SheetTitle>
            <SheetDescription className="sr-only">
              {`Navigation for the ${label} app`}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-3 py-4">
            <SidebarNav
              app={app}
              items={items}
              ariaLabel={`${label} sections`}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Link
        href="/"
        className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 lg:hidden"
      >
        <Logo variant="horizontal" className="h-6 w-auto" />
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <AppSwitcher apps={apps} />
        <UserMenu user={user} />
      </div>
    </header>
  )
}
