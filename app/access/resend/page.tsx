import type { Metadata } from "next"

import { ResendForm } from "@/components/commerce/resend-form"

// Ask for a fresh download link. Public, noindex, and answered the same way for
// every address.

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Send me a new link | Affilova",
  robots: { index: false, follow: false },
}

export default function ResendPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Send me a new link</h1>
      <p className="mt-3 text-base text-foreground">
        Enter the email address you paid with. If it has paid orders, we email a fresh link for each of
        them.
      </p>
      <div className="mt-6">
        <ResendForm />
      </div>
    </main>
  )
}
