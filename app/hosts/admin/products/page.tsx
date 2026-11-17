import { PageHeader } from "@/components/app-shell/page-header"
import { ReviewQueue } from "@/components/catalog/review-queue"
import { listReviewQueueAction } from "@/lib/catalog/actions/admin"

// The review queue: every product that is waiting, oldest first.

export default async function AdminProductsPage() {
  const result = await listReviewQueueAction({})

  return (
    <>
      <PageHeader title="Products" />

      <p className="mb-6 text-sm text-muted-foreground">
        Products submitted by vendors, oldest first. A decision here reaches the vendor immediately.
      </p>

      <ReviewQueue
        initialItems={result.ok ? result.items : []}
        initialCursor={result.ok ? result.nextCursor : null}
        initialError={result.ok ? null : result.error}
        nowIso={new Date().toISOString()}
      />
    </>
  )
}
