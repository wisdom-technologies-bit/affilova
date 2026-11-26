import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 44px, a 1px control border that clears 3:1, and the system focus
          // ring. The invalid state is a border colour plus the message a Field
          // renders, never the border alone.
          'focus-ring flex h-control-md w-full rounded-md border border-border-control bg-background px-3 py-2 text-dense text-foreground transition-colors duration-150 file:border-0 file:bg-transparent file:text-small file:font-medium file:text-foreground placeholder:text-text-subtle disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle aria-[invalid=true]:border-danger',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
