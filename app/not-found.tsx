"use client"

import Link from "next/link"

import { Logo } from "@/components/brand/logo"
import { MagnifyingGlass, SignOut } from "@/components/ds/icons"
import { Button } from "@/components/ui/button"

// The 404, on any host.
//
// It says what happened, names the two places worth going, and offers the browser
// back button for the case where the person arrived here by a mistyped link. No
// illustration, no search box that cannot search anything, no apology paragraph.

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-subtle px-6 py-16">
      <div className="w-full max-w-[520px] rounded-lg border border-border bg-background p-8">
        <Logo variant="horizontal" tone="auto" className="h-7 w-auto" />

        <h1 className="mt-6 text-h1 text-foreground">Page not found</h1>

        <p className="mt-3 text-body text-text-muted">
          There is nothing at this address. The link may be wrong, or the page may have moved.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/marketplace">
              <MagnifyingGlass size="sm" />
              Browse the marketplace
            </Link>
          </Button>

          <Button asChild variant="outline">
            <Link href="/sign-in">
              <SignOut size="sm" />
              Sign in
            </Link>
          </Button>
        </div>

        <p className="mt-6 text-small text-text-muted">Arrived here from another page?</p>

        <button
          type="button"
          onClick={() => window.history.back()}
          className="focus-ring mt-1 inline-flex min-h-11 items-center rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
        >
          Go back
        </button>
      </div>
    </main>
  )
}
