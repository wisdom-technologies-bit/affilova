// The shapes the catalog server actions answer with. Kept out of the "use
// server" modules because those may only export async functions.

export type CatalogFailure = { ok: false; error: string }

export type ProductStatus =
  | "draft"
  | "submitted"
  | "live"
  | "paused"
  | "rejected"
  | "archived"

export type ProductSummary = {
  id: string
  title: string
  slug: string
  shortDescription: string
  priceKobo: number
  currency: string
  status: ProductStatus
  submittedAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  rejectReason: string | null
}

export type ProductDetail = ProductSummary & {
  description: string
  categoryId: number | null
  compareAtPriceKobo: number | null
  commissionBps: number
  affiliateApproval: "open" | "approval" | "invite" | null
  refundWindowHours: number
  maxDownloads: number
}

/** The eight states a file's malware scan can be in. */
export type ScanStatus =
  | "not_scanned"
  | "queued"
  | "scanning"
  | "clean"
  | "infected"
  | "rejected"
  | "needs_review"
  | "error"

export type ProductFile = {
  id: string
  originalName: string
  contentType: string
  sizeBytes: number
  status: "pending" | "uploaded"
  scanStatus: ScanStatus
  /** The scanner's detail code, or a short reason. At most 300 characters. */
  scanDetail: string | null
  /** When the last scan finished, or null. */
  scannedAt: string | null
  createdAt: string
}

export type ProductImage = {
  id: string
  publicId: string
  alt: string | null
  width: number | null
  height: number | null
  sort: number
  isCover: boolean
}

export type ProductReadiness = {
  title: boolean
  shortDescription: boolean
  description: boolean
  category: boolean
  price: boolean
  commission: boolean
  file: boolean
  /** True when every uploaded file has a clean scan verdict. */
  filesScanned: boolean
  cover: boolean
  missing: string[]
}

/** One file's scan state, as the vendor's product screen polls it. */
export type FileScanStatus = {
  id: string
  originalName: string
  scanStatus: ScanStatus
  scanDetail: string | null
  scannedAt: string | null
}

export type CreateProductDraftResult = { ok: true; productId: string } | CatalogFailure

export type UpdateProductResult = { ok: true } | CatalogFailure

export type TransitionProductResult = { ok: true; status: ProductStatus } | CatalogFailure

export type ListVendorProductsResult =
  | { ok: true; items: ProductSummary[]; nextCursor: string | null }
  | CatalogFailure

export type GetProductForEditResult =
  | {
      ok: true
      product: ProductDetail
      files: ProductFile[]
      images: ProductImage[]
      readiness: ProductReadiness
    }
  | CatalogFailure

export type SingleUploadPlan = {
  kind: "single"
  method: "PUT"
  url: string
  expiresInSeconds: number
}

export type MultipartUploadPlan = {
  kind: "multipart"
  uploadId: string
  partSizeBytes: number
  expiresInSeconds: number
  parts: { partNumber: number; url: string }[]
}

export type StartFileUploadResult =
  | {
      ok: true
      fileId: string
      key: string
      contentType: string
      plan: SingleUploadPlan | MultipartUploadPlan
    }
  | CatalogFailure

export type PartUrlsResult =
  | { ok: true; parts: { partNumber: number; url: string }[] }
  | CatalogFailure

export type GetFileScanStatusesResult =
  | { ok: true; files: FileScanStatus[] }
  | CatalogFailure

export type ReviewFileScanResult = { ok: true } | CatalogFailure

export type ConfirmFileUploadResult = { ok: true; fileId: string } | CatalogFailure

export type AbortFileUploadResult = { ok: true } | CatalogFailure

export type DeleteFileResult = { ok: true } | CatalogFailure

export type ImageSignatureResult =
  | {
      ok: true
      cloudName: string
      apiKey: string
      timestamp: number
      signature: string
      folder: string
      allowedFormats: string
    }
  | CatalogFailure

export type RegisterImageResult = { ok: true; imageId: string } | CatalogFailure

export type RemoveImageResult = { ok: true } | CatalogFailure

export type SetCoverImageResult = { ok: true } | CatalogFailure

export type ReviewQueueItem = {
  id: string
  title: string
  slug: string
  priceKobo: number
  businessName: string
  fileCount: number
  submittedAt: string | null
}

export type ListReviewQueueResult =
  | { ok: true; items: ReviewQueueItem[]; nextCursor: string | null }
  | CatalogFailure

export type GetProductForReviewResult =
  | {
      ok: true
      product: ProductDetail
      businessName: string
      files: ProductFile[]
      images: ProductImage[]
      readiness: ProductReadiness
    }
  | CatalogFailure

export type ReviewProductResult = { ok: true; status: ProductStatus } | CatalogFailure

export type ReviewFileUrlResult = { ok: true; url: string; expiresInSeconds: number } | CatalogFailure
