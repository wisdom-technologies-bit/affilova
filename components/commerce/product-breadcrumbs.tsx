import Link from "next/link"

import { CARD_FOCUS } from "@/components/marketplace/product-card"

// The trail above a product: Marketplace, its category, the product itself.
//
// The last crumb is the current page, so it is text rather than a link and it is
// marked aria-current. A category whose slug could not be resolved is left out
// entirely rather than linked to a page that would 404.

export interface Crumb {
  label: string
  /** Absent on the current page. */
  href?: string
}

export function ProductBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) {
    return null
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1

          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              {crumb.href === undefined || last ? (
                <span aria-current={last ? "page" : undefined} className={last ? "text-foreground" : undefined}>
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className={`${CARD_FOCUS} rounded-sm hover:text-foreground hover:underline`}>
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
