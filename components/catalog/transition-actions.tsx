"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import { readinessLabel } from "@/components/catalog/readiness-checklist"
import { transitionProductAction } from "@/lib/catalog/actions/vendor"
import type { ProductStatus } from "@/lib/catalog/action-types"

// The buttons a product's current status allows.
//
// Every button names the transition, and its dialog says what the transition
// costs: who sees the product afterwards, and whether it can be undone. Submit
// stays disabled while the readiness list has gaps, and says which gaps.

type Transition = "submit" | "withdraw" | "pause" | "resume" | "archive"

type Option = {
  action: Transition
  label: string
  title: string
  consequence: string
  confirmLabel: string
  tone?: "default" | "destructive"
}

const OPTIONS: Readonly<Record<Transition, Option>> = {
  submit: {
    action: "submit",
    label: "Submit for review",
    title: "Submit this product for review?",
    consequence:
      "A reviewer from Affilova will look at the details, the price and the files. You cannot edit the product, its files or its images until the review is finished.",
    confirmLabel: "Submit for review",
  },
  withdraw: {
    action: "withdraw",
    label: "Withdraw",
    title: "Take this product out of the review queue?",
    consequence:
      "The reviewer will no longer see it. The product goes back to draft, where you can edit it and submit it again.",
    confirmLabel: "Withdraw",
  },
  pause: {
    action: "pause",
    label: "Pause",
    title: "Pause this product?",
    consequence:
      "It stops being listed in the marketplace while it is paused. Existing affiliate links keep working, but nothing new can be sold until you resume it.",
    confirmLabel: "Pause",
  },
  resume: {
    action: "resume",
    label: "Resume",
    title: "Put this product back in the marketplace?",
    consequence: "It is listed again straight away, and affiliate links can earn again.",
    confirmLabel: "Resume",
  },
  archive: {
    action: "archive",
    label: "Archive",
    title: "Archive this product?",
    consequence:
      "It leaves your product list and cannot be edited or submitted again. A reviewer can still see it in the record of your store.",
    confirmLabel: "Archive",
    tone: "destructive",
  },
}

function allowedActions(status: ProductStatus): Transition[] {
  switch (status) {
    case "draft":
    case "rejected":
      return ["submit", "archive"]
    case "submitted":
      return ["withdraw"]
    case "live":
      return ["pause"]
    case "paused":
      return ["resume", "archive"]
    case "archived":
      return []
    default:
      return []
  }
}

export function TransitionActions({
  productId,
  status,
  missing = [],
}: {
  productId: string
  status: ProductStatus
  missing?: readonly string[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const actions = allowedActions(status)

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        An archived product has no actions left. It cannot be restored.
      </p>
    )
  }

  const submitBlocked = status === "draft" || status === "rejected" ? missing.length > 0 : false

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {actions.map((action) => {
          const option = OPTIONS[action]
          const blocked = action === "submit" && submitBlocked
          const disabledReason = blocked
            ? `Still missing: ${missing.map(readinessLabel).join(", ")}.`
            : undefined

          return (
            <div key={action} className="flex flex-col">
              <ConfirmDialog
                title={option.title}
                description={option.consequence}
                confirmLabel={option.confirmLabel}
                tone={option.tone ?? "default"}
                disabled={blocked}
                disabledReason={disabledReason}
                trigger={
                  <span className="inline-flex items-center">
                    {option.label}
                  </span>
                }
                triggerClassName={`inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  option.tone === "destructive"
                    ? "border border-input text-brand-ink hover:bg-accent"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
                onConfirm={async () => {
                  const result = await transitionProductAction({ productId, action })

                  if (!result.ok) {
                    setError(result.error)

                    return false
                  }

                  setError(null)
                  router.refresh()

                  return true
                }}
              />
              {blocked && disabledReason !== undefined ? (
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">{disabledReason}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
