"use client"

import { useEffect, useId, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// A confirmation before something that cannot be undone: a payout sent, an
// account removed, a product taken down.
//
// What makes it a confirmation and not a speed bump:
//   * the title names the action ("Send this payout"), not "Are you sure?";
//   * the consequence is written out in ordinary words: what will happen, and
//     what cannot be taken back;
//   * the confirm button is named after the action, not "OK";
//   * where the action is irreversible and expensive, typedConfirmation asks the
//     person to type a word before the button unlocks. That is the difference
//     between a mis-click and a decision.
//
// It is a real dialog: role="dialog", aria-modal, named by its title and
// described by its consequence, Escape closes it, focus starts inside it and
// returns to the control that opened it. It renders in place rather than into a
// portal, so it needs no client-only mount and can be rendered on the server (and
// in a test) when it is open.

export interface ConfirmDialogProps {
  /** Whether it is showing. Controlled, so the caller owns the state. */
  open: boolean
  /** Called with false on Escape, on Cancel, and after a confirmed action. */
  onOpenChange: (open: boolean) => void
  /** What is about to happen, as a sentence: "Send ₦45,000 to GTBank ••••4821". */
  title: string
  /** What that means, and what cannot be undone. Plain words, no scare tactics. */
  consequence: string
  /** The action's own verb, on the button: "Send payout". */
  confirmLabel: string
  /** The way out. "Cancel" unless the screen has a better word. */
  cancelLabel?: string
  /** `danger` marks the action as destructive. It still carries its own label. */
  tone?: "default" | "danger"
  /** Asks for a word to be typed before the action is unlocked. */
  typedConfirmation?: {
    /** The exact word or phrase that has to be typed. */
    word: string
    /** The instruction above the input. Defaults to `Type ${word} to confirm`. */
    label?: string
  }
  /** True while the action is in flight: the buttons are disabled and say so. */
  pending?: boolean
  /** The action. It may be async; the dialog stays open until the caller closes it. */
  onConfirm: () => void | Promise<void>
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  typedConfirmation,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const [typed, setTyped] = useState("")
  const titleId = useId()
  const consequenceId = useId()
  const typedId = useId()

  const locked = typedConfirmation !== undefined && typed.trim() !== typedConfirmation.word

  // Focus moves into the dialog when it opens and back to the control that
  // opened it when it closes, so a keyboard user is never dropped at the top of
  // the page.
  useEffect(() => {
    if (!open) {
      return
    }

    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    return () => {
      restoreFocus.current?.focus()
    }
  }, [open])

  // Escape closes, Tab cycles inside, and the page behind does not scroll.
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !pending) {
        event.preventDefault()
        onOpenChange(false)
        return
      }

      if (event.key !== "Tab" || panel.current === null) {
        return
      }

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      )

      if (focusable.length === 0) {
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onOpenChange, pending])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden="true" className="absolute inset-0 bg-foreground/40" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={consequenceId}
        className="relative w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-overlay"
      >
        <h2 id={titleId} className="text-h3 text-foreground">
          {title}
        </h2>

        <p id={consequenceId} className="mt-2 text-dense text-text-muted">
          {consequence}
        </p>

        {typedConfirmation === undefined ? null : (
          <div className="mt-4">
            <label htmlFor={typedId} className="block text-small font-medium text-foreground">
              {typedConfirmation.label ?? `Type ${typedConfirmation.word} to confirm`}
            </label>
            <input
              id={typedId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="focus-ring mt-1.5 h-control-md w-full rounded-md border border-border-control bg-background px-3 text-dense text-foreground"
            />
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="focus-ring inline-flex h-control-md items-center justify-center rounded-md border border-border-control bg-background px-4 text-small font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={pending || locked}
            aria-busy={pending}
            onClick={() => {
              void onConfirm()
            }}
            className={cn(
              "focus-ring inline-flex h-control-md items-center justify-center gap-2 rounded-md px-4 text-small font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
              tone === "danger"
                ? "bg-danger text-background hover:bg-danger/90"
                : "bg-primary text-primary-foreground hover:bg-brand-700",
            )}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
