// The shapes the account actions return, and the words the account screens show.
//
// Money is an integer number of kobo here (the database sends bigint, which
// arrives as a number). Every screen formats it with formatNaira; nothing in this
// file does arithmetic on a float.
//
// Nothing in these shapes carries a storage key. A file is described by what it
// is called, how big it is, and how many downloads are left.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type OrderStatus = "pending" | "paid" | "expired" | "failed" | "refunded" | "disputed"

export interface OrderSummary {
  orderId: string
  number: string
  status: OrderStatus
  totalKobo: number
  paidAt: string | null
  createdAt: string
  productTitle: string
  productSlug: string
  vendorName: string
  coverPublicId: string | null
}

export interface OrderItemLine {
  orderItemId: string
  productId: string
  title: string
  unitPriceKobo: number
  vendorName: string
}

export type TaxBasis = "platform_fee" | "product_price"

export interface TaxLine {
  basis: TaxBasis
  rateBps: number
  baseKobo: number
  taxKobo: number
  included: boolean
  supplier: "affilova" | "vendor"
}

export interface EntitlementRow {
  entitlementId: string
  fileDisplayName: string
  sizeBytes: number
  downloadsUsed: number
  maxDownloads: number
  revoked: boolean
  scanClean: boolean
}

export interface RefundRequestSummary {
  status: string
  autoApproved: boolean
}

export interface OrderDetail {
  orderId: string
  number: string
  status: OrderStatus
  currency: string
  subtotalKobo: number
  taxKobo: number
  taxIncluded: boolean
  totalKobo: number
  channel: string | null
  paidAt: string | null
  createdAt: string
  refundWindowEndsAt: string | null
  items: OrderItemLine[]
  taxLines: TaxLine[]
  refundRequest: RefundRequestSummary | null
  entitlements: EntitlementRow[]
}

export type DownloadResult = { ok: true; url: string } | { ok: false; error: string }

/** The status a stored order value stands for, or "pending" for anything unknown. */
export function orderStatus(value: string): OrderStatus {
  return value === "paid" ||
    value === "expired" ||
    value === "failed" ||
    value === "refunded" ||
    value === "disputed"
    ? value
    : "pending"
}

// Every status in the words a buyer reads. A status is never colour alone: each
// of these is text next to its pill.
const ORDER_STATUS_WORDS: Readonly<Record<OrderStatus, string>> = {
  pending: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
  failed: "Payment failed",
  refunded: "Refunded",
  disputed: "Disputed",
}

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_WORDS[status]
}

/** True for an order whose files may still be downloaded. */
export function isDownloadable(status: OrderStatus): boolean {
  return status === "paid"
}

/** The tax basis in plain words, for the receipt. */
export function taxBasisLabel(basis: TaxBasis): string {
  return basis === "platform_fee" ? "VAT on the platform fee" : "VAT on the product price"
}
