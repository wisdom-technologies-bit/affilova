import type { Metadata } from "next"
import Link from "next/link"

import { Logo } from "@/components/brand/logo"
import GlobalFooter from "@/components/global-footer"
import { LEGAL } from "@/lib/site-config"

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Affilova.",
}

// No form and no database: the page is plain content, so it keeps working when
// every backing service is down.
export default function ContactPage() {
  const supportEmail = LEGAL.supportEmail.trim()

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center space-x-3">
            <Logo variant="horizontal" className="h-8 w-auto" />
          </Link>
          <Link href="/sign-in" className="text-sm text-gray-600 hover:text-green-700">
            Sign in
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-16">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">Contact us</h1>

        {supportEmail !== "" ? (
          <p className="mb-4 text-gray-700">
            Email us at{" "}
            <a href={`mailto:${supportEmail}`} className="text-green-700 underline">
              {supportEmail}
            </a>
            .
          </p>
        ) : (
          <p className="mb-4 text-gray-700">Contact details are coming soon.</p>
        )}

        <p className="mb-8 text-gray-600">
          We read every message and reply as soon as we can. Please include the email address of your account and,
          for an order question, the order reference, so we can look into it without asking again.
        </p>

        <h2 className="mb-3 text-lg font-semibold text-gray-900">Before you write</h2>
        <ul className="space-y-2 text-green-700">
          <li>
            <Link href="/how-it-works" className="underline">
              How Affilova works
            </Link>
          </li>
          <li>
            <Link href="/refund-policy" className="underline">
              Refund policy
            </Link>
          </li>
          <li>
            <Link href="/legal" className="underline">
              All legal policies
            </Link>
          </li>
          <li>
            <Link href="/about" className="underline">
              About Affilova
            </Link>
          </li>
        </ul>
      </main>

      <GlobalFooter />
    </div>
  )
}
