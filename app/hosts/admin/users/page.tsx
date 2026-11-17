import { EmptyState } from "@/components/app-shell/empty-state"
import { PageHeader } from "@/components/app-shell/page-header"

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader title="Users" />
      <EmptyState />
    </>
  )
}
