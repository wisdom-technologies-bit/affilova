import {
  WarningCircle,
  CheckCircle,
} from "@/components/ds/icons"

import type { ProductReadiness } from "@/lib/catalog/action-types"

// What still has to be done before a product can go to review.
//
// The keys are the ones public.get_product_readiness returns. Each unfinished
// item links to the section of the page where it is fixed, so "missing" is
// always one click from "done".

type ReadinessItem = {
  key: string
  label: string
  /** The id of the section on the edit page that fixes this. */
  section: string
}

const ITEMS: readonly ReadinessItem[] = [
  { key: "title", label: "A title of 3 to 120 characters", section: "details" },
  { key: "short_description", label: "A short description of at least 10 characters", section: "details" },
  { key: "description", label: "A description of at least 80 characters", section: "details" },
  { key: "category", label: "A category", section: "details" },
  { key: "price", label: "A price of at least ₦100", section: "pricing" },
  { key: "commission", label: "A commission between 5% and 80%", section: "pricing" },
  { key: "file", label: "At least one uploaded file", section: "files" },
  { key: "scan", label: "All files must pass the security scan", section: "files" },
  { key: "cover", label: "A cover image", section: "images" },
]

/** The words for one readiness key, for anywhere that needs to name a gap. */
export function readinessLabel(key: string): string {
  const known = ITEMS.find((item) => item.key === key)

  // An unfamiliar key is still listed rather than hidden: a requirement this
  // screen does not know about must not silently disappear.
  return known?.label ?? key.replace(/_/g, " ")
}

function sectionFor(key: string): string {
  return ITEMS.find((item) => item.key === key)?.section ?? "details"
}

export function ReadinessChecklist({
  readiness,
  idPrefix = "readiness",
}: {
  readiness: ProductReadiness
  idPrefix?: string
}) {
  const done = ITEMS.filter((item) => readiness.missing.every((missing) => missing !== item.key))

  if (readiness.missing.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-ink">
        <CheckCircle aria-hidden="true" className="h-4 w-4 text-brand-700" />
        Everything a reviewer needs is here. This product can be submitted.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-brand-ink">
        {readiness.missing.length === 1
          ? "One thing is still missing before this product can be submitted."
          : `${readiness.missing.length} things are still missing before this product can be submitted.`}
      </p>

      <ul className="space-y-2">
        {readiness.missing.map((key) => (
          <li key={key}>
            <a
              href={`#${sectionFor(key)}`}
              className="flex min-h-[44px] items-center gap-2 rounded-md px-1 text-sm text-brand-ink underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              <WarningCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" />
              <span>
                {readinessLabel(key)}
                <span className="sr-only"> (still needed, go to the section that fixes it)</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      {done.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Done</p>
          <ul className="mt-1 space-y-1" aria-label="Requirements already met">
            {done.map((item) => (
              <li key={`${idPrefix}-${item.key}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-700" />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
