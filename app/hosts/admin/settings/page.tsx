import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { BlackoutDatesPanel } from "@/components/payouts/blackout-dates-panel"
import { PayoutSettingsPanel } from "@/components/payouts/payout-settings-panel"
import { getPayoutSettingsAction, listBlackoutDatesAction } from "@/lib/payouts/actions"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "payouts", label: "Payout settings" },
  { id: "blackout", label: "Blackout dates" },
] as const

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>
}) {
  const raw = (await searchParams)?.tab
  const tab = raw === "blackout" ? "blackout" : "payouts"

  const content =
    tab === "blackout" ? await blackoutContent() : await settingsContent()

  return (
    <>
      <PageHeader title="Settings" />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={entry.id === "payouts" ? "/settings" : `/settings?tab=${entry.id}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-md border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
              tab === entry.id ? "border-brand-600 bg-brand-50 text-brand-800" : "border-input text-brand-ink hover:bg-accent"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {content}
    </>
  )
}

async function settingsContent() {
  const result = await getPayoutSettingsAction()

  return <PayoutSettingsPanel snapshot={result.ok ? result.data : null} error={result.ok ? null : result.error} />
}

async function blackoutContent() {
  const result = await listBlackoutDatesAction()

  return <BlackoutDatesPanel days={result.ok ? result.data : null} error={result.ok ? null : result.error} />
}
