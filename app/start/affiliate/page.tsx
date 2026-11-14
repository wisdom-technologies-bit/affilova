import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AffiliateForm } from "@/app/start/_components/affiliate-form"
import { AuthShell } from "@/components/auth/auth-shell"
import { requireUser } from "@/lib/identity/guards"

export const metadata: Metadata = {
  title: "Set up your affiliate profile on Affilova",
  robots: { index: false, follow: false },
}

export default async function StartAffiliatePage() {
  const { roles } = await requireUser("/start/affiliate")

  // Somebody who already promotes has nothing to do here.
  if (roles.includes("affiliate")) {
    redirect("/start")
  }

  return (
    <AuthShell
      panel={{
        heading: "Set up your affiliate profile.",
        body: "Choose a username and tell us where you promote.",
      }}
    >
      <AffiliateForm />
    </AuthShell>
  )
}
