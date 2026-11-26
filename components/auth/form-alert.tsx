"use client"

import { useEffect, useRef, type ReactNode } from "react"

import { InlineAlert, type AlertTone } from "@/components/ds/inline-alert"
import type { AlertVariant } from "@/lib/identity/auth-ui"
import { cn } from "@/lib/utils"

// Form-level message box.
//
// The look is the design system's InlineAlert: an icon, a pale semantic surface
// and a text colour measured at 4.5:1. What this component adds is the auth
// forms' own contract: every variant is announced assertively (a form failure is
// the reason the person is still on the page), and the message can take the focus
// when it appears, so a screen reader lands on it without hunting.

const TONES: Record<AlertVariant, AlertTone> = {
  error: "danger",
  success: "success",
  info: "info",
}

const LABELS: Record<AlertVariant, string> = {
  error: "Error:",
  success: "Success:",
  info: "Information:",
}

export interface FormAlertProps {
  variant: AlertVariant
  children: ReactNode
  /** Moves focus to the message when it appears. */
  autoFocus?: boolean
  className?: string
}

export function FormAlert({ variant, children, autoFocus = false, className }: FormAlertProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus()
    }
  }, [autoFocus])

  return (
    <div ref={ref} tabIndex={autoFocus ? -1 : undefined} className={cn("focus-ring rounded-md", className)}>
      <InlineAlert tone={TONES[variant]}>
        <span className="sr-only">{LABELS[variant]} </span>
        {children}
      </InlineAlert>
    </div>
  )
}
