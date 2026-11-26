import type { PublicProduct } from "@/lib/catalog/public"

// The Product structured data for /p/<slug>.
//
// Only what the page itself knows is described: the title, the description, the
// images, the price and the vendor's business name. There is no rating, no
// review count and no sales figure, because the platform does not have them and
// inventing them would be a lie told to a search engine.
//
// The price is derived from kobo with integer maths, never by dividing a float:
// 150050 kobo is "1500.50" and not "1500.4999999999998".

/** Kobo as the decimal string schema.org expects: "1500.50", "1500.00". */
export function koboToDecimalString(kobo: number): string {
  if (!Number.isInteger(kobo) || kobo < 0) {
    throw new TypeError("koboToDecimalString expects a non-negative integer number of kobo")
  }

  const naira = Math.floor(kobo / 100)
  const remainder = kobo % 100

  return `${naira}.${String(remainder).padStart(2, "0")}`
}

export interface ProductJsonLdInput {
  product: PublicProduct
  /** Absolute image URLs, cover first. */
  images: string[]
  /** The absolute URL of the product page. */
  url: string
  /** The absolute URL of the vendor's storefront, when its handle is known. */
  sellerUrl?: string
}

/**
 * The Product object.
 *
 * availability is InStock because the page only exists for a live product: a
 * paused or draft product is a 404, so anything rendered here is on sale.
 */
export function productJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const { product } = input

  const description = product.shortDescription === "" ? product.description : product.shortDescription

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description,
    ...(input.images.length === 0 ? {} : { image: input.images }),
    category: product.categoryName === "" ? undefined : product.categoryName,
    offers: {
      "@type": "Offer",
      url: input.url,
      price: koboToDecimalString(product.priceKobo),
      priceCurrency: "NGN",
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: product.vendorBusinessName,
        ...(input.sellerUrl === undefined ? {} : { url: input.sellerUrl }),
      },
    },
  }
}

/**
 * The JSON as a string that is safe inside a <script> element.
 *
 * A product title may contain "</script>" or an HTML entity, and either would end
 * the script block early. The three characters that can do that, and the two
 * line separators that break older parsers, are written as escapes: the JSON is
 * unchanged when parsed, and the HTML cannot be broken from inside it.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
