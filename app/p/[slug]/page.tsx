import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ProductView } from "@/components/commerce/product-view"
import { cloudinaryImageUrl, getPublicProduct, SOCIAL_WIDTH } from "@/lib/catalog/public"
import { isPaystackTestMode } from "@/lib/commerce/test-mode"
import { appUrl } from "@/lib/identity/app-urls"
import { getAuthUser } from "@/lib/identity/session"

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

  return <ProductView product={product} testMode={isPaystackTestMode()} signedInEmail={signedInEmail} />
}
