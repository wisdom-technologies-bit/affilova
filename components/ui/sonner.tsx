'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:rounded-md group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-overlay group-[.toaster]:text-dense',
          description: 'group-[.toast]:text-text-muted',
          actionButton:
            'group-[.toast]:rounded-sm group-[.toast]:bg-primary group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-caption group-[.toast]:font-medium group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:rounded-sm group-[.toast]:bg-surface-muted group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-caption group-[.toast]:font-medium group-[.toast]:text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
