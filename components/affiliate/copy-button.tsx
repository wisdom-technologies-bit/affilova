"use client"

import {
  Check,
  Copy,
} from "@/components/ds/icons"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// Copy a value to the clipboard, and say so.
//
// The confirmation is written into a live region next to the button, so it is
// heard as well as seen, and it clears itself after a moment. When the clipboard
// is not available (an old browser, a denied permission) the button says so in
// words instead of pretending it worked.
//
// This is the inline form: the value is already on the page next to the button.
// Where the value is not visible, use CopyField from components/ds, which puts it
// in a read-only input beside the button.

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
}: {
  value: string
  label?: string
  copiedLabel?: string
  className?: string
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const text = state === "copied" ? copiedLabel : state === "failed" ? "Copy failed" : label
  const Icon = state === "copied" ? Check : Copy

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          void copy()
        }}
        className={cn(
          "focus-ring inline-flex min-h-control-md items-center gap-1.5 rounded-md border border-border-control bg-background px-3 text-small font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted",
          className,
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        {text}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? copiedLabel : state === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  )
}
