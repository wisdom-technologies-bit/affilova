import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The primary action of every auth form: full width, 44px high, brand-600 with
// white text (5.09:1), brand-700 on hover, a spinner and aria-busy while the
// request is in flight, and a real disabled state.
//
// It is the design system's Button in its large size, so it cannot drift from
// the primary action on every other screen.

export interface SubmitButtonProps {
  children: ReactNode
  pending?: boolean
  disabled?: boolean
  className?: string
}

export function SubmitButton({ children, pending = false, disabled = false, className }: SubmitButtonProps) {
  return (
    <Button type="submit" size="lg" loading={pending} disabled={disabled} className={cn("w-full", className)}>
      {children}
    </Button>
  )
}
