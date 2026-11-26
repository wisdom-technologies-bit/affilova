import { describe, expect, it } from "vitest"

import { affiliateSchema, vendorSchema } from "@/lib/identity/onboarding-schemas"

import {
  affiliateChannelsError,
  affiliateUsernameError,
  vendorBusinessNameError,
  vendorPhoneError,
  vendorSlugError,
  vendorSupportEmailError,
} from "./onboarding-validation"

// The inline onboarding messages must say what the server says.
//
// The component file cannot import the schemas without putting zod in the browser
// bundle, so it repeats the messages. This test is what keeps the repetition
// honest: each value is put through both the schema and the client check, and the
// sentences have to match.

function schemaMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  if (result.success) {
    return undefined
  }

  return result.error?.issues[0]?.message
}

const VENDOR_VALUES = ["", "a", "Shop", "shop-", "-shop", "my shop", "shop!", "a".repeat(101), "valid-shop", "admin", "shop"]

describe("vendor onboarding messages", () => {
  it.each(VENDOR_VALUES)("business name %j matches the schema", (value) => {
    expect(vendorBusinessNameError(value)).toBe(schemaMessage(vendorSchema.shape.businessName.safeParse(value)))
  })

  it.each(VENDOR_VALUES)("store address %j matches the schema", (value) => {
    expect(vendorSlugError(value)).toBe(schemaMessage(vendorSchema.shape.slug.safeParse(value)))
  })

  it.each(["", "a@b", "a@b.co", "a b@c.co", `${"a".repeat(250)}@b.co`])(
    "support email %j matches the schema",
    (value) => {
      expect(vendorSupportEmailError(value)).toBe(
        schemaMessage(vendorSchema.shape.supportEmail.safeParse(value)),
      )
    },
  )

  it.each(["", "0801 234 5678", "+234-801", "abc", "1".repeat(21)])("phone %j matches the schema", (value) => {
    expect(vendorPhoneError(value)).toBe(schemaMessage(vendorSchema.shape.phone.safeParse(value)))
  })
})

describe("affiliate onboarding messages", () => {
  it.each(["", "ab", "abc", "Abc", "with space", "admin", "good_name", "a".repeat(31)])(
    "username %j matches the schema",
    (value) => {
      expect(affiliateUsernameError(value)).toBe(
        schemaMessage(affiliateSchema.shape.username.safeParse(value)),
      )
    },
  )

  it("accepts an empty channel list without complaining", () => {
    // The schema requires a channel, but the form must not shout at somebody who
    // has not reached the list yet: the server still rejects it on submit.
    expect(affiliateChannelsError([])).toBeUndefined()
  })

  it("rejects more than ten channels and duplicates, as the schema does", () => {
    const eleven = ["whatsapp", "instagram", "tiktok", "x", "facebook", "youtube", "telegram", "blog", "email", "other", "other"]

    expect(affiliateChannelsError(eleven)).toBe("Choose at most 10 channels")
    expect(affiliateChannelsError(["whatsapp", "whatsapp"])).toBe("Choose each channel once")
  })
})
