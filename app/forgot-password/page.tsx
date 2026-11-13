import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = {
  title: "Reset your Affilova password",
  robots: { index: false, follow: false },
}

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams

  return (
    <AuthShell>
      <ForgotPasswordForm error={single(params.error)} />
    </AuthShell>
  )
}
