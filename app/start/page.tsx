import type { Metadata } from "next"
import Link from "next/link"

import { AuthShell } from "@/components/auth/auth-shell"
import { StatusBadge, type StatusMap } from "@/components/ds/status-badge"
import { CheckCircle, CircleDashed, Megaphone, Storefront, type IconComponent } from "@/components/ds/icons"
import { Button } from "@/components/ui/button"
import { requireUser } from "@/lib/identity/guards"
import {
  COMMISSION_HOLD_DAYS,
  COMMISSION_RANGE_PERCENT,
  MIN_WITHDRAWAL_NAIRA,
  PAYOUT_DAYS_TEXT,
  PLATFORM_FEE_PERCENT,
  WITHDRAWAL_FEE,
  formatNairaWhole,
} from "@/lib/site-config"

export const metadata: Metadata = {
  title: "Choose how you use Affilova",
  robots: { index: false, follow: false },
}

// The page a new account lands on after confirming an email.
//
// Two cards, each stating what that role does and what it costs, in the words the
// product uses elsewhere and with every number read from lib/site-config.ts. A
// role the account already holds shows as Active and has nothing to press; a role
// it does not hold shows as Not set up and has one button.
//
// Nothing here decides access. Each setup page checks for itself, and the role is
// only ever granted by the database function those pages call.

type RoleCard = {
  title: string
  facts: string[]
  href: string
  action: string
  role: "vendor" | "affiliate"
  active: boolean
  icon: IconComponent
}

const ROLE_STATUS: StatusMap<"active" | "inactive"> = {
  active: { tone: "success", label: "Active", icon: CheckCircle },
  inactive: { tone: "neutral", label: "Not set up", icon: CircleDashed },
}

export default async function StartPage() {
  const { roles } = await requireUser("/start")

  return <RoleChooser roles={roles} />
}

/** The chooser itself, so a preview or a test can render it with fixed roles. */
export function RoleChooser({ roles }: { roles: readonly string[] }) {
  const cards: RoleCard[] = [
    {
      title: "Sell your own products",
      facts: [
        `Affilova keeps ${PLATFORM_FEE_PERCENT}% of each sale.`,
        `You set the commission affiliates earn, from ${COMMISSION_RANGE_PERCENT.min}% to ${COMMISSION_RANGE_PERCENT.max}%.`,
        `Payouts are sent ${PAYOUT_DAYS_TEXT}.`,
      ],
      href: "/start/vendor",
      action: "Set up your store",
      role: "vendor",
      active: roles.includes("vendor"),
      icon: Storefront,
    },
    {
      title: "Promote other people's products",
      facts: [
        `You earn the commission the vendor sets, from ${COMMISSION_RANGE_PERCENT.min}% to ${COMMISSION_RANGE_PERCENT.max}%.`,
        `Commission is confirmed ${COMMISSION_HOLD_DAYS} days after the order.`,
        `You can withdraw from ${formatNairaWhole(MIN_WITHDRAWAL_NAIRA)}. Withdrawals cost ${WITHDRAWAL_FEE.percent}%, from ${formatNairaWhole(WITHDRAWAL_FEE.minNaira)} to ${formatNairaWhole(WITHDRAWAL_FEE.capNaira)}.`,
      ],
      href: "/start/affiliate",
      action: "Set up your profile",
      role: "affiliate",
      active: roles.includes("affiliate"),
      icon: Megaphone,
    },
  ]

  return (
    <AuthShell
      panel={{
        heading: "Choose how you use Affilova",
        body: "Your account can sell, promote, or do both.",
      }}
    >
      <h1 className="text-h1 text-foreground">Choose how you use Affilova</h1>
      <p className="mt-2 text-body text-text-muted">
        Set up the parts of your account you want to use now.
      </p>

      <ul className="mt-6 space-y-4">
        {cards.map((card) => (
          <li key={card.role} className="rounded-lg border border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <card.icon size="md" className="shrink-0 text-brand-600" />
                <h2 className="text-h3 text-foreground">{card.title}</h2>
              </div>
              <StatusBadge
                status={card.active ? "active" : "inactive"}
                map={ROLE_STATUS}
                size="md"
                className="mt-0.5 shrink-0"
              />
            </div>

            <ul className="mt-3 space-y-1.5 text-dense text-text-muted">
              {card.facts.map((fact) => (
                <li key={fact} className="flex gap-2">
                  <span aria-hidden="true" className="select-none text-text-subtle">
                    ·
                  </span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>

            {card.active ? null : (
              <Button asChild className="mt-4">
                <Link href={card.href}>{card.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-5 text-small text-text-muted">
        You can do both. Set up one now and the other whenever you need it.
      </p>
    </AuthShell>
  )
}
