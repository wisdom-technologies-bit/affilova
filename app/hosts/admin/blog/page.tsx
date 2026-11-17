import { EmptyState } from "@/components/app-shell/empty-state"
import { PageHeader } from "@/components/app-shell/page-header"

export default function AdminBlogPage() {
  return (
    <>
      <PageHeader title="Blog" />
      <EmptyState />
    </>
  )
}
