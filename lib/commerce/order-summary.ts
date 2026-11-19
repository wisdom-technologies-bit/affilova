import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The one read the email jobs need.
//
// It is a plain select with the admin client: no RPC, no write, nothing that
// could change an order. Everything the emails quote is read here, once, so a
// vendor editing a product after the sale cannot change what the receipt says.

export interface OrderSummaryItem {
  productId: string
  productSlug: string | null
  title: string
  unitPriceKobo: number
  vendorId: string
  vendorBusinessName: string
  vendorEmail: string | null
  affiliateId: string | null
  affiliateEmail: string | null
  affiliateCommissionKobo: number
  vendorNetKobo: number
  refundWindowHours: number
  maxDownloads: number
}

export interface OrderSummary {
  id: string
  number: string
  buyerEmail: string
  buyerName: string | null
  status: string
  paidAt: string | null
  totalKobo: number
  currency: string
  /** How long a commission is held before it can be withdrawn. */
  commissionHoldDays: number
  item: OrderSummaryItem | null
}

const SELECT = [
  "id",
  "number",
  "buyer_email",
  "buyer_name",
  "status",
  "paid_at",
  "total_kobo",
  "currency",
  "order_items(title_snapshot,unit_price_kobo,vendor_id,affiliate_id,affiliate_commission_kobo,vendor_net_kobo,refund_window_hours,max_downloads,product_id,products(slug),vendor_profiles(business_name,profiles(email)))",
].join(",")

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) {
    return null
  }

  const value = source[key]

  return typeof value === "string" && value !== "" ? value : null
}

function integer(source: Record<string, unknown> | null, key: string, fallback: number): number {
  if (source === null) {
    return fallback
  }

  const value = source[key]

  return typeof value === "number" && Number.isInteger(value) ? value : fallback
}

/** Read the summary out of the joined row. Anything malformed answers null. */
export function toOrderSummary(row: unknown, commissionHoldDays: number): OrderSummary | null {
  const record = asRecord(row)

  if (record === null) {
    return null
  }

  const id = text(record, "id")
  const number = text(record, "number")
  const buyerEmail = text(record, "buyer_email")
  const status = text(record, "status")

  if (id === null || number === null || buyerEmail === null || status === null) {
    return null
  }

  const items: unknown = record.order_items
  const rawItem = Array.isArray(items) ? asRecord(items[0]) : null

  let item: OrderSummaryItem | null = null

  if (rawItem !== null) {
    const vendor = asRecord(rawItem.vendor_profiles)
    const vendorProfile = asRecord(vendor?.profiles)
    const affiliate = asRecord(rawItem.affiliate)
    const product = asRecord(rawItem.products)

    const vendorId = text(rawItem, "vendor_id")
    const title = text(rawItem, "title_snapshot")

    if (vendorId !== null && title !== null) {
      item = {
        productId: text(rawItem, "product_id") ?? "",
        productSlug: text(product, "slug"),
        title,
        unitPriceKobo: integer(rawItem, "unit_price_kobo", 0),
        vendorId,
        vendorBusinessName: text(vendor, "business_name") ?? "the vendor",
        vendorEmail: text(vendorProfile, "email"),
        affiliateId: text(rawItem, "affiliate_id"),
        affiliateEmail: text(affiliate, "email"),
        affiliateCommissionKobo: integer(rawItem, "affiliate_commission_kobo", 0),
        vendorNetKobo: integer(rawItem, "vendor_net_kobo", 0),
        refundWindowHours: integer(rawItem, "refund_window_hours", 0),
        maxDownloads: integer(rawItem, "max_downloads", 0),
      }
    }
  }

  return {
    id,
    number,
    buyerEmail,
    buyerName: text(record, "buyer_name"),
    status,
    paidAt: text(record, "paid_at"),
    totalKobo: integer(record, "total_kobo", 0),
    currency: text(record, "currency") ?? "NGN",
    commissionHoldDays,
    item,
  }
}

async function readHoldDays(): Promise<number> {
  const { data, error } = await getSupabaseAdminClient()
    .from("settings")
    .select("value")
    .eq("key", "commission_hold_days")
    .maybeSingle()

  if (error !== null) {
    return 7
  }

  const record = asRecord(data)
  const raw = record?.value

  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw
  }

  return 7
}

/** One order, ready to be written into an email. */
export async function readOrderSummary(orderId: string): Promise<OrderSummary | null> {
  const holdDays = await readHoldDays()

  const { data, error } = await getSupabaseAdminClient()
    .from("orders")
    .select(SELECT)
    .eq("id", orderId)
    .maybeSingle()

  if (error !== null) {
    return null
  }

  return data === null ? null : toOrderSummary(data, holdDays)
}
