import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'focus-ring flex min-h-[88px] w-full rounded-md border border-border-control bg-background px-3 py-2 text-dense text-foreground transition-colors duration-150 placeholder:text-text-subtle disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle aria-[invalid=true]:border-danger',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Textarea }
