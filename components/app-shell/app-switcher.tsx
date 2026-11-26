"use client"

import {
  CaretDown,
  ArrowSquareOut,
} from "@/components/ds/icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Links to the other apps this account may open. The list is built on the
// server, where the roles are known, and each link points at that app's host.

export type SwitcherApp = {
  key: string
  label: string
  href: string
}

export function AppSwitcher({ apps }: { apps: readonly SwitcherApp[] }) {
  if (apps.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-control-md gap-2 px-3"
        >
          Apps
          <CaretDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Other apps</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((app) => (
          <DropdownMenuItem key={app.key} asChild>
            <a
              href={app.href}
              className="focus-ring flex min-h-control-md items-center justify-between gap-2"
            >
              <span>{app.label}</span>
              <ArrowSquareOut className="h-4 w-4 text-text-subtle" aria-hidden="true" />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
