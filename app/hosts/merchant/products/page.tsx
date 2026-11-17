import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { ProductList } from "@/components/catalog/product-list"
import { listVendorProductsAction } from "@/lib/catalog/actions/vendor"
import { statusTabFromParam } from "@/lib/catalog/format"

type SearchParams = Record<string, string | string[] | undefined>

// The vendor's products, one status at a time.
//
// The first page is fetched on the server so the list is in the HTML; the
// "Load more" in ProductList takes over from there with the same cursor the
// action returned.

export default async function MerchantProductsPage(props?: {
  searchParams?: Promise<SearchParams>
}) {
  const params = (await props?.searchParams) ?? {}
  const requested = typeof params.status === "string" ? params.status : undefined
  const status = statusTabFromParam(requested)

  const result = await listVendorProductsAction(status === "all" ? {} : { status })

  return (
    <>
      <PageHeader title="Products" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Everything you sell, from the first draft to the products in the marketplace.
        </p>
        <Link
          href="/products/new"
          className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          New product
        </Link>
      </div>

      <ProductList
        key={status}
        status={status}
        initialItems={result.ok ? result.items : []}
        initialCursor={result.ok ? result.nextCursor : null}
        initialError={result.ok ? null : result.error}
      />
    </>
  )
}
