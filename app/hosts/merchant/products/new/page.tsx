import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { NewProductForm } from "@/components/catalog/new-product-form"
import { listProductCategories } from "@/lib/catalog/categories"

// The first screen of a product: enough to create a draft, and nothing more.
// The details, the files and the images are filled in on the edit page, in
// whatever order suits the vendor.

export default async function NewProductPage() {
  const categories = await listProductCategories()

  return (
    <>
      <PageHeader title="New product" />

      <p className="mb-6 text-sm text-muted-foreground">
        <Link
          href="/products"
          className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Back to products
        </Link>
      </p>

      {categories.ok ? null : (
        <p role="alert" className="mb-6 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          The categories could not be loaded, so a product cannot be created right now. Reload the page to try again.
        </p>
      )}

      {categories.ok && categories.categories.length === 0 ? (
        <p className="mb-6 rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
          No categories are available, so a product cannot be created yet.
        </p>
      ) : null}

      <NewProductForm categories={categories.ok ? categories.categories : []} />
    </>
  )
}
