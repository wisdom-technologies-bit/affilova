import { describe, expect, it } from "vitest"

import {
  cloudinaryImageUrl,
  fileTypeLabel,
  getPublicProduct,
  refundSentence,
  toPublicProduct,
} from "./public"

const CLOUD = "affilova-images"

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "6f1a6a3e-0f5b-4d7e-9c2a-5b8f1e6d4a30",
    slug: "instagram-growth-playbook",
    title: "Instagram Growth Playbook",
    short_description: "A practical guide to growing an account without buying followers.",
    description: "Line one\n\nLine two",
    price_kobo: 2_500_000,
    refund_window_hours: 72,
    published_at: "2026-11-01T09:00:00.000Z",
    status: "live",
    product_categories: { name: "Business" },
    vendor_profiles: { business_name: "Okafor Digital", status: "active" },
    product_images: [
      { cloudinary_public_id: "affilova/products/cover", alt_text: "Cover", width: 1200, height: 900, sort: 0, is_cover: true },
      { cloudinary_public_id: "affilova/products/second", alt_text: null, width: 800, height: 600, sort: 1, is_cover: false },
    ],
    product_files: [
      { content_type: "application/pdf", status: "uploaded", scan_status: "clean" },
      { content_type: "application/zip", status: "uploaded", scan_status: "clean" },
      { content_type: "application/pdf", status: "pending", scan_status: "not_scanned" },
    ],
    ...overrides,
  }
}

describe("the public product helper", () => {
  it("returns a live product from an active vendor", () => {
    const product = toPublicProduct(row(), CLOUD)

    expect(product).not.toBeNull()
    expect(product?.title).toBe("Instagram Growth Playbook")
    expect(product?.vendorBusinessName).toBe("Okafor Digital")
    expect(product?.categoryName).toBe("Business")
    expect(product?.priceKobo).toBe(2_500_000)
    expect(product?.refundWindowHours).toBe(72)
    expect(product?.fileCount).toBe(2)
    expect(product?.fileTypes).toEqual(["PDF", "ZIP"])
  })

  it("counts only files that are uploaded and clean, and never their names", () => {
    const product = toPublicProduct(row(), CLOUD)

    expect(product?.fileCount).toBe(2)
    expect(JSON.stringify(product)).not.toContain("original_name")
    expect(JSON.stringify(product)).not.toContain(".pdf")
  })

  it("builds fill-cropped automatic images, cover first", () => {
    const product = toPublicProduct(row(), CLOUD)

    expect(product?.images[0]?.url).toBe(
      "https://res.cloudinary.com/affilova-images/image/upload/c_fill,f_auto,q_auto,w_1200/affilova/products/cover",
    )
    expect(product?.images[0]?.isCover).toBe(true)
    expect(product?.images).toHaveLength(2)
  })

  it("hides a product that is not live", () => {
    for (const status of ["draft", "submitted", "paused", "rejected", "archived"]) {
      expect(toPublicProduct(row({ status }), CLOUD)).toBeNull()
    }
  })

  it("hides a live product from a vendor whose profile is not active", () => {
    expect(
      toPublicProduct(row({ vendor_profiles: { business_name: "X", status: "suspended" } }), CLOUD),
    ).toBeNull()
    expect(toPublicProduct(row({ vendor_profiles: null }), CLOUD)).toBeNull()
  })

  it("hides a row that cannot be priced or addressed", () => {
    expect(toPublicProduct(row({ price_kobo: 0 }), CLOUD)).toBeNull()
    expect(toPublicProduct(row({ slug: "Not A Slug" }), CLOUD)).toBeNull()
    expect(toPublicProduct(row({ title: "" }), CLOUD)).toBeNull()
    expect(toPublicProduct(null, CLOUD)).toBeNull()
  })

  it("answers null for an unknown slug without asking the database", async () => {
    let asked = 0
    const product = await getPublicProduct("no", {
      loadRow: async () => {
        asked += 1

        return row()
      },
      cloudName: CLOUD,
    })

    expect(product).toBeNull()
    expect(asked).toBe(0)
  })

  it("answers null when the row is missing, and the product when it is there", async () => {
    const missing = await getPublicProduct("instagram-growth-playbook", {
      loadRow: async () => null,
      cloudName: CLOUD,
    })

    expect(missing).toBeNull()

    const found = await getPublicProduct("instagram-growth-playbook", {
      loadRow: async () => row(),
      cloudName: CLOUD,
    })

    expect(found?.slug).toBe("instagram-growth-playbook")
  })

  it("answers null when the read throws", async () => {
    const product = await getPublicProduct("instagram-growth-playbook", {
      loadRow: async () => {
        throw new Error("database down")
      },
      cloudName: CLOUD,
    })

    expect(product).toBeNull()
  })

  it("refuses a public id that could carry its own transformation", () => {
    expect(cloudinaryImageUrl("a/b?x=1", CLOUD, 800)).toBeNull()
    expect(cloudinaryImageUrl("", CLOUD, 800)).toBeNull()
    expect(cloudinaryImageUrl("a/b", "", 800)).toBeNull()
  })

  it("labels file types without inventing one", () => {
    expect(fileTypeLabel("application/pdf")).toBe("PDF")
    expect(fileTypeLabel("application/pdf; charset=binary")).toBe("PDF")
    expect(fileTypeLabel("video/mp4")).toBe("MP4")
    expect(fileTypeLabel("application/x-something-new")).toBe("X-SOMETHING-NEW")
    expect(fileTypeLabel("")).toBe("FILE")
  })

  it("writes the refund sentence with hours or days", () => {
    expect(refundSentence(24)).toBe("Refund requests accepted within 24 hours of purchase")
    expect(refundSentence(72)).toBe("Refund requests accepted within 3 days of purchase")
    expect(refundSentence(48)).toBe("Refund requests accepted within 48 hours of purchase")
  })
})
