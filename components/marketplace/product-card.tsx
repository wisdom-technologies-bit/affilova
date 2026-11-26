import Link from "next/link"

import { formatNaira } from "@/lib/catalog/money"
import type { MarketplaceItem } from "@/lib/marketplace/types"

// One product on a grid.
//
// What is on the card is what the database holds: an image, a title, the vendor,
// the price and the short description. There is no rating, no "3 people bought
// this today" and no countdown, because none of that is known and inventing it
// would be a lie.
//
// The image is a Cloudinary URL built by the caller for three widths, so a phone
// downloads a 320 pixel file and a wide screen gets 640. The width and height are
// explicit so the card does not jump while the image loads.

export const CARD_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

export interface CardImage {
  src: string
  srcSet: string
  sizes: string
}

export interface ProductCardProps {
  item: MarketplaceItem
  image: CardImage | null
  /** The first row is loaded eagerly; everything below it waits. */
  priority?: boolean
}

/** "was ₦3,000" is read out as words, not as a struck-through number. */
function CompareAtPrice({ kobo }: { kobo: number }) {
  return (
    <>
      <span aria-hidden="true" className="ml-2 text-sm text-muted-foreground line-through">
        {formatNaira(kobo)}
      </span>
      <span className="sr-only"> (was {formatNaira(kobo)})</span>
    </>
  )
}

export function ProductCard({ item, image, priority = false }: ProductCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="bg-muted">
        {image === null ? (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-sm text-muted-foreground">
            No image
          </div>
        ) : (
          <img
            src={image.src}
            srcSet={image.srcSet}
            sizes={image.sizes}
            alt=""
            width={640}
            height={480}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="aspect-[4/3] w-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base font-semibold leading-snug text-foreground">
          <Link href={`/p/${item.slug}`} className={`${CARD_FOCUS} hover:underline`}>
            {item.title}
          </Link>
        </h3>

        <p className="text-sm text-muted-foreground">
          <Link href={`/store/${item.vendorSlug}`} className={`${CARD_FOCUS} hover:underline`}>
            {item.vendorName}
          </Link>
        </p>

        {item.shortDescription === "" ? null : (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.shortDescription}</p>
        )}

        <p className="mt-auto pt-2 text-base font-semibold text-foreground">
          {formatNaira(item.priceKobo)}
          {item.compareAtPriceKobo === null ? null : <CompareAtPrice kobo={item.compareAtPriceKobo} />}
        </p>
      </div>
    </article>
  )
}
