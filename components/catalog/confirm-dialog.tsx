"use client"

import { useState, type ReactNode } from "react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// A confirmation before something a person cannot simply undo.
//
// The title says what will happen, the body says what that means in ordinary
// words, and the button that does it is named after the action rather than
// "OK". Escape and Cancel both leave without doing anything.

export function ConfirmDialog({
  trigger,
  triggerClassName,
  title,
  description,
  confirmLabel,
  workingLabel = "Working…",
  tone = "default",
  disabled = false,
  disabledReason,
  onConfirm,
  children,
}: {
  trigger: ReactNode
  triggerClassName?: string
  title: string
  description: ReactNode
  confirmLabel: string
  workingLabel?: string
  tone?: "default" | "destructive"
  disabled?: boolean
  disabledReason?: string
  onConfirm: () => Promise<boolean>
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)

  const confirmClasses =
    tone === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      : "bg-brand-600 text-white hover:bg-brand-700"

  return (
    <Dialog open={open} onOpenChange={(next) => (working ? undefined : setOpen(next))}>
      <DialogTrigger
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className={triggerClassName}
      >
        {trigger}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>

        {children}

        <DialogFooter className="gap-2">
          <DialogClose
            type="button"
            disabled={working}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            Cancel
          </DialogClose>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true)
              void onConfirm()
                .then((done) => {
                  if (done) {
                    setOpen(false)
                  }
                })
                .finally(() => setWorking(false))
            }}
            className={`inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 ${confirmClasses}`}
          >
            {working ? workingLabel : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
