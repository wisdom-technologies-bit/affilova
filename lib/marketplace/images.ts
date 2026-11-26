import "server-only"

import type { CardImage } from "@/components/marketplace/product-card"
import { cloudinaryImageUrl } from "@/lib/catalog/public"
import { getCloudinaryEnv } from "@/lib/env"

// Card images, built once per request.
//
// The same Cloudinary helper the product page uses does the work, so the crop,
// the format and the quality are identical across the site. Three widths are
// offered and the browser picks one: a phone downloads 320 pixels, a wide screen
// 640.

/** The widths a card offers. The largest is also its declared width. */
export const CARD_WIDTHS = [320, 480, 640] as const

/** How wide the card is at each breakpoint, so the browser picks the right file. */
export const CARD_SIZES = "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"

/**
 * The cloud name, or "" when no image account is configured.
 *
 * A deployment without Cloudinary still renders: the cards show their neutral
 * placeholder instead of a broken image.
 */
export function cloudNameOrNull(): string {
  try {
    return getCloudinaryEnv().CLOUDINARY_CLOUD_NAME
  } catch {
    return ""
  }
}

/** The three URLs for one public id, or null when there is nothing to show. */
export function cardImage(publicId: string | null, cloudName: string): CardImage | null {
  if (publicId === null || publicId === "" || cloudName === "") {
    return null
  }

  const urls = CARD_WIDTHS.map((width) => cloudinaryImageUrl(publicId, cloudName, width))

  if (urls.some((url) => url === null)) {
    return null
  }

  const [small, medium, large] = urls as [string, string, string]

  return {
    src: large,
    srcSet: `${small} 320w, ${medium} 480w, ${large} 640w`,
    sizes: CARD_SIZES,
  }
}
