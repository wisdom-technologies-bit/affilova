import type { ReactNode } from "react"
import Link from "next/link"

import { Logo } from "@/components/brand/logo"
import { AUTH_PREVIEW_IMAGE } from "@/lib/identity/auth-preview"

// The layout every new auth page sits in.
//
// Below 1024px it is the original single centred card: a plain page background,
// the wordmark linking home, one white card, and the small legal links beneath
// it.
//
// From 1024px up the same markup becomes two columns: a brand panel on the left
// and the form on a plain white right column. The form stays first in the DOM so
// keyboard and screen reader users reach it before the panel; the panel is moved
// to the left with order classes only. Everything is CSS, so there is no
// viewport hook to wait for and no layout shift on load.
//
// The only transition is still the 150ms colour change on interactive elements.

export interface AuthPanel {
  /** Panel headline. Rendered as a <p>: the form's h1 stays the page h1. */
  heading: string
  /** One or two sentences under the headline. */
  body: string
}

export interface AuthShellProps {
  children: ReactNode
  /** Brand panel copy for the desktop layout. Below 1024px nothing renders. */
  panel?: AuthPanel
}

const LINK_FOCUS =
  "rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"

const LEGAL_LINK_FOCUS =
  "rounded-sm underline-offset-2 transition-colors duration-150 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"

export function AuthShell({ children, panel }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[#F7F8F7] px-6 py-10 sm:py-16 lg:grid lg:grid-cols-12 lg:bg-white lg:p-0">
      <div className="mx-auto flex w-full max-w-[440px] flex-col lg:order-2 lg:col-span-7 lg:mx-auto lg:max-w-[400px] lg:justify-center lg:py-16">
        <div className="flex justify-center lg:hidden">
          <Link href="/" aria-label="Affilova home" className={`inline-flex ${LINK_FOCUS}`}>
            <Logo variant="horizontal" tone="auto" className="h-8 w-auto" />
          </Link>
        </div>

        <div className="mt-8 rounded-xl border border-[#E3E6E3] bg-white p-6 shadow-sm sm:p-8 lg:mt-0 lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none">
          {children}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500 lg:mt-8 lg:justify-start">
          <Link href="/terms-of-service" className={LEGAL_LINK_FOCUS}>
            Terms of Service
          </Link>
          <Link href="/privacy-policy" className={LEGAL_LINK_FOCUS}>
            Privacy Policy
          </Link>
        </div>
      </div>

      {panel ? (
        <aside
          aria-label="About Affilova"
          className="hidden lg:sticky lg:top-0 lg:order-1 lg:col-span-5 lg:flex lg:h-screen lg:flex-col lg:bg-brand-900 lg:p-14"
        >
          <Link
            href="/"
            aria-label="Affilova home"
            className={`inline-flex self-start ${LINK_FOCUS} focus-visible:ring-offset-brand-900`}
          >
            <Logo variant="horizontal" tone="white" className="h-8 w-auto" />
          </Link>

          <div className="flex flex-1 flex-col justify-center py-10">
            <p className="max-w-[18ch] text-3xl font-semibold tracking-tight text-white">
              {panel.heading}
            </p>
            <p className="mt-4 max-w-[38ch] text-base text-white/80">{panel.body}</p>

            {AUTH_PREVIEW_IMAGE ? (
              <div className="mt-8 overflow-hidden rounded-xl border border-white/20">
                <img
                  src={AUTH_PREVIEW_IMAGE.src}
                  alt={AUTH_PREVIEW_IMAGE.alt}
                  width={AUTH_PREVIEW_IMAGE.width}
                  height={AUTH_PREVIEW_IMAGE.height}
                  loading="eager"
                  className="block h-auto w-full"
                />
              </div>
            ) : null}
          </div>

          <p className="text-sm text-white/60">© Affilova</p>
        </aside>
      ) : null}
    </div>
  )
}
