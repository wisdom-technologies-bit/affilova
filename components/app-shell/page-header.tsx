/** The heading of a shell page: one h1, a rule, and nothing else. */
export function PageHeader({ title }: { title: string }) {
  return (
    <div className="mb-6 border-b border-border pb-4">
      <h1 className="text-2xl font-semibold tracking-tight text-brand-ink">{title}</h1>
    </div>
  )
}
