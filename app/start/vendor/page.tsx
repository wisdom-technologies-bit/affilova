import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth/auth-shell"
import { VendorForm } from "@/app/start/_components/vendor-form"
import { requireUser } from "@/lib/identity/guards"

export const metadata: Metadata = {
  title: "Set up your store on Affilova",
  robots: { index: false, follow: false },
}

export default async function StartVendorPage() {
  const { roles } = await requireUser("/start/vendor")

  // Somebody who already sells has nothing to do here.
  if (roles.includes("vendor")) {
    redirect("/start")
  }

  return (
    <AuthShell
      panel={{
        heading: "Set up your store.",
        body: "Tell us about your business. You can add products after this step.",
      }}
    >
      <VendorForm />
    </AuthShell>
  )
}
