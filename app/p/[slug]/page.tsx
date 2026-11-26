import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ProductView } from "@/components/commerce/product-view"
import type { Crumb } from "@/components/commerce/product-breadcrumbs"
import { RelatedProducts } from "@/components/commerce/related-products"
import { cloudinaryImageUrl, getPublicProduct, SOCIAL_WIDTH } from "@/lib/catalog/public"
import { isPaystackTestMode } from "@/lib/commerce/test-mode"
import { appUrl } from "@/lib/identity/app-urls"
import { getAuthUser } from "@/lib/identity/session"
import { getCachedCategories } from "@/lib/marketplace/cached"
import { cardImage, cloudNameOrNull } from "@/lib/marketplace/images"
import { productJsonLd, serializeJsonLd } from "@/lib/marketplace/jsonld"
import { getProductStoreSlug, getRelatedProducts } from "@/lib/marketplace/queries"

// The public product page: /p/<slug> on the public host.
//
// A live product from an active vendor is the only thing served here. Anything
// else, including a slug that has never existed, is the standard 404: the page
// never tells a visitor whether a product exists but is paused.

/**
 * The cloud name already baked into a delivery URL, so the social image is built
 * from the same account without reading the environment a second time.
 */
function cloudNameFor(url: string): string {
  const match = /^https:\/\/res\.cloudinary\.com\/([^/]+)\//.exec(url)

  return match === null ? "" : match[1] ?? ""
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = await getPublicProduct(slug)

  if (product === null) {
    return {
      title: "Product not found",
      robots: { index: false, follow: false },
    }
  }

  const canonical = appUrl("public", `/p/${product.slug}`)
  const cover = product.images[0]
  const social =
    cover === undefined
      ? null
      : cloudinaryImageUrl(cover.publicId, cloudNameFor(cover.url), SOCIAL_WIDTH)

  const description =
    product.shortDescription === ""
      ? `${product.title} from ${product.vendorBusinessName}, sold on Affilova.`
      : product.shortDescription

  const image = social ?? cover?.url

  return {
    title: `${product.title} - ${product.vendorBusinessName} | Affilova`,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title: product.title,
      description,
      url: canonical,
      type: "website",
      ...(image === undefined ? {} : { images: [{ url: image }] }),
    },
  }
}

export default async function PublicProductPage({ params }: PageProps) {
  const { slug } = await params
  const product = await getPublicProduct(slug)

  if (product === null) {
    notFound()
  }

  let signedInEmail: string | null = null

  try {
    const user = await getAuthUser()

    signedInEmail = user === null ? null : user.email
  } catch {
    // A session that cannot be read is simply not signed in: the card then asks
    // for the address, which is the guest path.
    signedInEmail = null
  }

  // Three independent reads, so they happen together: the vendor's public
  // handle, the category index (for the breadcrumb's link) and the related row.
  const [storeSlug, categories, related] = await Promise.all([
    getProductStoreSlug(product.id),
    getCachedCategories(),
    getRelatedProducts(product.id),
  ])

  const categorySlug =
    categories === null
      ? null
      : categories.find((category) => category.name === product.categoryName)?.slug ?? null

  const crumbs: Crumb[] = [
    { label: "Marketplace", href: "/marketplace" },
    ...(categorySlug === null
      ? []
      : [{ label: product.categoryName, href: `/marketplace/${categorySlug}` }]),
    { label: product.title },
  ]

  const cloudName = cloudNameOrNull()
  const relatedItems =
    related === null
      ? []
      : related.map((item) => ({ item, image: cardImage(item.coverPublicId, cloudName) }))

  const jsonLd = productJsonLd({
    product,
    images: product.images.map((image) => image.url),
    url: appUrl("public", `/p/${product.slug}`),
    ...(storeSlug === null ? {} : { sellerUrl: appUrl("public", `/store/${storeSlug}`) }),
  })

  return (
    <>
      {/* The < character is escaped by serializeJsonLd, so a title containing
          markup cannot close this block early. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <ProductView
        product={product}
        testMode={isPaystackTestMode()}
        signedInEmail={signedInEmail}
        breadcrumbs={crumbs}
        vendorHref={storeSlug === null ? null : `/store/${storeSlug}`}
        related={<RelatedProducts items={relatedItems} />}
      />
    </>
  )
}
