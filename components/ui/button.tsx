import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

// The button, on the tokens.
//
// Heights are the three control heights and nothing else: 36 in a dense desktop
// toolbar, 44 as the default (and the minimum on a touch screen), 52 for the one
// action on a form. Every variant draws the same 2px brand-500 focus ring, 2px
// out, and the same disabled treatment: no pointer, 60% opacity, and a label
// that still reads.
//
// `loading` is a state of the button, not a different button: it disables the
// control, sets aria-busy and draws a spinner beside the label that was already
// there, so the button does not change width while the request is in flight.
const buttonVariants = cva(
  'focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-700',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-danger/90',
        outline:
          'border border-border-control bg-background text-foreground hover:bg-surface-muted',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-border/70',
        ghost: 'text-foreground hover:bg-surface-muted',
        link: 'text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control-md px-4 text-dense',
        sm: 'h-control-sm rounded-sm px-3 text-small',
        lg: 'h-control-lg rounded-md px-5 text-body',
        icon: 'h-control-md w-control-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** The request is in flight: the button is disabled and shows a spinner. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* A button rendered as a link (asChild) must keep exactly one child, so
            the spinner is only drawn when this is a real <button>. */}
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Spinner className="text-current" /> : null}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
