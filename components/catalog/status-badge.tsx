import {
  Archive,
  WarningCircle,
  CheckCircle,
  CircleDashed,
  PauseCircle,
  Clock,
  PencilLine,
  type IconComponent,
} from "@/components/ds/icons"

import type { ProductStatus } from "@/lib/catalog/action-types"
import { productStatusLabel } from "@/lib/catalog/format"

// A product's status: an icon and a word, always both. Colour is a second,
// optional signal, so the badge still reads in a screenshot, in grayscale and
// to somebody who cannot tell the shades apart.

const APPEARANCE: Record<ProductStatus, { icon: IconComponent; className: string }> = {
  draft: { icon: PencilLine, className: "border-border bg-muted text-brand-ink" },
  submitted: { icon: Clock, className: "border-border bg-background text-brand-ink" },
  live: { icon: CheckCircle, className: "border-brand-600 bg-brand-50 text-brand-800" },
  paused: { icon: PauseCircle, className: "border-border bg-background text-brand-ink" },
  rejected: { icon: WarningCircle, className: "border-destructive/40 bg-background text-destructive" },
  archived: { icon: Archive, className: "border-border bg-background text-muted-foreground" },
}

export function StatusBadge({ status }: { status: ProductStatus }) {
  const appearance = APPEARANCE[status] ?? { icon: CircleDashed, className: "border-border" }
  const Icon = appearance.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${appearance.className}`}
    >
      <Icon aria-hidden="true" size="sm" className="shrink-0" />
      {productStatusLabel(status)}
    </span>
  )
}
