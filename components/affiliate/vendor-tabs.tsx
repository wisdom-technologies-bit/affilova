import Link from "next/link"

// The five views of the merchant's affiliate programme.
//
// Tabs are links, not client state: the address bar says which one is open, a
// refresh keeps it, and the back button works. The current tab carries
// aria-current as well as a border, so it is not signalled by colour alone.

export type VendorTab = "requests" | "approved" | "blocked" | "performance" | "invites"

export const VENDOR_TABS: readonly { value: VendorTab; label: string }[] = [
  { value: "requests", label: "Requests" },
  { value: "approved", label: "Approved" },
  { value: "blocked", label: "Blocked" },
  { value: "performance", label: "Performance" },
  { value: "invites", label: "Invites" },
]

export function VendorTabs({ tab }: { tab: VendorTab }) {
  return (
    <nav aria-label="Affiliate programme">
      <ul className="flex flex-wrap gap-1 border-b border-border pb-1">
        {VENDOR_TABS.map((entry) => {
          const current = entry.value === tab

          return (
            <li key={entry.value}>
              <Link
                href={`/affiliates?tab=${entry.value}`}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center rounded-t-md border-b-2 px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                  current
                    ? "border-brand-600 font-medium text-brand-ink"
                    : "border-transparent text-muted-foreground hover:text-brand-ink"
                }`}
              >
                {entry.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
