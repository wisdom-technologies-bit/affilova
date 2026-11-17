import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-header"
import { CatalogSection } from "@/components/catalog/catalog-section"
import { ProductStatusPanel } from "@/components/catalog/product-status-panel"
import { ReviewActions } from "@/components/catalog/review-actions"
import { ReviewFileList } from "@/components/catalog/review-file-list"
import { StatusBadge } from "@/components/catalog/status-badge"
import { getProductForReviewAction } from "@/lib/catalog/actions/admin"
import { formatLagosDate, formatLagosDateTime, formatPercent, refundWindowLabel } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { getCloudinaryEnv } from "@/lib/env"

// One product, as a reviewer sees it: everything the vendor supplied, read-only,
// and the decision.
//
// Nothing here can be edited. A reviewer who wants a change asks for it; a
// reviewer who wants something different does not quietly rewrite it.

function readCloudName(): string | null {
  try {
    return getCloudinaryEnv().CLOUDINARY_CLOUD_NAME
  } catch {
    return null
  }
}

function thumbnailUrl(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_400,h_300,f_auto,q_auto/${publicId}`
}

export default async function AdminProductReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getProductForReviewAction({ productId: id })

  if (!result.ok) {
    notFound()
  }

  const { product, businessName, files, images, readiness } = result
  const cloudName = readCloudName()

  const rows: { label: string; value: string }[] = [
    { label: "Vendor", value: businessName === "" ? "Not recorded" : businessName },
    { label: "Store address", value: product.slug },
    { label: "Price", value: formatNaira(product.priceKobo) },
    {
      label: "Compare-at price",
      value: product.compareAtPriceKobo === null ? "Not set" : formatNaira(product.compareAtPriceKobo),
    },
    { label: "Affiliate commission", value: `${formatPercent(product.commissionBps)}%` },
    { label: "Refund window", value: refundWindowLabel(product.refundWindowHours) },
    { label: "Maximum downloads", value: String(product.maxDownloads) },
    { label: "Submitted", value: formatLagosDateTime(product.submittedAt) },
    { label: "Created", value: formatLagosDate(product.createdAt) },
  ]

  return (
    <>
      <PageHeader title={product.title} />

      <p className="mb-6 text-sm text-muted-foreground">
        <Link
          href="/products"
          className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Back to the review queue
        </Link>
      </p>

      <div className="space-y-10">
        <CatalogSection id="status" title="Status">
          <div className="space-y-4">
            <StatusBadge status={product.status} />
            <ProductStatusPanel product={product} readiness={readiness} />
          </div>
        </CatalogSection>

        <CatalogSection id="details" title="Details">
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-medium text-brand-ink">Short description</h3>
              <p className="mt-1 text-sm text-brand-ink">{product.shortDescription}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-brand-ink">Description</h3>
              {product.description === "" ? (
                <p className="mt-1 text-sm text-muted-foreground">This product has no description.</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-brand-ink">{product.description}</p>
              )}
            </div>
          </div>
        </CatalogSection>

        <CatalogSection id="pricing" title="Pricing and commission">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5 text-sm text-brand-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CatalogSection>

        <CatalogSection id="images" title="Images" description="Up to six. The cover is marked.">
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">This product has no images.</p>
          ) : cloudName === null ? (
            <p className="text-sm text-muted-foreground">
              Images cannot be shown because image hosting is not configured on this deployment.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {images.map((image) => (
                <li key={image.id} className="rounded-md border border-border p-3">
                  <img
                    src={thumbnailUrl(cloudName, image.publicId)}
                    alt={image.alt ?? "Product image without a description"}
                    width={400}
                    height={300}
                    className="h-[150px] w-full rounded-md border border-border object-cover"
                  />
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <p className="text-sm text-brand-ink">{image.alt ?? "No description"}</p>
                    {image.isCover ? (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-brand-600 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
                        Cover
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CatalogSection>

        <CatalogSection id="files" title="Files" description="Download a file to inspect it.">
          <ReviewFileList files={files} />
        </CatalogSection>

        <CatalogSection id="decision" title="Decision">
          <ReviewActions productId={product.id} status={product.status} />
        </CatalogSection>
      </div>
    </>
  )
}
