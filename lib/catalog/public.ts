import "server-only"

import { getCloudinaryEnv } from "@/lib/env"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { refundWindowLabel } from "./format"

// What the public product page is allowed to know.
//
// One read, with the admin client, for one slug: a product that is live, from a
// vendor whose profile is active. Everything else (drafts, paused products, a
// suspended vendor's shelf) answers null, and the page turns that into the
// standard 404. Nothing about the vendor's account, the buyer, or a file's name
// is read here.
//
// The file list is a count and a set of types only: a buyer needs to know what
// they receive (a PDF, a ZIP, a video), never what the files are called.

export interface PublicProductImage {
  /** The Cloudinary public id, so a page can ask for another width. */
  publicId: string
  url: string
  alt: string
  width: number | null
  height: number | null
  isCover: boolean
}

export interface PublicProduct {
  id: string
  slug: string
  title: string
  shortDescription: string
  description: string
  priceKobo: number
  categoryName: string
  vendorBusinessName: string
  images: PublicProductImage[]
  /** How many files the buyer gets. Never their names. */
  fileCount: number
  /** Uppercase short labels, one per distinct type: PDF, ZIP, MP4. */
  fileTypes: string[]
  refundWindowHours: number
  publishedAt: string | null
}

/** The width every gallery image is cropped to. Cloudinary does the work. */
export const GALLERY_WIDTH = 1200

/** The width of the Open Graph image. */
export const SOCIAL_WIDTH = 1200

const SLUG = /^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$/

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/

const FILE_TYPE_LABELS: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "application/x-zip-compressed": "ZIP",
  "application/epub+zip": "EPUB",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "video/mp4": "MP4",
  "video/quicktime": "MOV",
  "audio/mpeg": "MP3",
  "audio/mp4": "M4A",
  "audio/wav": "WAV",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "text/plain": "TXT",
  "text/csv": "CSV",
}

/** "PDF" for application/pdf, and the subtype in capitals for anything else. */
export function fileTypeLabel(contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? ""

  if (type === "") {
    return "FILE"
  }

  const known = FILE_TYPE_LABELS[type]

  if (known !== undefined) {
    return known
  }

  const subtype = type.split("/")[1] ?? ""

  return subtype === "" ? "FILE" : subtype.toUpperCase().slice(0, 16)
}

/**
 * A Cloudinary delivery URL: fill-cropped, automatic format, automatic quality.
 *
 * Returns null for a public id that could carry its own transformation or query,
 * so nothing a vendor typed can turn into a URL this page did not build.
 */
export function cloudinaryImageUrl(publicId: string, cloudName: string, width: number): string | null {
  if (publicId === "" || cloudName === "" || !PUBLIC_ID.test(publicId)) {
    return null
  }

  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,f_auto,q_auto,w_${width}/${publicId}`
}

/** "Refund requests accepted within 24 hours of purchase". */
export function refundSentence(hours: number): string {
  return `Refund requests accepted within ${refundWindowLabel(hours)} of purchase`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key]

  return typeof value === "string" ? value : ""
}

function integer(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]

  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value)
  }

  return null
}

function rows(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key]

  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
}

/**
 * Turn one joined row into a public product, or null when it must not be shown.
 *
 * The two conditions that matter are checked here as well as in the query:
 * the product is live, and its vendor's profile is active.
 */
export function toPublicProduct(row: unknown, cloudName: string): PublicProduct | null {
  const record = asRecord(row)

  if (record === null) {
    return null
  }

  if (text(record, "status") !== "live") {
    return null
  }

  const vendor = asRecord(record.vendor_profiles) ?? {}

  if (text(vendor, "status") !== "active") {
    return null
  }

  const id = text(record, "id")
  const slug = text(record, "slug")
  const title = text(record, "title")
  const priceKobo = integer(record, "price_kobo")
  const refundWindowHours = integer(record, "refund_window_hours")

  if (id === "" || slug === "" || !SLUG.test(slug) || title === "") {
    return null
  }

  if (priceKobo === null || priceKobo <= 0 || refundWindowHours === null || refundWindowHours <= 0) {
    return null
  }

  const images = rows(record, "product_images")
    .map((image): PublicProductImage | null => {
      const publicId = text(image, "cloudinary_public_id")
      const url = cloudinaryImageUrl(publicId, cloudName, GALLERY_WIDTH)

      if (url === null) {
        return null
      }

      const width = integer(image, "width")
      const height = integer(image, "height")

      return {
        publicId,
        url,
        alt: text(image, "alt_text"),
        width: width === null || width <= 0 ? null : width,
        height: height === null || height <= 0 ? null : height,
        isCover: image.is_cover === true,
      }
    })
    .filter((image): image is PublicProductImage => image !== null)
    .sort((a, b) => Number(b.isCover) - Number(a.isCover))

  const delivered = rows(record, "product_files").filter(
    (file) => text(file, "status") === "uploaded" && text(file, "scan_status") === "clean",
  )

  const fileTypes = [...new Set(delivered.map((file) => fileTypeLabel(text(file, "content_type"))))].sort()

  const category = asRecord(record.product_categories)

  return {
    id,
    slug,
    title,
    shortDescription: text(record, "short_description"),
    description: text(record, "description"),
    priceKobo,
    categoryName: category === null ? "" : text(category, "name"),
    vendorBusinessName: text(vendor, "business_name"),
    images,
    fileCount: delivered.length,
    fileTypes,
    refundWindowHours,
    publishedAt: text(record, "published_at") === "" ? null : text(record, "published_at"),
  }
}

export interface PublicCatalogDeps {
  /** One joined row for a slug, or null. Injected so tests need no database. */
  loadRow: (slug: string) => Promise<unknown | null>
  cloudName: string
}

const SELECT = [
  "id",
  "slug",
  "title",
  "short_description",
  "description",
  "price_kobo",
  "refund_window_hours",
  "published_at",
  "status",
  "product_categories(name)",
  "vendor_profiles!inner(business_name,status)",
  "product_images(cloudinary_public_id,alt_text,width,height,sort,is_cover)",
  "product_files(content_type,status,scan_status)",
].join(",")

async function loadPublicRow(slug: string): Promise<unknown | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("products")
    .select(SELECT)
    .eq("slug", slug)
    .eq("status", "live")
    .eq("vendor_profiles.status", "active")
    .maybeSingle()

  if (error !== null) {
    return null
  }

  return data
}

function defaultDeps(): PublicCatalogDeps {
  return {
    loadRow: loadPublicRow,
    cloudName: getCloudinaryEnv().CLOUDINARY_CLOUD_NAME,
  }
}

/**
 * One live product by slug, or null.
 *
 * A slug that is not shaped like a slug is refused before any query is made.
 */
export async function getPublicProduct(
  slug: string,
  deps?: PublicCatalogDeps,
): Promise<PublicProduct | null> {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    return null
  }

  let resolved: PublicCatalogDeps

  try {
    resolved = deps ?? defaultDeps()
  } catch {
    // No image account configured: nothing can be shown without its images, and
    // guessing a cloud name would produce broken URLs.
    return null
  }

  let row: unknown

  try {
    row = await resolved.loadRow(slug)
  } catch {
    return null
  }

  return row === null ? null : toPublicProduct(row, resolved.cloudName)
}
