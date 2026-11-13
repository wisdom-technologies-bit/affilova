import type { InputHTMLAttributes, ReactNode } from "react"
import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"

// A labelled text input with optional helper text, an inline error and an
// optional control on the right (used by the password field for show/hide).
// autocomplete, inputMode, name and every other input attribute come from the
// caller, so each field states its own purpose explicitly.

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  id: string
  label: string
  hint?: string
  error?: string
  trailing?: ReactNode
  className?: string
}

export function TextField({
  id,
  label,
  hint,
  error,
  trailing,
  className,
  ...props
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter((value) => value !== undefined).join(" ")

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
      </label>

      <div className="relative mt-1.5">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          className={cn(
            "h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-900",
            "placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
            error ? "border-red-400" : "border-slate-300",
            trailing ? "pr-12" : undefined,
          )}
          {...props}
        />

        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1 text-xs text-red-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
