import Link from "next/link"

import { formatNaira } from "@/lib/catalog/money"
import { refundSentence, type PublicProduct } from "@/lib/catalog/public"
import { TEST_MODE_BANNER } from "@/lib/commerce/test-mode"

import { PurchaseCard } from "./purchase-card"

// The public product page, without the database.
//
// It takes a product that has already been checked (live, active vendor) and
// renders it: gallery and description on the left, the buy box on the right on a
// wide screen, and the buy box directly under the title on a phone. There are no
// ratings, no "only 3 left", no invented numbers: what the page knows is what the
// vendor recorded.

export interface ProductViewProps {
  product: PublicProduct
  testMode: boolean
  signedInEmail?: string | null
}

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

export function ProductView({ product, testMode, signedInEmail = null }: ProductViewProps) {
  const cover = product.images[0]

  // One string, so a screen reader reads "3 files (PDF, ZIP)" as a sentence
  // rather than three fragments.
  const filesSummary =
    product.fileCount === 0
      ? "No files are attached yet"
      : `${product.fileCount} ${product.fileCount === 1 ? "file" : "files"}${
          product.fileTypes.length === 0 ? "" : ` (${product.fileTypes.join(", ")})`
        }`

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {testMode ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          {TEST_MODE_BANNER}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto_1fr] lg:gap-12">
        <header className="order-1 lg:col-start-1 lg:row-start-1">
          <p className="text-sm text-muted-foreground">
            {product.categoryName === "" ? "Digital product" : product.categoryName}
          </p>
          <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {product.title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Sold by <span className="font-medium text-foreground">{product.vendorBusinessName}</span>
          </p>
          <p className="mt-4 text-base text-foreground">{product.shortDescription}</p>
        </header>

        <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-6 lg:self-start">
          <PurchaseCard
            productId={product.id}
            priceLabel={formatNaira(product.priceKobo)}
            initialEmail={signedInEmail ?? ""}
            emailReadOnly={signedInEmail !== null && signedInEmail !== ""}
          />
        </div>

        <div className="order-3 lg:col-start-1 lg:row-start-2">
          {cover === undefined ? null : (
            <figure>
              <img
                src={cover.url}
                alt={cover.alt === "" ? product.title : cover.alt}
                width={cover.width ?? 1200}
                height={cover.height ?? 900}
                className="w-full rounded-lg border border-border bg-muted object-contain"
              />
            </figure>
          )}

          {product.images.length > 1 ? (
            <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {product.images.slice(1).map((image, index) => (
                <li key={image.url}>
                  <img
                    src={image.url}
                    alt={image.alt === "" ? `${product.title}, image ${index + 2}` : image.alt}
                    width={image.width ?? 400}
                    height={image.height ?? 300}
                    loading="lazy"
                    className="w-full rounded-md border border-border bg-muted object-contain"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="order-4 lg:col-start-1 lg:row-start-3">
          <section aria-labelledby="description-heading">
            <h2 id="description-heading" className="text-lg font-semibold text-foreground">
              About this product
            </h2>
            <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-foreground">
              {product.description}
            </p>
          </section>

          <section aria-labelledby="delivery-heading" className="mt-8">
            <h2 id="delivery-heading" className="text-lg font-semibold text-foreground">
              What you receive
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">Files:</dt>
                <dd className="text-muted-foreground">{filesSummary}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">Delivery:</dt>
                <dd className="text-muted-foreground">
                  A download link is emailed to you as soon as the payment is confirmed.
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">Refunds:</dt>
                <dd className="text-muted-foreground">{refundSentence(product.refundWindowHours)}.</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          <Link href="/terms-of-service" className={`underline underline-offset-2 ${FOCUS}`}>
            Terms of service
          </Link>
          {" · "}
          <Link href="/privacy-policy" className={`underline underline-offset-2 ${FOCUS}`}>
            Privacy policy
          </Link>
          {" · "}
          <Link href="/contact" className={`underline underline-offset-2 ${FOCUS}`}>
            Contact us
          </Link>
        </p>
      </footer>
    </main>
  )
}
