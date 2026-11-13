import type { ReactNode } from "react"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

// The primary action of every auth form: full width, 44px high, brand-600 with
// white text (4.96:1), brand-700 on hover, a spinner and aria-busy while the
// request is in flight, and a real disabled state.

export interface SubmitButtonProps {
  children: ReactNode
  pending?: boolean
  disabled?: boolean
  className?: string
}

export function SubmitButton({
  children,
  pending = false,
  disabled = false,
  className,
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4",
        "text-sm font-semibold text-white transition-colors duration-150",
        "hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {pending ? <Spinner className="text-white" /> : null}
      {children}
    </button>
  )
}
