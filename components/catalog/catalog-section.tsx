import type { ReactNode } from "react"

// One titled block of the edit and review pages, with a stable id the section
// navigation and the readiness links point at.

export function CatalogSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <div className="mb-4 border-b border-border pb-2">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-brand-ink">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}
