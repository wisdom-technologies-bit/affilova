import type { ReactNode } from "react"
import Link from "next/link"

import { Logo } from "@/components/brand/logo"
import { Bank, CreditCard, SealCheck } from "@/components/ds/icons"
import { AUTH_PREVIEW_IMAGE } from "@/lib/identity/auth-preview"
import { PAYOUT_DAYS_TEXT } from "@/lib/site-config"

// The frame every auth page sits in.
//
// Below 1024px it is one column: the wordmark, the form, and the two legal
// links. There is no panel, because a phone has no room for a second voice and
// the form is the only thing a person came for.
//
// From 1024px up it is two columns and the form is the hero: a quiet panel on
// the left carries the product's voice, and the right column carries the task,
// centred, at a comfortable measure. The form is first in the DOM so a keyboard
// and a screen reader reach it before the panel; the panel is moved left with
// order classes only, so there is no viewport hook to wait for and nothing moves
// on load.
//
// The panel says three things a person can check for themselves, each with an
// icon and a word: files are scanned, payments are handled by Paystack, payouts
// land in a bank account on the days PAYOUT_DAYS_TEXT names. The number comes
// from lib/site-config.ts, never from this file.
//
// Every colour is a token: brand-900 for the panel, background for the page,
// text-muted for a supporting line. The only transition is the 150ms colour
// change on a link, and it is removed under prefers-reduced-motion by
// app/globals.css.

export interface AuthPanel {
  /** Panel headline, sentence case, eight words at most. */
  heading: string
  /** One sentence under the headline. */
  body: string
}

export interface AuthShellProps {
  children: ReactNode
  /** Panel copy for the desktop layout. Below 1024px nothing renders. */
  panel?: AuthPanel
}

const LINK_FOCUS = "focus-ring rounded-sm transition-colors duration-150"

const LEGAL_LINK =
  "rounded-sm underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-ring"

const PANEL_LINK =
  "rounded-sm underline decoration-white/40 underline-offset-4 transition-colors duration-150 hover:decoration-white focus-ring focus-visible:ring-offset-brand-900"

// The three facts. Each one is true of this product today, and each one names
// the thing rather than describing how good it is.
function Facts() {
  const facts = [
    { icon: SealCheck, text: "Files are security scanned" },
    { icon: CreditCard, text: "Payments are handled by Paystack" },
    { icon: Bank, text: `Payouts go to your bank account, ${PAYOUT_DAYS_TEXT}` },
  ]

  return (
    <ul className="mt-10 space-y-4">
      {facts.map((fact) => (
        <li key={fact.text} className="flex items-start gap-3">
          <fact.icon size="md" className="mt-0.5 shrink-0 text-white/70" />
          <span className="text-body text-white/85">{fact.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function AuthShell({ children, panel }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-surface-subtle lg:grid lg:grid-cols-12 lg:bg-background">
      {/* Mobile: the wordmark and the form. */}
      <div className="mx-auto flex w-full max-w-[440px] flex-col px-6 py-10 sm:py-14 lg:order-2 lg:col-span-7 lg:mx-auto lg:max-w-[400px] lg:justify-center lg:px-0 lg:py-16">
        <div className="flex justify-center lg:hidden">
          <Link
            href="/"
            aria-label="Affilova home"
            className={`inline-flex min-h-11 items-center ${LINK_FOCUS}`}
          >
            <Logo variant="horizontal" tone="auto" className="h-8 w-auto" />
          </Link>
        </div>

        <div className="mt-8 rounded-lg border border-border bg-background p-6 sm:p-8 lg:mt-0 lg:rounded-none lg:border-0 lg:p-0">
          {children}
        </div>

        <div className="mt-6 flex items-center justify-center gap-5 text-small text-text-subtle lg:hidden">
          <Link href="/terms-of-service" className={`inline-flex min-h-11 items-center ${LEGAL_LINK}`}>
            Terms of Service
          </Link>
          <Link href="/privacy-policy" className={`inline-flex min-h-11 items-center ${LEGAL_LINK}`}>
            Privacy Policy
          </Link>
        </div>
      </div>

      {panel ? (
        <aside
          aria-label="About Affilova"
          className="hidden lg:sticky lg:top-0 lg:order-1 lg:col-span-5 lg:flex lg:h-screen lg:flex-col lg:justify-between lg:bg-brand-900 lg:p-14 xl:p-16"
        >
          <Link
            href="/"
            aria-label="Affilova home"
            className={`inline-flex min-h-11 items-center self-start ${LINK_FOCUS} focus-visible:ring-offset-brand-900`}
          >
            <Logo variant="horizontal" tone="white" className="h-8 w-auto" />
          </Link>

          <div className="py-12">
            <p className="max-w-[20ch] text-display-sm text-white">{panel.heading}</p>
            <p className="mt-4 max-w-[36ch] text-body text-white/75">{panel.body}</p>

            <Facts />

            {AUTH_PREVIEW_IMAGE ? (
              <div className="mt-10 overflow-hidden rounded-lg border border-white/20">
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

          <div className="flex flex-col gap-3 text-small text-white/60">
            <div className="flex items-center gap-5">
              <Link href="/terms-of-service" className={`inline-flex min-h-11 items-center ${PANEL_LINK}`}>
                Terms of Service
              </Link>
              <Link href="/privacy-policy" className={`inline-flex min-h-11 items-center ${PANEL_LINK}`}>
                Privacy Policy
              </Link>
            </div>
            <p>© Affilova</p>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
