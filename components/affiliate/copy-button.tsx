"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"

// Copy a value to the clipboard, and say so.
//
// The confirmation is written into a live region next to the button, so it is
// heard as well as seen, and it clears itself after a moment. When the clipboard
// is not available (an old browser, a denied permission) the button says so in
// words instead of pretending it worked.

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
        className={
          className ??
          "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        }
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
