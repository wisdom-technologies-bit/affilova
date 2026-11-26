import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { EnrollForm } from "@/components/security/two-factor-forms"
import { beginEnrollment } from "@/lib/identity/mfa-actions"
import { safeNextPath } from "@/lib/identity/safe-next"

// /two-factor/enroll, on whichever host the staff member signed in on.
//
// The page starts enrolment, shows the QR code and the text secret exactly as
// Supabase returned them, and asks for the first six digit code. Neither the
// secret nor the QR code is stored, logged or put in the URL: they exist in this
// response and nowhere else.

export const metadata: Metadata = {
  title: "Set up two-factor sign-in",
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export default async function EnrollPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const next = safeNextPath(single(params.next) ?? "/admin")
  const started = await beginEnrollment()

  return (
    <AuthShell
      panel={{
        heading: "One more step.",
        body: "A second factor keeps the admin app closed to anyone who only has your password.",
      }}
    >
      {started.ok ? (
        <EnrollForm qrCode={started.qrCode} secret={started.secret} next={next} />
      ) : (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Set up two-factor sign-in</h1>
          <p role="alert" aria-live="polite" className="mt-4 text-sm text-destructive">
            {started.error}
          </p>
        </div>
      )}
    </AuthShell>
  )
}
