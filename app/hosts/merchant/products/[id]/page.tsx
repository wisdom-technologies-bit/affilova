import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-header"
import { CatalogSection } from "@/components/catalog/catalog-section"
import { FileManager } from "@/components/catalog/file-manager"
import { ImageManager } from "@/components/catalog/image-manager"
import { ProductDetailsForm } from "@/components/catalog/product-details-form"
import { ProductPricingForm } from "@/components/catalog/product-pricing-form"
import { ProductStatusPanel } from "@/components/catalog/product-status-panel"
import { SectionNav } from "@/components/catalog/section-nav"
import { TransitionActions } from "@/components/catalog/transition-actions"
import { getProductForEditAction } from "@/lib/catalog/actions/vendor"
import { listProductCategories } from "@/lib/catalog/categories"
import { getCloudinaryEnv } from "@/lib/env"

// One product, everything about it, on one page.
//
// A miss and a product that belongs to another vendor are the same answer: the
// standard 404. Saying which would tell a stranger that a product exists.

/** The Cloudinary cloud name, or null when this deployment has not set it up. */
function readCloudName(): string | null {
  try {
    return getCloudinaryEnv().CLOUDINARY_CLOUD_NAME
  } catch {
    return null
  }
}

export default async function MerchantProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getProductForEditAction({ productId: id })

  if (!result.ok) {
    notFound()
  }

  const { product, files, images, readiness } = result
  const categories = await listProductCategories()
  const cloudName = readCloudName()

  // The database refuses a change to an archived product, so the screen does
  // too rather than offering a form that can only fail.
  const archivedReason =
    product.status === "archived"
      ? "This product is archived. Its details, files and images cannot be changed."
      : undefined

  return (
    <>
      <PageHeader title={product.title} />

      <p className="mb-6 text-sm text-muted-foreground">
        <Link
          href="/products"
          className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Back to products
        </Link>
      </p>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <SectionNav />

        <div className="min-w-0 space-y-10">
          <CatalogSection id="status" title="Status">
            <ProductStatusPanel product={product} readiness={readiness} />
          </CatalogSection>

          <CatalogSection
            id="details"
            title="Details"
            description="The title, the address and the words customers read."
          >
            {archivedReason === undefined ? null : (
              <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
                {archivedReason}
              </p>
            )}

            {categories.ok ? null : (
              <p
                role="alert"
                className="mb-4 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
              >
                The categories could not be loaded. The category cannot be changed until they load.
              </p>
            )}

            <ProductDetailsForm product={product} categories={categories.ok ? categories.categories : []} />
          </CatalogSection>

          <CatalogSection
            id="pricing"
            title="Pricing and affiliates"
            description="What the product costs, what affiliates earn, and what a buyer is promised."
          >
            <ProductPricingForm product={product} />
          </CatalogSection>

          <CatalogSection
            id="files"
            title="Files"
            description="What a buyer downloads. Files are private: only a paid download gets a link."
          >
            <FileManager productId={product.id} files={files} readOnlyReason={archivedReason} />
          </CatalogSection>

          <CatalogSection
            id="images"
            title="Images"
            description="Up to six images. The cover is the one shown in the marketplace."
          >
            <ImageManager
              productId={product.id}
              cloudName={cloudName}
              images={images}
              readOnlyReason={archivedReason}
            />
          </CatalogSection>

          <CatalogSection
            id="actions"
            title="Actions"
            description="What can happen to this product from where it is now."
          >
            <TransitionActions
              productId={product.id}
              status={product.status}
              missing={readiness.missing}
            />
          </CatalogSection>
        </div>
      </div>
    </>
  )
}
