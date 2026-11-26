"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// A value that is meant to be copied: a tracking link, an account number.
//
// The value is in a read-only input, so it can be selected with a keyboard and
// copied by hand when the clipboard API is unavailable. The copy button says what
// happened in a live region, so a screen reader hears "Copied" without the focus
// moving, and it says "Copy failed" in words rather than silently doing nothing.
//
// The button is 44px tall: this control is used on a phone as often as on a
// desktop.

export interface CopyFieldProps {
  /** The value shown and copied. */
  value: string
  /** The field's label. Sentence case, and it names the value: "Tracking link". */
  label: string
  /** The word on the button before it is pressed. */
  copyLabel?: string
  /** The word after a successful copy. */
  copiedLabel?: string
  /** Hides the label visually, for a row where the column header says it. */
  hideLabel?: boolean
  className?: string
}

export function CopyField({
  value,
  label,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  hideLabel = false,
  className,
}: CopyFieldProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputId = `copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    }
  }, [])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setState("copied")
    } catch {
      setState("failed")
    }

    if (timer.current !== null) {
      clearTimeout(timer.current)
    }

    timer.current = setTimeout(() => setState("idle"), 4000)
  }

  const buttonText = state === "copied" ? copiedLabel : state === "failed" ? "Copy failed" : copyLabel
  const Icon = state === "copied" ? Check : Copy

  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={inputId} className={cn("block text-small font-medium text-foreground", hideLabel && "sr-only")}>
        {label}
      </label>

      <div className={cn("flex items-center gap-2", !hideLabel && "mt-1.5")}>
        <input
          id={inputId}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="focus-ring h-control-md min-w-0 flex-1 rounded-md border border-border-control bg-surface-subtle px-3 text-dense text-foreground"
        />

        <button
          type="button"
          onClick={() => {
            void copy()
          }}
          className="focus-ring inline-flex h-control-md shrink-0 items-center gap-1.5 rounded-md border border-border-control bg-background px-3 text-small font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {buttonText}
        </button>
      </div>

      <span aria-live="polite" className="sr-only">
        {state === "idle" ? "" : buttonText}
      </span>
    </div>
  )
}
