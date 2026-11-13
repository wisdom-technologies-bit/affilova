import type { Metadata } from "next"

import { AuthShell } from "@/components/auth/auth-shell"
import { SignUpForm } from "@/components/auth/sign-up-form"

export const metadata: Metadata = {
  title: "Create your Affilova account",
  robots: { index: false, follow: false },
}

export default function SignUpPage() {
  return (
    <AuthShell
      panel={{
        heading: "Start on Affilova.",
        body: "Create one account. Sell your own products, promote other people's, or do both.",
      }}
    >
      <SignUpForm />
    </AuthShell>
  )
}
