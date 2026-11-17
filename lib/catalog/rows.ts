// Reading rows that came back from PostgREST.
//
// The client is untyped, so every field is treated as unknown until it has been
// checked. A shape that does not match is a failed action, never a crash in the
// middle of building a response.

import type {
  ProductDetail,
  ProductFile,
  ProductImage,
  ProductReadiness,
  ProductStatus,
  ProductSummary,
} from "./action-types"

const STATUSES: readonly ProductStatus[] = [
  "draft",
  "submitted",
  "live",
  "paused",
  "rejected",
  "archived",
]

const FILE_STATUSES: readonly ProductFile["status"][] = ["pending", "uploaded"]

const SCAN_STATUSES: readonly ProductFile["scanStatus"][] = [
  "not_scanned",
  "clean",
  "infected",
  "error",
]

const APPROVALS = ["open", "approval", "invite"] as const

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]

  return typeof value === "string" ? value : null
}

export function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]

  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  // PostgREST can render a bigint as a string when it is large.
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value)
  }

  return null
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true
}

function readStatus(row: Record<string, unknown>): ProductStatus | null {
  const value = readString(row, "status")

  return value !== null && (STATUSES as readonly string[]).includes(value)
    ? (value as ProductStatus)
    : null
}

export function toProductSummary(row: Record<string, unknown>): ProductSummary | null {
  const id = readString(row, "id")
  const title = readString(row, "title")
  const slug = readString(row, "slug")
  const status = readStatus(row)

  if (id === null || title === null || slug === null || status === null) {
    return null
  }

  return {
    id,
    title,
    slug,
    shortDescription: readString(row, "short_description") ?? "",
    priceKobo: readNumber(row, "price_kobo") ?? 0,
    currency: readString(row, "currency") ?? "NGN",
    status,
    submittedAt: readString(row, "submitted_at"),
    publishedAt: readString(row, "published_at"),
    createdAt: readString(row, "created_at") ?? "",
    updatedAt: readString(row, "updated_at") ?? "",
    rejectReason: readString(row, "reject_reason"),
  }
}

export function toProductDetail(row: Record<string, unknown>): ProductDetail | null {
  const summary = toProductSummary(row)

  if (summary === null || summary.updatedAt === "") {
    return null
  }

  const approval = readString(row, "affiliate_approval")

  return {
    ...summary,
    description: readString(row, "description") ?? "",
    categoryId: readNumber(row, "category_id"),
    compareAtPriceKobo: readNumber(row, "compare_at_price_kobo"),
    commissionBps: readNumber(row, "commission_bps") ?? 0,
    affiliateApproval:
      approval !== null && (APPROVALS as readonly string[]).includes(approval)
        ? (approval as ProductDetail["affiliateApproval"])
        : null,
    refundWindowHours: readNumber(row, "refund_window_hours") ?? 0,
    maxDownloads: readNumber(row, "max_downloads") ?? 0,
  }
}

export function toProductFile(row: Record<string, unknown>): ProductFile | null {
  const id = readString(row, "id")
  const status = readString(row, "status")
  const scanStatus = readString(row, "scan_status")

  if (id === null || status === null || scanStatus === null) {
    return null
  }

  if (!(FILE_STATUSES as readonly string[]).includes(status)) {
    return null
  }

  if (!(SCAN_STATUSES as readonly string[]).includes(scanStatus)) {
    return null
  }

  return {
    id,
    originalName: readString(row, "original_name") ?? "",
    contentType: readString(row, "content_type") ?? "",
    sizeBytes: readNumber(row, "size_bytes") ?? 0,
    status: status as ProductFile["status"],
    scanStatus: scanStatus as ProductFile["scanStatus"],
    createdAt: readString(row, "created_at") ?? "",
  }
}

export function toProductImage(row: Record<string, unknown>): ProductImage | null {
  const id = readString(row, "id")
  const publicId = readString(row, "cloudinary_public_id")

  if (id === null || publicId === null) {
    return null
  }

  return {
    id,
    publicId,
    alt: readString(row, "alt_text"),
    width: readNumber(row, "width"),
    height: readNumber(row, "height"),
    sort: readNumber(row, "sort") ?? 0,
    isCover: readBoolean(row, "is_cover"),
  }
}

const READINESS_KEYS = [
  "title",
  "short_description",
  "description",
  "category",
  "price",
  "commission",
  "file",
  "cover",
] as const

/**
 * Read the jsonb that get_product_readiness returns. Anything that is not a
 * boolean counts as "not ready", so an unexpected answer blocks a submit rather
 * than letting an incomplete product through.
 */
export function toProductReadiness(value: unknown): ProductReadiness {
  const row = asRecord(value) ?? {}
  const missingRaw = row.missing
  const missing = Array.isArray(missingRaw)
    ? missingRaw.filter((entry): entry is string => typeof entry === "string")
    : []

  const flag = (key: string): boolean => row[key] === true

  return {
    title: flag("title"),
    shortDescription: flag("short_description"),
    description: flag("description"),
    category: flag("category"),
    price: flag("price"),
    commission: flag("commission"),
    file: flag("file"),
    cover: flag("cover"),
    missing: missing.length > 0 ? missing : READINESS_KEYS.filter((key) => !flag(key)),
  }
}
