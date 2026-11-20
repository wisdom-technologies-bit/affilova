// The shapes the affiliate read actions return, and the words the screens show
// for each stored value.
//
// Money is an integer number of kobo here (the database sends bigint, which
// arrives as a number). Every screen formats it with formatNaira; nothing in
// this file does arithmetic on a float.

export type MarketplaceAccess = "none" | "pending" | "approved" | "rejected" | "blocked"

export type MarketplaceSort = "newest" | "commission" | "price_low" | "price_high"

export type AffiliateApproval = "open" | "approval" | "invite"

export interface MarketplaceItem {
  productId: string
  slug: string
  title: string
  shortDescription: string
  coverPublicId: string | null
  vendorName: string
  categorySlug: string
  priceKobo: number
  commissionBps: number
  affiliateApproval: AffiliateApproval
  myAccess: MarketplaceAccess
  myLinkCount: number
}

export interface CategoryOption {
  slug: string
  name: string
}

export interface Balance {
  pendingKobo: number
  availableKobo: number
  totalKobo: number
  negative: boolean
}

export interface Overview {
  clicks: number
  uniqueClicks: number
  orders: number
  revenueKobo: number
  commissionKobo: number
  conversionBps: number
  epcKoboPer100Clicks: number
  balance: Balance
}

export interface DailyPoint {
  day: string
  clicks: number
  uniqueClicks: number
  orders: number
  commissionKobo: number
}

export interface LinkStat {
  linkId: string
  code: string
  alias: string | null
  label: string | null
  productTitle: string
  status: "active" | "archived"
  clicks: number
  uniqueClicks: number
  orders: number
  commissionKobo: number
}

export type BreakdownDimension = "sub1" | "utm_source" | "product"

export interface BreakdownRow {
  label: string
  clicks: number
  uniqueClicks: number
  orders: number
  commissionKobo: number
}

export interface CommissionRow {
  orderNumber: string
  productTitle: string
  commissionKobo: number
  status: string
  paidAt: string | null
  availableAt: string | null
}

export type AccessStatus = "pending" | "approved" | "rejected" | "blocked"

export interface AffiliateRequestRow {
  affiliateId: string
  username: string
  productId: string
  productTitle: string
  status: AccessStatus
  note: string | null
  requestedAt: string
}

export interface VendorAffiliateRow {
  affiliateId: string
  username: string
  clicks: number
  uniqueClicks: number
  orders: number
  revenueKobo: number
  commissionKobo: number
}

export interface InviteRow {
  id: string
  productTitle: string
  maxUses: number
  uses: number
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const ACCESS_WORDS: Readonly<Record<MarketplaceAccess, string>> = {
  none: "Not requested",
  pending: "Request pending",
  approved: "Approved",
  rejected: "Request declined",
  blocked: "Blocked",
}

export const ACCESS_STATUS_WORDS: Readonly<Record<AccessStatus, string>> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
  blocked: "Blocked",
}

export const LINK_STATUS_WORDS: Readonly<Record<"active" | "archived", string>> = {
  active: "Active",
  archived: "Archived",
}

export const APPROVAL_WORDS: Readonly<Record<AffiliateApproval, string>> = {
  open: "Open to all affiliates",
  approval: "Approval required",
  invite: "Invite only",
}

/** The explanation a blocked or declined affiliate reads instead of buttons. */
export function accessExplanation(access: MarketplaceAccess): string | null {
  if (access === "blocked") {
    return "This product's vendor has blocked you from promoting it. The decision is theirs, and this page cannot change it."
  }

  if (access === "rejected") {
    return "This product's vendor declined your request. You can ask again if they change their mind."
  }

  return null
}
