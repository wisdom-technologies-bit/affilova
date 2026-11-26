import Link from "next/link"

import { Logo } from "@/components/brand/logo"

const NAV_LINKS = [
  { name: "How It Works", href: "/how-it-works" },
  { name: "Legal", href: "/legal" },
  { name: "About", href: "/about" },
  { name: "Contact", href: "/contact" },
] as const

export function LegalHeader({ currentHref }: { currentHref?: string }) {
  return (
    <header className="legal-no-print border-b border-border bg-background print:hidden">
      <div className="container-public flex flex-wrap items-center justify-between gap-4 py-4">
        <Link href="/" aria-label="Affilova home" className="inline-flex shrink-0">
          <Logo variant="horizontal" className="h-8 w-auto" />
        </Link>

        <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-1 text-dense">
          {NAV_LINKS.map((link) => {
            const isCurrent = currentHref === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`focus-ring inline-flex min-h-control-md items-center rounded-md px-3 text-dense transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 ${
                  isCurrent ? "font-medium text-brand-700" : "text-text-muted"
                }`}
              >
                {link.name}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2 text-dense">
          <Link
            href="/sign-in"
            className="focus-ring inline-flex min-h-control-md items-center rounded-md px-3 text-dense text-foreground transition-colors duration-150 hover:bg-surface-muted"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="focus-ring inline-flex min-h-control-md items-center rounded-md bg-brand-600 px-4 text-dense font-medium text-background transition-colors duration-150 hover:bg-brand-700"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}
