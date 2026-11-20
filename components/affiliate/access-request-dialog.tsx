"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { requestAccessAction } from "@/lib/affiliate/actions"
import type { MarketplaceItem } from "@/lib/affiliate/read-types"

// Ask a vendor for permission to promote one product.
//
// The note is optional and limited to the 500 characters the database accepts.
// A request is idempotent in the database, so pressing twice cannot create two
// rows; the screen says the request is in rather than pretending it was
// approved.

export function AccessRequestDialog({
  item,
  onClose,
  onRequested,
}: {
  item: MarketplaceItem | null
  onClose: () => void
  onRequested: (productId: string) => void
}) {
  const [note, setNote] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  function close(): void {
    if (working) {
      return
    }

    setNote("")
    setError(null)
    setSent(false)
    onClose()
  }

  async function submit(): Promise<void> {
    if (item === null || working) {
      return
    }

    setWorking(true)
    setError(null)

    const result = await requestAccessAction({
      productId: item.productId,
      note: note.trim() === "" ? undefined : note.trim(),
    })

    if (result.ok) {
      setSent(true)
      onRequested(item.productId)
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  return (
    <Dialog open={item !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request access</DialogTitle>
          <DialogDescription>
            {item === null
              ? ""
              : `Ask ${item.vendorName} for permission to promote ${item.title}. They decide, and you will see their answer here.`}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-brand-ink">
              Your request has been sent. You can create a link once the vendor approves it.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="access-note" className="block text-sm font-medium text-brand-ink">
                Add a note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Say where you would promote it. Keep it under 500 characters.
              </p>
              <textarea
                id="access-note"
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 500))}
                maxLength={500}
                rows={4}
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
                onClick={close}
                disabled={working}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void submit()
                }}
                disabled={working}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {working ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
