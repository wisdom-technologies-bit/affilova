import { ProductGrid, type GridItem } from "@/components/marketplace/product-grid"

// "Related products" under a product page.
//
// The row is whatever the database found in the same category: it is never
// padded, never repeated and never filled with something the vendor did not
// list. When there is nothing related the section is not rendered at all, rather
// than shown empty.

export interface RelatedProductsProps {
  items: GridItem[]
}

export function RelatedProducts({ items }: RelatedProductsProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <section aria-labelledby="related-heading" className="mt-16 border-t border-border pt-8">
      <h2 id="related-heading" className="text-xl font-semibold tracking-tight text-foreground">
        Related products
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">More from the same category.</p>
      <div className="mt-6">
        <ProductGrid items={items} />
      </div>
    </section>
  )
}
