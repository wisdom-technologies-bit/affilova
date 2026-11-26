import Link from "next/link"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

// The sentence both onboarding forms show above their submit button, and the link
// the success state shows instead of the form.
//
// Policy versions are kept in lib/site-config.ts and recorded through
// record_policy_acceptance() when onboarding completes.

const LINK =
  "rounded-sm font-medium text-brand-700 underline underline-offset-2 transition-colors duration-150 hover:text-brand-800 focus-ring"

export type OnboardingAgreementRole = "vendor" | "affiliate"

export function TermsNotice({ role }: { role: OnboardingAgreementRole }) {
  const roleAgreement =
    role === "vendor"
      ? { href: "/vendor-agreement", label: "Vendor Agreement" }
      : { href: "/affiliate-agreement", label: "Affiliate Agreement" }

  return (
    <p className="text-small leading-relaxed text-text-muted">
      I have read and agree to the{" "}
      <Link href={roleAgreement.href} className={LINK}>
        {roleAgreement.label}
      </Link>
      ,{" "}
      <Link href="/terms-of-service" className={LINK}>
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/privacy-policy" className={LINK}>
        Privacy Policy
      </Link>
      .
    </p>
  )
}

export interface ContinueLinkProps {
  href: string
  children: ReactNode
  /** `primary` is the one action of the panel; `text` is a quiet way back. */
  variant?: "primary" | "text"
}

export function ContinueLink({ href, children, variant = "primary" }: ContinueLinkProps) {
  if (variant === "text") {
    return (
      <Link
        href={href}
        className="focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
      >
        {children}
      </Link>
    )
  }

  return (
    <Button asChild className="mt-4 w-full">
      <Link href={href}>{children}</Link>
    </Button>
  )
}
