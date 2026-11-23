import { PageHeader } from "@/components/app-shell/page-header"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { RefundRequestsPanel } from "@/components/merchant/refund-requests"
import { SalesTabs, salesTabFromParam } from "@/components/merchant/sales-tabs"
import { SalesView } from "@/components/merchant/sales-view"
import { firstParam, type SearchParams } from "@/lib/dates/range-params"
import { getVendorRefundRequestsAction, getVendorSalesAction } from "@/lib/merchant/actions"
import type { Page, VendorRefundRow, VendorSaleRow } from "@/lib/merchant/types"

// The merchant's sales: the orders that included their products, and the refund
// requests waiting on them.
//
// The tabs are links, so the view is in the address bar. Neither view carries a
// buyer's name or email, because the database does not return one.

export default async function MerchantSalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const tab = salesTabFromParam(firstParam(params, "tab"))

  if (tab === "refunds") {
    const result = await getVendorRefundRequestsAction({ limit: 20 })
    const page: Page<VendorRefundRow> = result.ok ? result.data : { items: [], nextCursor: null }

    return (
      <>
        <PageHeader title="Sales" />
        <SalesTabs tab={tab} />
        <p className="mb-4 mt-4 max-w-2xl text-sm text-muted-foreground">
          Buyers who asked for their money back on one of your orders. Approving a request refunds
          the buyer and withdraws the files; rejecting it needs a reason they will read.
        </p>

        <RefundRequestsPanel
          initialPage={page}
          initialError={result.ok ? null : result.error}
        />
      </>
    )
  }

  const status = tab === "all" ? null : tab
  const result = await getVendorSalesAction({ status: status ?? undefined, limit: 20 })
  const page: Page<VendorSaleRow> = result.ok ? result.data : { items: [], nextCursor: null }

  return (
    <>
      <PageHeader title="Sales" />
      <SalesTabs tab={tab} />
      <p className="mb-4 mt-4 max-w-2xl text-sm text-muted-foreground">
        Every order that included one of your products, newest first. Gross is what the buyer paid;
        your earnings are what is left after the platform fee, the affiliate commission and VAT.
      </p>

      {result.ok ? null : <ErrorNotice message={result.error} />}

      <div className="mt-4">
        <SalesView initialPage={page} initialError={null} status={status} />
      </div>
    </>
  )
}
