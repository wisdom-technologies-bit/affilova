"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import { describedBy, FormField } from "@/components/forms/form-field"
import { reviewProductAction, staffPauseProductAction } from "@/lib/catalog/actions/admin"
import type { ProductStatus } from "@/lib/catalog/action-types"

// The decision on a product under review: approve, reject with a reason, or
// pause something that is already live.
//
// A rejection needs at least ten characters, because the reason is what the
// vendor reads to know what to fix. Pausing needs a reason for the same reason.

const MIN_REASON = 10
const MAX_REASON = 1000

function ReasonDialog({
  trigger,
  triggerClassName,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
}: {
  trigger: React.ReactNode
  triggerClassName: string
  title: string
  description: string
  confirmLabel: string
  tone?: "default" | "destructive"
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  return (
    <ConfirmDialog
      trigger={trigger}
      triggerClassName={triggerClassName}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      onConfirm={async () => {
        const trimmed = reason.trim()

        if (trimmed.length < MIN_REASON) {
          setError(`Write at least ${MIN_REASON} characters. The vendor reads this.`)

          return false
        }

        return onConfirm(trimmed)
      }}
    >
      <FormField
        id="review-reason"
        label="Reason"
        required
        error={error}
        hint={`${reason.trim().length} of ${MAX_REASON} characters.`}
      >
        <textarea
          id="review-reason"
          value={reason}
          rows={5}
          maxLength={MAX_REASON}
          onChange={(event) => {
            setReason(event.target.value)
            setError(null)
          }}
          aria-describedby={describedBy("review-reason")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>
    </ConfirmDialog>
  )
}

const BUTTON =
  "inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
const PRIMARY = `${BUTTON} bg-brand-600 text-white hover:bg-brand-700`
const QUIET = `${BUTTON} border border-input text-brand-ink hover:bg-accent`

export function ReviewActions({ productId, status }: { productId: string; status: ProductStatus }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const underReview = status === "submitted"
  const canPause = status === "live"

  async function decide(decision: "approve" | "reject", reason: string | null): Promise<boolean> {
    const result = await reviewProductAction({
      productId,
      decision,
      ...(reason === null ? {} : { reason }),
    })

    if (!result.ok) {
      setError(result.error)

      return false
    }

    setError(null)
    router.refresh()

    return true
  }

  return (
    <div className="space-y-4">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {underReview ? null : (
        <p className="text-sm text-muted-foreground">
          This product is not waiting for review, so there is no approve or reject decision to make.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {underReview ? (
          <>
            <ConfirmDialog
              trigger={<span>Approve</span>}
              triggerClassName={PRIMARY}
              title="Approve this product?"
              description="It goes live in the marketplace straight away, and affiliates can start promoting it."
              confirmLabel="Approve"
              onConfirm={() => decide("approve", null)}
            />

            <ReasonDialog
              trigger={<span>Reject</span>}
              triggerClassName={QUIET}
              title="Reject this product?"
              description="The vendor sees your reason and can fix the product and submit it again."
              confirmLabel="Reject product"
              tone="destructive"
              onConfirm={(reason) => decide("reject", reason)}
            />
          </>
        ) : null}

        {canPause ? (
          <ReasonDialog
            trigger={<span>Pause this product</span>}
            triggerClassName={QUIET}
            title="Pause this product?"
            description="It stops being listed in the marketplace until an admin or the vendor resumes it. The vendor is not told why unless you write it here."
            confirmLabel="Pause product"
            onConfirm={async (reason) => {
              const result = await staffPauseProductAction({ productId, reason })

              if (!result.ok) {
                setError(result.error)

                return false
              }

              setError(null)
              router.refresh()

              return true
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
