"use client"

import { ChevronDown, ExternalLink } from "lucide-react"

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
          className="h-11 gap-2 border-border px-3 text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Apps
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Other apps</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((app) => (
          <DropdownMenuItem key={app.key} asChild>
            <a
              href={app.href}
              className="flex min-h-11 items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <span>{app.label}</span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
