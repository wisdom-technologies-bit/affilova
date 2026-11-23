// The shapes the merchant actions return.
//
// Money is an integer number of kobo. Nothing here carries a buyer's name or
// email: a vendor sees what sold and what it earned, never who bought.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface VendorOverview {
  orders: number
  grossKobo: number
  vendorNetKobo: number
  platformFeeKobo: number
  affiliateCommissionKobo: number
  affiliateOrders: number
  refundsCount: number
  refundsKobo: number
  refundRateBps: number
  pendingKobo: number
  availableKobo: number
}

export interface VendorDailyPoint {
  day: string
  orders: number
  grossKobo: number
  vendorNetKobo: number
}

export interface VendorSaleRow {
  orderNumber: string
  productTitle: string
  status: string
  paidAt: string | null
  grossKobo: number
  vendorNetKobo: number
  viaAffiliate: boolean
}

export interface VendorRefundRow {
  requestId: string
  orderNumber: string
  productTitle: string
  reason: string
  status: string
  autoApproved: boolean
  requestedAt: string
  decidedAt: string | null
  amountKobo: number
}

export interface VendorTopProduct {
  productId: string
  title: string
  orders: number
  grossKobo: number
  refunds: number
}

/** The sales tabs, "all" first. */
export const SALES_TABS = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
  { value: "disputed", label: "Disputed" },
] as const

export type SalesTab = (typeof SALES_TABS)[number]["value"]

/** The sales tab a query parameter asks for, or "all" for anything unknown. */
export function salesTabFromParam(value: string | undefined): SalesTab {
  return SALES_TABS.find((tab) => tab.value === value)?.value ?? "all"
}

const SALE_STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: "Awaiting payment",
  paid: "Paid",
  expired: "Expired",
  failed: "Payment failed",
  refunded: "Refunded",
  disputed: "Disputed",
}

export function saleStatusLabel(status: string): string {
  return SALE_STATUS_WORDS[status] ?? "Unknown"
}

const REFUND_STATUS_WORDS: Readonly<Record<string, string>> = {
  requested: "Waiting for a decision",
  approved: "Approved, refund on its way",
  rejected: "Declined",
  processed: "Refunded",
  failed: "Refund failed",
}

export function refundStatusLabel(status: string): string {
  return REFUND_STATUS_WORDS[status] ?? "Unknown"
}

/** A rate in basis points as the percentage a person reads: 3846 is "38.46". */
export function formatBpsPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) {
    return "0"
  }

  const whole = Math.floor(bps / 100)
  const remainder = bps % 100

  return remainder === 0 ? `${whole}%` : `${whole}.${remainder.toString().padStart(2, "0")}%`
}
