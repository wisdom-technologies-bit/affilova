import { PageHeader as DsPageHeader } from "@/components/ds/page-header"

// The heading of a shell page.
//
// Kept as its own module because every screen imports it by this name, and kept
// as a thin wrapper so there is exactly one implementation of a page header: the
// design system's, which owns the single h1, the rule and the description.
//
// A screen that needs actions or breadcrumbs imports PageHeader from
// components/ds directly; this one stays a title-only call for the screens that
// have not been given those yet.

export function PageHeader({ title }: { title: string }) {
  return <DsPageHeader title={title} className="mb-6" />
}
