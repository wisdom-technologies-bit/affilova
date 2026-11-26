import { describe, expect, it } from "vitest"

import type { PublicProduct } from "@/lib/catalog/public"

import { koboToDecimalString, productJsonLd, serializeJsonLd } from "./jsonld"

const PRODUCT: PublicProduct = {
  id: "a1000000-0000-4000-8000-000000000001",
  slug: "keto-diet-guide",
  title: "Keto Diet Guide",
  shortDescription: "A practical guide to a ketogenic diet.",
  description: "Long description",
  priceKobo: 150_050,
  categoryName: "Education",
  vendorBusinessName: "Ada Digital",
  images: [
    {
      publicId: "affilova/keto/cover",
      url: "https://res.cloudinary.com/demo/image/upload/c_fill,f_auto,q_auto,w_1200/affilova/keto/cover",
      alt: "Cover",
      width: 1200,
      height: 1200,
      isCover: true,
    },
  ],
  fileCount: 1,
  fileTypes: ["PDF"],
  refundWindowHours: 24,
  publishedAt: "2026-11-20T09:00:00Z",
}

describe("koboToDecimalString", () => {
  it("writes kobo as an exact naira decimal", () => {
    expect(koboToDecimalString(150_050)).toBe("1500.50")
    expect(koboToDecimalString(150_000)).toBe("1500.00")
    expect(koboToDecimalString(1)).toBe("0.01")
    expect(koboToDecimalString(5)).toBe("0.05")
    expect(koboToDecimalString(0)).toBe("0.00")
    expect(koboToDecimalString(99)).toBe("0.99")
    expect(koboToDecimalString(1_000_000_000)).toBe("10000000.00")
  })

  it("never produces a float artefact", () => {
    for (const kobo of [1, 7, 33, 149_999, 150_050, 999_999]) {
      expect(koboToDecimalString(kobo)).not.toContain("e")
      expect(koboToDecimalString(kobo)).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it("refuses a value that is not a whole number of kobo", () => {
    expect(() => koboToDecimalString(1.5)).toThrow(TypeError)
    expect(() => koboToDecimalString(-1)).toThrow(TypeError)
  })
})

describe("productJsonLd", () => {
  const jsonLd = productJsonLd({
    product: PRODUCT,
    images: PRODUCT.images.map((image) => image.url),
    url: "https://affilova.com/p/keto-diet-guide",
    sellerUrl: "https://affilova.com/store/ada-digital",
  })

  it("describes a Product", () => {
    expect(jsonLd["@context"]).toBe("https://schema.org")
    expect(jsonLd["@type"]).toBe("Product")
    expect(jsonLd.name).toBe("Keto Diet Guide")
    expect(jsonLd.description).toBe("A practical guide to a ketogenic diet.")
  })

  it("carries the price as a decimal string in naira", () => {
    const offers = jsonLd.offers as Record<string, unknown>

    expect(offers["@type"]).toBe("Offer")
    expect(offers.price).toBe("1500.50")
    expect(offers.priceCurrency).toBe("NGN")
    expect(offers.availability).toBe("https://schema.org/InStock")
  })

  it("names the vendor as an Organization", () => {
    const offers = jsonLd.offers as Record<string, unknown>
    const seller = offers.seller as Record<string, unknown>

    expect(seller["@type"]).toBe("Organization")
    expect(seller.name).toBe("Ada Digital")
    expect(seller.url).toBe("https://affilova.com/store/ada-digital")
  })

  it("leaves the seller URL out when the handle is unknown", () => {
    const withoutStore = productJsonLd({
      product: PRODUCT,
      images: [],
      url: "https://affilova.com/p/keto-diet-guide",
    })

    const seller = (withoutStore.offers as Record<string, unknown>).seller as Record<string, unknown>

    expect(seller.url).toBeUndefined()
    expect(seller.name).toBe("Ada Digital")
  })

  it("carries no rating, review or sales figure", () => {
    const text = JSON.stringify(jsonLd)

    expect(text).not.toContain("aggregateRating")
    expect(text).not.toContain("review")
    expect(text).not.toContain("ratingValue")
  })

  it("uses the images it was given", () => {
    expect(jsonLd.image).toEqual([PRODUCT.images[0]?.url])
  })

  it("leaves the image out when there is none", () => {
    const withoutImage = productJsonLd({ product: PRODUCT, images: [], url: "https://affilova.com/p/x" })

    expect(withoutImage.image).toBeUndefined()
  })
})

describe("serializeJsonLd", () => {
  it("escapes the characters that could end the script block", () => {
    const serialized = serializeJsonLd({ name: "</script><script>alert(1)</script>" })

    expect(serialized).not.toContain("</script>")
    expect(serialized).not.toContain("<")
    expect(serialized).toContain("\\u003c")
  })

  it("escapes an ampersand so an entity cannot be formed", () => {
    const serialized = serializeJsonLd({ name: "Fish &amp; chips" })

    expect(serialized).not.toContain("&")
    expect(serialized).toContain("\\u0026")
  })

  it("escapes the two line separators", () => {
    const serialized = serializeJsonLd({ name: "a\u2028b\u2029c" })

    expect(serialized).toContain("\\u2028")
    expect(serialized).toContain("\\u2029")
  })

  it("still parses back to the same value", () => {
    const value = {
      name: "</script> & <b>bold</b>",
      price: "1500.50",
      nested: { list: [1, 2, 3] },
    }

    expect(JSON.parse(serializeJsonLd(value))).toEqual(value)
  })

  it("keeps a real product's price exact through the round trip", () => {
    const serialized = serializeJsonLd(productJsonLd({ product: PRODUCT, images: [], url: "https://affilova.com/p/x" }))
    const parsed = JSON.parse(serialized) as { offers: { price: string } }

    expect(parsed.offers.price).toBe("1500.50")
  })
})
