"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

import { signOutAction } from "@/app/auth/actions"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AccountSummary } from "@/lib/identity/account-summary"

// The account menu: who is signed in, with the roles the account holds and
// their status, and the way out.

function initials(summary: AccountSummary): string {
  const source = summary.displayName ?? summary.email ?? ""

  const letters = source
    .split(/[\s@._-]+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return letters === "" ? "?" : letters
}

export function UserMenu({ user }: { user: AccountSummary }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const name = user.displayName ?? user.email ?? "Your account"

  async function handleSignOut(): Promise<void> {
    setPending(true)

    try {
      await signOutAction()
    } finally {
      router.replace("/sign-in")
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="focus-ring flex min-h-control-md items-center gap-2 rounded-md border border-border-control bg-background px-2 text-left transition-colors duration-150 hover:bg-surface-muted"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-caption font-medium text-brand-700"
          >
            {initials(user)}
          </span>
          <span className="hidden max-w-32 truncate text-dense font-medium text-foreground sm:inline">
            {name}
          </span>
          <span className="sr-only">Open account menu</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-dense font-medium text-foreground">{name}</span>
          {user.email !== null ? (
            <span className="block truncate text-caption text-text-muted">{user.email}</span>
          ) : null}
        </DropdownMenuLabel>

        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {user.roles.length === 0 ? (
            <span className="text-caption text-text-muted">No roles</span>
          ) : (
            user.roles.map((entry) => (
              <Badge
                key={entry.role}
                variant={entry.status === "active" ? "secondary" : "outline"}
                className="capitalize"
              >
                {`${entry.role} · ${entry.status}`}
              </Badge>
            ))
          )}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            void handleSignOut()
          }}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
