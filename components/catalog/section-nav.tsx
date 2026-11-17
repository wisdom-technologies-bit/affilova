// The sections of the edit page, as a sticky list on a wide screen.
//
// Plain anchors: no JavaScript, and the browser's own focus handling after a
// jump works. Each section carries scroll-mt so the heading is not hidden under
// the topbar when it is jumped to.

const SECTIONS = [
  { id: "status", label: "Status" },
  { id: "details", label: "Details" },
  { id: "pricing", label: "Pricing and affiliates" },
  { id: "files", label: "Files" },
  { id: "images", label: "Images" },
  { id: "actions", label: "Actions" },
] as const

export function SectionNav() {
  return (
    <nav aria-label="Sections of this product" className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
      <ul className="space-y-1 border-l border-border">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex min-h-[44px] items-center border-l-2 border-transparent pl-3 text-sm text-muted-foreground transition-colors duration-150 hover:border-brand-600 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
