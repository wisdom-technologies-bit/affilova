"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"

import type { AlertVariant } from "@/lib/identity/auth-ui"
import { cn } from "@/lib/utils"

// Form-level message box. Every variant carries an icon and a screen-reader
// prefix, so the meaning never rests on colour alone.

const STYLES: Record<AlertVariant, string> = {
  error: "border-red-300 bg-red-50 text-red-800",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  info: "border-slate-300 bg-slate-50 text-slate-800",
}

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
} as const

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
  const Icon = ICONS[variant]

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus()
    }
  }, [autoFocus])

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={autoFocus ? -1 : undefined}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        STYLES[variant],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="sr-only">{LABELS[variant]} </span>
        {children}
      </span>
    </div>
  )
}
