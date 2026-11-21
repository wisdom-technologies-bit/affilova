import Link from "next/link"

// The sentence both onboarding forms show above their submit button, and the
// link-styled button the success state shows instead of the form.
//
// Policy versions are kept in lib/site-config.ts and recorded through
// record_policy_acceptance() when onboarding completes.

const LINK =
  "rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"

export type OnboardingAgreementRole = "vendor" | "affiliate"

export function TermsNotice({ role }: { role: OnboardingAgreementRole }) {
  const roleAgreement =
    role === "vendor"
      ? { href: "/vendor-agreement", label: "Vendor Agreement" }
      : { href: "/affiliate-agreement", label: "Affiliate Agreement" }

  return (
    <p className="text-xs leading-relaxed text-slate-600">
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

export function ContinueLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  )
}
