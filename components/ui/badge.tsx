import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// A badge is a quiet label, not a status. For a status use StatusBadge from
// components/ds, which always carries an icon and a word.
//
// The shape is a rounded rectangle, not a pill: a pill is reserved for a status,
// so a page never confuses "Beta" with "Paid".
const badgeVariants = cva(
  'focus-ring inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption font-medium transition-colors duration-150',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-muted text-foreground',
        secondary: 'border-border bg-surface-subtle text-text-muted',
        destructive: 'border-danger/40 bg-danger-subtle text-danger',
        outline: 'border-border bg-background text-text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
