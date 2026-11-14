import { z } from "zod"

import { isReservedHandle } from "./reserved-handles"

// What the two onboarding forms accept.
//
// The rules mirror the CHECK constraints in
// supabase/migrations/20261113000100_roles_onboarding.sql, so a value that
// passes here is a value the database will store. The database still has the
// final say: these schemas exist to give a useful message next to the field it
// belongs to, not to replace the constraints.
//
// Every handle is trimmed and lowercased before it is checked, so "Shop" and
// " shop " are stored as "shop". The patterns then only ever see lowercase.

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/
const PHONE_PATTERN = /^[0-9+()\s-]*$/
const COUNTRY_PATTERN = /^[A-Z]{2}$/

const SLUG_MESSAGE =
  "Use 3 to 40 characters: lowercase letters, numbers or hyphens, starting and ending with a letter or number"
const USERNAME_MESSAGE = "Use 3 to 30 characters: lowercase letters, numbers or underscores"
const RESERVED_MESSAGE = "That one is reserved. Choose another"

/** The channels an affiliate can say they promote on. */
export const PROMOTION_CHANNELS = [
  "whatsapp",
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "youtube",
  "telegram",
  "blog",
  "email",
  "other",
] as const

export type PromotionChannel = (typeof PROMOTION_CHANNELS)[number]

const acceptTerms = z
  .boolean({ required_error: "Accept the terms to continue" })
  .refine((value) => value === true, "Accept the terms to continue")

export const vendorSchema = z.object({
  businessName: z
    .string({ required_error: "Enter your business name" })
    .trim()
    .min(2, "Use at least 2 characters")
    .max(100, "Use at most 100 characters"),
  slug: z
    .string({ required_error: "Choose a store address" })
    .trim()
    .toLowerCase()
    .regex(SLUG_PATTERN, SLUG_MESSAGE)
    .refine((value) => !isReservedHandle(value), RESERVED_MESSAGE),
  supportEmail: z
    .string({ required_error: "Enter a support email address" })
    .trim()
    .toLowerCase()
    .min(1, "Enter a support email address")
    .max(254, "That email address is too long")
    .email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .max(20, "Use at most 20 characters")
    .regex(PHONE_PATTERN, "Use digits, spaces, +, - or parentheses")
    .optional(),
  country: z
    .string({ required_error: "Enter your country code" })
    .trim()
    .toUpperCase()
    .regex(COUNTRY_PATTERN, "Use the two-letter country code")
    .default("NG"),
  acceptTerms,
})

export const affiliateSchema = z.object({
  username: z
    .string({ required_error: "Choose a username" })
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, USERNAME_MESSAGE)
    .refine((value) => !isReservedHandle(value), RESERVED_MESSAGE),
  promotionChannels: z
    .array(z.enum(PROMOTION_CHANNELS), { required_error: "Choose your promotion channels" })
    .max(10, "Choose at most 10 channels")
    .refine((values) => new Set(values).size === values.length, "Choose each channel once"),
  country: z
    .string({ required_error: "Enter your country code" })
    .trim()
    .toUpperCase()
    .regex(COUNTRY_PATTERN, "Use the two-letter country code")
    .default("NG"),
  acceptTerms,
})

/** What a caller may pass in: country is optional because it defaults to NG. */
export type VendorInput = z.input<typeof vendorSchema>
export type AffiliateInput = z.input<typeof affiliateSchema>

/** What comes out: trimmed, lowercased and with the defaults applied. */
export type VendorValues = z.output<typeof vendorSchema>
export type AffiliateValues = z.output<typeof affiliateSchema>
