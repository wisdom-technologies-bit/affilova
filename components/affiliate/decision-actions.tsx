"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { decideAccessAction } from "@/lib/affiliate/actions"
import type { AffiliateRequestRow } from "@/lib/affiliate/read-types"

// Approve, decline or block one affiliate for one product.
//
// The dialog says what the decision means before it is made: approving lets them
// create links, declining leaves them able to ask again, and blocking also
// archives the links they already made for the product. The note is optional and
// is shown to the affiliate for a decline.

const DECISIONS = [
  {
    value: "approved",
    label: "Approve",
    title: "Approve this affiliate?",
    description:
      "They can create links for this product straight away. You can block them later if something goes wrong.",
    confirm: "Approve",
  },
  {
    value: "rejected",
    label: "Decline",
    title: "Decline this request?",
    description:
      "They cannot promote this product for now. They can ask again, and you can change your mind later.",
    confirm: "Decline request",
  },
  {
    value: "blocked",
    label: "Block",
    title: "Block this affiliate?",
    description:
      "They cannot promote this product, and any links they already made for it stop working. Blocking wins over everything else.",
    confirm: "Block affiliate",
  },
] as const

export function DecisionActions({ request }: { request: AffiliateRequestRow }) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: "approved" | "rejected" | "blocked"): Promise<void> {
    setWorking(true)
    setError(null)

    const result = await decideAccessAction({
      affiliateId: request.affiliateId,
      productId: request.productId,
      decision,
      note: note.trim() === "" ? undefined : note.trim(),
    })

    if (result.ok) {
      setOpen(null)
      setNote("")
      router.refresh()
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {DECISIONS.map((decision) => (
        <Dialog
          key={decision.value}
          open={open === decision.value}
          onOpenChange={(next) => {
            setOpen(next ? decision.value : null)
            setError(null)
          }}
        >
          <DialogTrigger
            className={
              decision.value === "approved"
                ? "inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                : "inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            }
          >
            {decision.label}
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>{decision.title}</DialogTitle>
              <DialogDescription>
                {request.username} asked to promote {request.productTitle}. {decision.description}
              </DialogDescription>
            </DialogHeader>

            <div>
              <label htmlFor={`note-${decision.value}`} className="block text-sm font-medium text-brand-ink">
                Note to the affiliate <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id={`note-${decision.value}`}
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              />
            </div>

            {error === null ? null : (
              <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(null)}
                disabled={working}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void decide(decision.value)
                }}
                disabled={working}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {working ? "Saving…" : decision.confirm}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  )
}
