import { CircleAlert } from "lucide-react"

import { ReadinessChecklist } from "@/components/catalog/readiness-checklist"
import { StatusBadge } from "@/components/catalog/status-badge"
import type { ProductDetail, ProductReadiness } from "@/lib/catalog/action-types"
import { formatLagosDateTime } from "@/lib/catalog/format"

// Where the product stands, and what it still needs.
//
// The rejection reason is shown in full, because it is the only instruction a
// vendor gets from a reviewer, and the readiness list is the same list the
// submit button checks.

export function ProductStatusPanel({
  product,
  readiness,
}: {
  product: ProductDetail
  readiness: ProductReadiness
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={product.status} />
        <p className="text-sm text-muted-foreground">Updated {formatLagosDateTime(product.updatedAt)}</p>
      </div>

      {product.status === "rejected" && product.rejectReason !== null ? (
        <div className="rounded-md border border-destructive/40 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-brand-ink">
            <CircleAlert aria-hidden="true" className="h-4 w-4 text-destructive" />
            A reviewer rejected this product
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-brand-ink">{product.rejectReason}</p>
        </div>
      ) : null}

      {product.status === "live" && product.publishedAt !== null ? (
        <p className="text-sm text-muted-foreground">Live since {formatLagosDateTime(product.publishedAt)}</p>
      ) : null}

      <ReadinessChecklist readiness={readiness} />
    </div>
  )
}
