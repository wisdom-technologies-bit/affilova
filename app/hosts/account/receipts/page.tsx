import { EmptyState } from "@/components/app-shell/empty-state"
import { PageHeader } from "@/components/app-shell/page-header"

export default function AccountReceiptsPage() {
  return (
    <>
      <PageHeader title="Receipts" />
      <EmptyState />
    </>
  )
}
