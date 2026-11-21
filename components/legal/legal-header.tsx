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
    <header className="legal-no-print border-b border-[#E3E6E3] bg-white print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <Link href="/" aria-label="Affilova home" className="inline-flex shrink-0">
          <Logo variant="horizontal" className="h-8 w-auto" />
        </Link>

        <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-1 text-sm">
          {NAV_LINKS.map((link) => {
            const isCurrent = currentHref === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`rounded-md px-3 py-2 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                  isCurrent ? "font-medium text-brand-700" : "text-slate-600"
                }`}
              >
                {link.name}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/auth/login"
            className="rounded-md px-3 py-2 text-slate-700 transition-colors duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Sign in
          </Link>
          <Link
            href="/auth/register"
            className="rounded-md bg-brand-500 px-4 py-2 font-medium text-white transition-colors duration-150 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}
