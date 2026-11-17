// The bridge between the camelCase the application speaks and the snake_case
// keys public.create_product_draft / public.update_product whitelist.

import type { ProductFieldsInput } from "./schemas"

export function toSqlProductFields(fields: ProductFieldsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (fields.title !== undefined) out.title = fields.title
  if (fields.slug !== undefined) out.slug = fields.slug
  if (fields.categorySlug !== undefined) out.category_slug = fields.categorySlug
  if (fields.shortDescription !== undefined) out.short_description = fields.shortDescription
  if (fields.description !== undefined) out.description = fields.description
  if (fields.priceKobo !== undefined) out.price_kobo = fields.priceKobo
  if (fields.compareAtPriceKobo !== undefined) out.compare_at_price_kobo = fields.compareAtPriceKobo
  if (fields.commissionBps !== undefined) out.commission_bps = fields.commissionBps
  if (fields.affiliateApproval !== undefined) out.affiliate_approval = fields.affiliateApproval
  if (fields.refundWindowHours !== undefined) out.refund_window_hours = fields.refundWindowHours
  if (fields.maxDownloads !== undefined) out.max_downloads = fields.maxDownloads

  return out
}
