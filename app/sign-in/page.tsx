import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { SignInForm } from "@/components/auth/sign-in-form"

export const metadata: Metadata = {
  title: "Sign in to Affilova",
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams

  return (
    <AuthShell>
      <SignInForm next={single(params.next)} error={single(params.error)} />
    </AuthShell>
  )
}
