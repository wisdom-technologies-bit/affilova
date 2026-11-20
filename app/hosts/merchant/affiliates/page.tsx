import { PageHeader } from "@/components/app-shell/page-header"
import { DateRangePicker } from "@/components/affiliate/date-range-picker"
import { InvitesPanel } from "@/components/affiliate/invites-panel"
import { PerformanceTable } from "@/components/affiliate/performance-table"
import { RequestsTable } from "@/components/affiliate/requests-table"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { VendorTabs, VENDOR_TABS, type VendorTab } from "@/components/affiliate/vendor-tabs"
import {
  getAffiliateRequestsAction,
  getInvitesAction,
  getVendorAffiliateStatsAction,
} from "@/lib/affiliate/read-actions"
import type { AccessStatus, AffiliateRequestRow, InviteRow, VendorAffiliateRow } from "@/lib/affiliate/read-types"
import { listVendorProductsAction } from "@/lib/catalog/actions/vendor"
import { lagosDayOf } from "@/lib/dates/lagos"
import { firstParam, readRange, type SearchParams } from "@/lib/dates/range-params"

// The merchant's affiliates page: who asked, who is approved, who is blocked,
// how they perform, and the invitations that skip the asking.
//
// Each tab is a separate read with the vendor's id taken from the session by the
// server action. Nothing on this page can name another vendor.

const STATUS_BY_TAB: Partial<Record<VendorTab, AccessStatus>> = {
  requests: "pending",
  approved: "approved",
  blocked: "blocked",
}

function readTab(value: string | undefined): VendorTab {
  return VENDOR_TABS.find((tab) => tab.value === value)?.value ?? "requests"
}

export default async function MerchantAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const tab = readTab(firstParam(params, "tab"))
  const now = new Date()

  const productsResult = await listVendorProductsAction({ limit: 50 })
  const products = productsResult.ok
    ? productsResult.items.map((product) => ({ id: product.id, title: product.title }))
    : []

  const status = STATUS_BY_TAB[tab]

  if (status !== undefined) {
    const productId = firstParam(params, "product")
    const result = await getAffiliateRequestsAction({
      status,
      productId: productId === undefined || productId === "" ? undefined : productId,
      limit: 20,
    })

    const requests: AffiliateRequestRow[] = result.ok ? result.data.items : []

    return (
      <>
        <PageHeader title="Affiliates" />
        <VendorTabs tab={tab} />
        <p className="mb-4 mt-4 max-w-2xl text-sm text-muted-foreground">
          {tab === "requests"
            ? "Affiliates who asked to promote one of your products. Approve, decline or block them here."
            : tab === "approved"
              ? "Affiliates who may promote your products. Blocking one stops their existing links too."
              : "Affiliates you have blocked. Approving one lifts the block; their old links stay archived."}
        </p>

        <form method="get" action="/affiliates" className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value={tab} />
          <div>
            <label htmlFor="product-filter" className="block text-xs font-medium text-muted-foreground">
              Product
            </label>
            <select
              id="product-filter"
              name="product"
              defaultValue={firstParam(params, "product") ?? ""}
              className="mt-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Apply filter
          </button>
        </form>

        {result.ok ? null : <ErrorNotice message={result.error} />}
        <div className="mt-4">
          <RequestsTable requests={requests} showActions />
        </div>
      </>
    )
  }

  if (tab === "performance") {
    const { range, error: rangeError } = readRange(params, now)
    const result = await getVendorAffiliateStatsAction({
      from: range.from,
      to: range.to,
      limit: 20,
    })
    const rows: VendorAffiliateRow[] = result.ok ? result.data.items : []

    return (
      <>
        <PageHeader title="Affiliates" />
        <VendorTabs tab={tab} />
        <p className="mb-4 mt-4 max-w-2xl text-sm text-muted-foreground">
          What each affiliate brought in over the range, highest revenue first. Revenue is what
          buyers paid; commission is what you paid the affiliate.
        </p>

        {rangeError === null ? null : <ErrorNotice message={rangeError} />}
        <div className="mb-4">
          <DateRangePicker value={range} basePath="/affiliates" params={{ tab }} today={lagosDayOf(now)} />
        </div>

        {result.ok ? null : <ErrorNotice message={result.error} />}
        <div className="mt-4">
          <PerformanceTable rows={rows} />
        </div>
      </>
    )
  }

  const invitesResult = await getInvitesAction()
  const invites: InviteRow[] = invitesResult.ok ? invitesResult.data : []

  return (
    <>
      <PageHeader title="Affiliates" />
      <VendorTabs tab={tab} />
      <div className="mt-4">
        <InvitesPanel
          invites={invites}
          products={products}
          initialError={invitesResult.ok ? null : invitesResult.error}
        />
      </div>
    </>
  )
}
