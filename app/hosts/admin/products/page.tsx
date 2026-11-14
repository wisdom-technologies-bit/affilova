import { EmptyState } from "@/components/app-shell/empty-state"
import { PageHeader } from "@/components/app-shell/page-header"

export default function AdminProductsPage() {
  return (
    <>
      <PageHeader title="Products" />
      <EmptyState />
    </>
  )
}
