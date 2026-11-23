import Link from "next/link"

// The sales tabs: a plain link per tab, so the tab is in the address bar and the
// page works before any JavaScript loads. The current tab is marked with
// aria-current, not with a colour alone.

export const SALES_TAB_LINKS = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
  { value: "disputed", label: "Disputed" },
  { value: "refunds", label: "Refund requests" },
] as const

export type SalesTabValue = (typeof SALES_TAB_LINKS)[number]["value"]

export function salesTabFromParam(value: string | undefined): SalesTabValue {
  return SALES_TAB_LINKS.find((tab) => tab.value === value)?.value ?? "all"
}

export function SalesTabs({ tab }: { tab: SalesTabValue }) {
  return (
    <nav aria-label="Sales views">
      <ul className="flex flex-wrap gap-1">
        {SALES_TAB_LINKS.map((entry) => {
          const current = entry.value === tab

          return (
            <li key={entry.value}>
              <Link
                href={`/sales?tab=${entry.value}`}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center rounded-md border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                  current
                    ? "border-brand-600 bg-brand-50 font-medium text-brand-800"
                    : "border-border text-brand-ink hover:bg-accent"
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
