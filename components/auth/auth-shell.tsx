import type { ReactNode } from "react"
import Link from "next/link"

import { Logo } from "@/components/brand/logo"

// The layout every new auth page sits in: a plain page background, the wordmark
// linking home, one white card, and the small legal links underneath. No
// gradients, no imagery, and the only transition is a 150ms colour change on
// interactive elements inside the card.

export interface AuthShellProps {
  children: ReactNode
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[#F7F8F7] px-6 py-10 sm:py-16">
      <div className="mx-auto flex w-full max-w-[440px] flex-col">
        <div className="flex justify-center">
          <Link
            href="/"
            aria-label="Affilova home"
            className="inline-flex rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Logo variant="horizontal" tone="auto" className="h-8 w-auto" />
          </Link>
        </div>

        <div className="mt-8 rounded-xl border border-[#E3E6E3] bg-white p-6 shadow-sm sm:p-8">
          {children}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
          <Link
            href="/terms-of-service"
            className="rounded-sm underline-offset-2 transition-colors duration-150 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy-policy"
            className="rounded-sm underline-offset-2 transition-colors duration-150 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}
