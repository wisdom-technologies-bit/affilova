import { describe, expect, it } from "vitest"

import { affiliateSchema, PROMOTION_CHANNELS, vendorSchema } from "./onboarding-schemas"

// Boundary tests. The slug pattern is ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$ (3 to
// 40 characters) and the username pattern is ^[a-z0-9_]{3,30}$ (3 to 30).

function handleOf(length: number): string {
  return `a${"b".repeat(length - 2)}c`
}

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    businessName: "Shop One",
    slug: "shop-one",
    supportEmail: "shop@example.com",
    acceptTerms: true,
    ...overrides,
  }
}

function affiliate(overrides: Record<string, unknown> = {}) {
  return {
    username: "promoter_one",
    promotionChannels: ["whatsapp"],
    acceptTerms: true,
    ...overrides,
  }
}

describe("vendorSchema", () => {
  it("accepts a valid submission and applies the country default", () => {
    const result = vendorSchema.safeParse(vendor())

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.slug).toBe("shop-one")
      expect(result.data.country).toBe("NG")
      expect(result.data.phone).toBeUndefined()
    }
  })

  it("trims and lowercases the handle and the email", () => {
    const result = vendorSchema.safeParse(
      vendor({ slug: "  Shop-One  ", supportEmail: "  Sales@Example.com  " }),
    )

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.slug).toBe("shop-one")
      expect(result.data.supportEmail).toBe("sales@example.com")
    }
  })

  it("accepts a 3 character slug", () => {
    expect(vendorSchema.safeParse(vendor({ slug: handleOf(3) })).success).toBe(true)
  })

  it("rejects a 2 character slug", () => {
    expect(vendorSchema.safeParse(vendor({ slug: handleOf(2) })).success).toBe(false)
  })

  it("accepts a 40 character slug", () => {
    expect(vendorSchema.safeParse(vendor({ slug: handleOf(40) })).success).toBe(true)
  })

  it("rejects a 41 character slug", () => {
    expect(vendorSchema.safeParse(vendor({ slug: handleOf(41) })).success).toBe(false)
  })

  it("rejects a leading hyphen", () => {
    expect(vendorSchema.safeParse(vendor({ slug: "-shop" })).success).toBe(false)
  })

  it("rejects a trailing hyphen", () => {
    expect(vendorSchema.safeParse(vendor({ slug: "shop-" })).success).toBe(false)
  })

  it("stores an uppercase slug in lowercase", () => {
    const result = vendorSchema.safeParse(vendor({ slug: "MyShop" }))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.slug).toBe("myshop")
    }
  })

  it("rejects a slug with an underscore or a space", () => {
    expect(vendorSchema.safeParse(vendor({ slug: "shop_one" })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ slug: "shop one" })).success).toBe(false)
  })

  it("rejects every reserved word", () => {
    for (const reserved of ["admin", "support", "shop", "status", "undefined"]) {
      const result = vendorSchema.safeParse(vendor({ slug: reserved }))

      expect(result.success, reserved).toBe(false)
    }
  })

  it("rejects a reserved word whatever its case", () => {
    expect(vendorSchema.safeParse(vendor({ slug: "ADMIN" })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ slug: " Admin " })).success).toBe(false)
  })

  it("enforces the business name length", () => {
    expect(vendorSchema.safeParse(vendor({ businessName: "X" })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ businessName: "XY" })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ businessName: "x".repeat(100) })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ businessName: "x".repeat(101) })).success).toBe(false)
  })

  it("requires a real email address", () => {
    expect(vendorSchema.safeParse(vendor({ supportEmail: "not-an-email" })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ supportEmail: "" })).success).toBe(false)
  })

  it("accepts an empty or a well formed phone number, and nothing over 20 characters", () => {
    expect(vendorSchema.safeParse(vendor({ phone: "" })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ phone: "+234 (801) 234-5678" })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ phone: "1".repeat(20) })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ phone: "1".repeat(21) })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ phone: "0801 CALL NOW" })).success).toBe(false)
  })

  it("accepts a two letter country code only", () => {
    expect(vendorSchema.safeParse(vendor({ country: "ng" })).success).toBe(true)
    expect(vendorSchema.safeParse(vendor({ country: "NGA" })).success).toBe(false)
    expect(vendorSchema.safeParse(vendor({ country: "N1" })).success).toBe(false)
  })

  it("refuses acceptTerms that is not true", () => {
    const result = vendorSchema.safeParse(vendor({ acceptTerms: false }))

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["acceptTerms"])
    }
  })

  it("refuses a missing acceptTerms", () => {
    expect(vendorSchema.safeParse(vendor({ acceptTerms: undefined })).success).toBe(false)
  })

  it("reports the field name with the message", () => {
    const result = vendorSchema.safeParse(vendor({ slug: "-shop" }))

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["slug"])
      expect(result.error.issues[0]?.message).toContain("3 to 40")
    }
  })
})

describe("affiliateSchema", () => {
  it("accepts a valid submission and applies the country default", () => {
    const result = affiliateSchema.safeParse(affiliate())

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.username).toBe("promoter_one")
      expect(result.data.promotionChannels).toEqual(["whatsapp"])
      expect(result.data.country).toBe("NG")
    }
  })

  it("accepts a 3 character username", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: handleOf(3) })).success).toBe(true)
  })

  it("rejects a 2 character username", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: handleOf(2) })).success).toBe(false)
  })

  it("accepts a 30 character username", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: handleOf(30) })).success).toBe(true)
  })

  it("rejects a 31 character username", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: handleOf(31) })).success).toBe(false)
  })

  it("rejects a hyphen and a space", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: "user-name" })).success).toBe(false)
    expect(affiliateSchema.safeParse(affiliate({ username: "user name" })).success).toBe(false)
  })

  it("allows an underscore anywhere, as the pattern does", () => {
    expect(affiliateSchema.safeParse(affiliate({ username: "_username" })).success).toBe(true)
  })

  it("lowercases the username", () => {
    const result = affiliateSchema.safeParse(affiliate({ username: " Promoter_One " }))

    expect(result.success).toBe(true)

    if (result.success) {
      expect(result.data.username).toBe("promoter_one")
    }
  })

  it("rejects every reserved word", () => {
    for (const reserved of ["login", "affilova", "terms", "null"]) {
      expect(affiliateSchema.safeParse(affiliate({ username: reserved })).success, reserved).toBe(
        false,
      )
    }
  })

  it("accepts every known channel and an empty list", () => {
    expect(
      affiliateSchema.safeParse(affiliate({ promotionChannels: [...PROMOTION_CHANNELS] })).success,
    ).toBe(true)
    expect(affiliateSchema.safeParse(affiliate({ promotionChannels: [] })).success).toBe(true)
  })

  it("rejects an unknown channel", () => {
    expect(affiliateSchema.safeParse(affiliate({ promotionChannels: ["myspace"] })).success).toBe(
      false,
    )
  })

  it("rejects a duplicate channel", () => {
    const result = affiliateSchema.safeParse(
      affiliate({ promotionChannels: ["whatsapp", "whatsapp"] }),
    )

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("once")
    }
  })

  it("rejects more than ten channels", () => {
    const eleven = [...PROMOTION_CHANNELS, "other" as const]

    expect(affiliateSchema.safeParse(affiliate({ promotionChannels: eleven })).success).toBe(false)
  })

  it("refuses acceptTerms that is not true", () => {
    const result = affiliateSchema.safeParse(affiliate({ acceptTerms: false }))

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["acceptTerms"])
    }
  })
})
