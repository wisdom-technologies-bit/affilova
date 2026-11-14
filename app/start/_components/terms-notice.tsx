import Link from "next/link"

// The sentence both onboarding forms show above their submit button, and the
// link-styled button the success state shows instead of the form.
//
// The policy text is the draft that /terms-of-service and /privacy-policy
// currently publish; lib/identity/policies.ts records the version that a user
// accepts, and it is not final.

const LINK =
  "rounded-sm font-medium text-brand-700 underline-offset-2 transition-colors duration-150 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"

export function TermsNotice() {
  return (
    <p className="text-xs leading-relaxed text-slate-600">
      By continuing you agree to the{" "}
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
