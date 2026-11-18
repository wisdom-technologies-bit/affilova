// Input shapes for the catalog server actions.
//
// These are the second line of defence, not the first: the migration validates
// the same fields again, because a server action can be called by a signed-in
// vendor while the functions are callable by the service role from anywhere.

import { z } from "zod"

const uuid = z.string().uuid("must be a valid id")

/** Kobo, as an integer. The same range the products table enforces. */
const kobo = z
  .number()
  .int("must be a whole number of kobo")
  .min(10_000, "must be at least 10000 kobo")
  .max(1_000_000_000, "must be at most 1000000000 kobo")

/** The keys a vendor may set. Unknown keys are refused, not ignored. */
export const productFieldsSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    slug: z.string().trim().min(4).max(80),
    categorySlug: z.string().trim().min(1).max(60),
    shortDescription: z.string().trim().min(10).max(200),
    description: z.string().max(10_000),
    priceKobo: kobo,
    compareAtPriceKobo: kobo.nullable(),
    commissionBps: z.number().int().min(500).max(8000),
    affiliateApproval: z.enum(["open", "approval", "invite"]),
    refundWindowHours: z.number().int().min(24).max(720),
    maxDownloads: z.number().int().min(1).max(100),
  })
  .partial()
  .strict()

export type ProductFieldsInput = z.infer<typeof productFieldsSchema>

/** A draft needs these to exist at all; the rest have sensible defaults. */
export const createProductDraftFieldsSchema = productFieldsSchema.superRefine((fields, ctx) => {
  const required = [
    ["title", fields.title],
    ["categorySlug", fields.categorySlug],
    ["shortDescription", fields.shortDescription],
    ["priceKobo", fields.priceKobo],
  ] as const

  for (const [key, value] of required) {
    if (value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required` })
    }
  }
})

export const productIdSchema = z.object({ productId: uuid }).strict()

export const createProductDraftSchema = z
  .object({ fields: createProductDraftFieldsSchema })
  .strict()

export const updateProductSchema = z
  .object({ productId: uuid, fields: productFieldsSchema })
  .strict()

export const transitionActionSchema = z.enum(["submit", "withdraw", "pause", "resume", "archive"])

export const transitionProductSchema = z
  .object({ productId: uuid, action: transitionActionSchema })
  .strict()

export const productStatusSchema = z.enum([
  "draft",
  "submitted",
  "live",
  "paused",
  "rejected",
  "archived",
])

export const listVendorProductsSchema = z
  .object({
    cursor: z.string().max(200).optional(),
    status: productStatusSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()

export const startFileUploadSchema = z
  .object({
    productId: uuid,
    filename: z.string().min(1).max(300),
    sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024 * 1024),
  })
  .strict()

export const getPartUrlsSchema = z
  .object({
    fileId: uuid,
    partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
  })
  .strict()

export const completedPartSchema = z
  .object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })
  .strict()

export const completeMultipartSchema = z
  .object({ fileId: uuid, parts: z.array(completedPartSchema).min(1).max(100) })
  .strict()

export const fileIdSchema = z.object({ fileId: uuid }).strict()

export const signImageUploadSchema = z.object({ productId: uuid }).strict()

export const registerImageSchema = z
  .object({
    productId: uuid,
    publicId: z.string().min(1).max(300),
    alt: z.string().max(140).optional(),
    makeCover: z.boolean().optional(),
  })
  .strict()

export const imageIdSchema = z.object({ imageId: uuid }).strict()

export const listReviewQueueSchema = z
  .object({ cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).optional() })
  .strict()

export const reviewProductSchema = z
  .object({
    productId: uuid,
    decision: z.enum(["approve", "reject"]),
    reason: z.string().max(1000).optional(),
  })
  .strict()

export const staffPauseProductSchema = z
  .object({ productId: uuid, reason: z.string().max(1000) })
  .strict()

export const reviewFileScanSchema = z
  .object({
    fileId: uuid,
    decision: z.enum(["clean", "reject"]),
    reason: z.string().max(1000),
  })
  .strict()
