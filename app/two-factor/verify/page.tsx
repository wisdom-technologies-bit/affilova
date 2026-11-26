import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { VerifyForm } from "@/components/security/two-factor-forms"
import { safeNextPath } from "@/lib/identity/safe-next"

// /two-factor/verify, on whichever host the staff member signed in on.
//
// A six digit code, ten attempts per ten minutes per account, and one fixed
// sentence for a wrong code. The next path is sanitised before it is put in the
// form, so a crafted ?next= cannot turn the success redirect into an open one.

export const metadata: Metadata = {
  title: "Two-factor verification",
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const next = safeNextPath(single(params.next) ?? "/admin")

  return (
    <AuthShell
      panel={{
        heading: "Confirm it is you",
        body: "The admin app opens once the code is confirmed.",
      }}
    >
      <VerifyForm next={next} />
    </AuthShell>
  )
}
