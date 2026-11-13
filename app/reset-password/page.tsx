import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { getAuthUser } from "@/lib/identity/session"

export const metadata: Metadata = {
  title: "Choose a new password for Affilova",
  robots: { index: false, follow: false },
}

// A reset link signs the visitor in first (through /auth/confirm), so this page
// only exists for a request that is already authenticated. Anyone else is sent
// back to request a fresh link.
export default async function ResetPasswordPage() {
  const user = await getAuthUser()

  if (!user) {
    redirect("/forgot-password?error=expired")
  }

  return (
    <AuthShell
      panel={{
        heading: "Choose a new password.",
        body: "Use at least 10 characters. A passphrase works well.",
      }}
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
