import type { Metadata } from "next"
import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { requireUser } from "@/lib/identity/guards"

export const metadata: Metadata = {
  title: "Choose how you use Affilova",
  robots: { index: false, follow: false },
}

// The page a new account lands on after confirming an email: it shows which of
// the two roles the account already holds and offers the one it does not.
//
// Nothing here decides access. Each setup page checks for itself, and the role
// is only ever granted by the database function those pages call.

type RoleCard = {
  title: string
  body: string
  href: string
  role: "vendor" | "affiliate"
  active: boolean
}

const CARD_CLASS = "block rounded-xl border border-[#E3E6E3] p-4 transition-colors duration-150"
const LINK_CLASS = `${CARD_CLASS} hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2`

export default async function StartPage() {
  const { roles } = await requireUser("/start")

  const cards: RoleCard[] = [
    {
      title: "Sell products",
      body: "Set up a store address for your business.",
      href: "/start/vendor",
      role: "vendor",
      active: roles.includes("vendor"),
    },
    {
      title: "Promote products",
      body: "Set up a username and choose where you promote.",
      href: "/start/affiliate",
      role: "affiliate",
      active: roles.includes("affiliate"),
    },
  ]

  return (
    <AuthShell
      panel={{
        heading: "Choose how you use Affilova.",
        body: "Your account can sell, promote, or do both.",
      }}
    >
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Choose how you use Affilova.
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Set up the parts of your account you want to use now.
      </p>

      <ul className="mt-6 space-y-3">
        {cards.map((card) => (
          <li key={card.role}>
            {card.active ? (
              <div className={CARD_CLASS}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                  <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
                    Active: {card.role}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{card.body}</p>
              </div>
            ) : (
              <Link href={card.href} className={LINK_CLASS}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                    Not set up
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{card.body}</p>
              </Link>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm text-slate-600">You can do both.</p>
    </AuthShell>
  )
}
