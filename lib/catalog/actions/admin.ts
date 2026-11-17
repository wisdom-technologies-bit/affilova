"use server"

import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { getR2Storage } from "@/lib/storage/r2"

import type {
  GetProductForReviewResult,
  ListReviewQueueResult,
  ProductDetail,
  ProductFile,
  ProductImage,
  ReviewFileUrlResult,
  ReviewProductResult,
  ReviewQueueItem,
} from "@/lib/catalog/action-types"
import { decodeCursor, encodeCursor } from "@/lib/catalog/cursor"
import { actionFailure, GENERIC_ERROR } from "@/lib/catalog/errors"
import { parseInput, requireActor } from "@/lib/catalog/guard"
import {
  asRecord,
  readNumber,
  readString,
  toProductDetail,
  toProductFile,
  toProductImage,
  toProductReadiness,
} from "@/lib/catalog/rows"
import {
  fileIdSchema,
  listReviewQueueSchema,
  productIdSchema,
  productStatusSchema,
  reviewProductSchema,
  staffPauseProductSchema,
} from "@/lib/catalog/schemas"

// The review side of the catalog. These actions require products:review, which
// only admin and moderator hold.
//
// Reviewing is the one place a member of staff reads a vendor's private file, so
// getReviewFileDownloadUrlAction writes an audit row before it hands out a link.
// There is no malware scanning yet, which makes that record the control that
// stands in for it.

const PRODUCT_COLUMNS =
  "id, title, slug, short_description, description, price_kobo, compare_at_price_kobo, currency, commission_bps, affiliate_approval, refund_window_hours, max_downloads, status, reject_reason, submitted_at, published_at, created_at, updated_at, category_id, vendor_id"
const FILE_COLUMNS =
  "id, original_name, content_type, size_bytes, status, scan_status, created_at"
const IMAGE_COLUMNS = "id, cloudinary_public_id, alt_text, width, height, sort, is_cover"

function failed(error: unknown): { ok: false; error: string } {
  return actionFailure(error)
}

export async function listReviewQueueAction(input: unknown): Promise<ListReviewQueueResult> {
  const guard = await requireActor("products:review")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(listReviewQueueSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  const limit = parsed.data.limit ?? 20
  const cursor = decodeCursor(parsed.data.cursor)

  try {
    const supabase = getSupabaseAdminClient()

    let query = supabase
      .from("products")
      .select(`${PRODUCT_COLUMNS}, vendor_profiles!inner(business_name)`)
      .eq("status", "submitted")
      // Oldest submission first: the queue is a queue, not a popularity contest.
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit + 1)

    if (cursor !== null) {
      query = query.or(
        `submitted_at.gt.${cursor.at},and(submitted_at.eq.${cursor.at},id.gt.${cursor.id})`,
      )
    }

    const { data, error } = await query

    if (error) {
      return failed(error)
    }

    const rows = Array.isArray(data) ? data : []
    const items: ReviewQueueItem[] = []
    const productIds: string[] = []

    for (const row of rows) {
      const record = asRecord(row)

      if (record === null) {
        continue
      }

      const id = readString(record, "id")
      const title = readString(record, "title")
      const slug = readString(record, "slug")

      if (id === null || title === null || slug === null) {
        continue
      }

      const vendor = asRecord(record.vendor_profiles)

      items.push({
        id,
        title,
        slug,
        priceKobo: readNumber(record, "price_kobo") ?? 0,
        businessName: vendor === null ? "" : readString(vendor, "business_name") ?? "",
        fileCount: 0,
        submittedAt: readString(record, "submitted_at"),
      })

      productIds.push(id)
    }

    const page = items.slice(0, limit)

    // One extra read for the file counts, rather than a join that would return a
    // row per file.
    if (page.length > 0) {
      const counts = await supabase
        .from("product_files")
        .select("product_id")
        .in(
          "product_id",
          page.map((item) => item.id),
        )

      if (!counts.error && Array.isArray(counts.data)) {
        const tally = new Map<string, number>()

        for (const row of counts.data) {
          const record = asRecord(row)
          const productId = record === null ? null : readString(record, "product_id")

          if (productId !== null) {
            tally.set(productId, (tally.get(productId) ?? 0) + 1)
          }
        }

        for (const item of page) {
          item.fileCount = tally.get(item.id) ?? 0
        }
      }
    }

    const last = page[page.length - 1]
    const nextCursor =
      items.length > limit && last !== undefined && last.submittedAt !== null
        ? encodeCursor({ at: last.submittedAt, id: last.id })
        : null

    return { ok: true, items: page, nextCursor }
  } catch (error) {
    logger.error("catalog_review_queue_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function getProductForReviewAction(input: unknown): Promise<GetProductForReviewResult> {
  const guard = await requireActor("products:review")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(productIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const supabase = getSupabaseAdminClient()

    const [productResult, filesResult, imagesResult, readinessResult] = await Promise.all([
      supabase
        .from("products")
        .select(`${PRODUCT_COLUMNS}, vendor_profiles!inner(business_name)`)
        .eq("id", parsed.data.productId)
        .maybeSingle(),
      supabase
        .from("product_files")
        .select(FILE_COLUMNS)
        .eq("product_id", parsed.data.productId)
        .order("created_at", { ascending: true }),
      supabase
        .from("product_images")
        .select(IMAGE_COLUMNS)
        .eq("product_id", parsed.data.productId)
        .order("sort", { ascending: true }),
      supabase.rpc("get_product_readiness", { p_product: parsed.data.productId }),
    ])

    if (productResult.error || filesResult.error || imagesResult.error) {
      return failed(productResult.error ?? filesResult.error ?? imagesResult.error)
    }

    const productRow = asRecord(productResult.data)
    const product: ProductDetail | null = productRow === null ? null : toProductDetail(productRow)

    if (product === null || productRow === null) {
      return failed("not_found")
    }

    const vendor = asRecord(productRow.vendor_profiles)
    const files: ProductFile[] = []

    for (const row of Array.isArray(filesResult.data) ? filesResult.data : []) {
      const record = asRecord(row)
      const file = record === null ? null : toProductFile(record)

      if (file !== null) {
        files.push(file)
      }
    }

    const images: ProductImage[] = []

    for (const row of Array.isArray(imagesResult.data) ? imagesResult.data : []) {
      const record = asRecord(row)
      const image = record === null ? null : toProductImage(record)

      if (image !== null) {
        images.push(image)
      }
    }

    return {
      ok: true,
      product,
      businessName: vendor === null ? "" : readString(vendor, "business_name") ?? "",
      files,
      images,
      readiness: toProductReadiness(readinessResult.error ? null : readinessResult.data),
    }
  } catch (error) {
    logger.error("catalog_review_product_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

async function decide(input: {
  productId: string
  action: "approve" | "reject" | "staff_pause"
  reason: string | null
}): Promise<ReviewProductResult> {
  const guard = await requireActor("products:review")

  if (!guard.ok) {
    return guard
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("product_transition", {
      p_actor: guard.actor.userId,
      p_product: input.productId,
      p_action: input.action,
      p_reason: input.reason,
    })

    if (error) {
      return failed(error)
    }

    const status = productStatusSchema.safeParse(data)

    if (!status.success) {
      return { ok: false, error: GENERIC_ERROR }
    }

    return { ok: true, status: status.data }
  } catch (error) {
    logger.error("catalog_review_decision_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function reviewProductAction(input: unknown): Promise<ReviewProductResult> {
  const parsed = parseInput(reviewProductSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  return decide({
    productId: parsed.data.productId,
    action: parsed.data.decision,
    reason: parsed.data.decision === "reject" ? parsed.data.reason ?? null : null,
  })
}

export async function staffPauseProductAction(input: unknown): Promise<ReviewProductResult> {
  const parsed = parseInput(staffPauseProductSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  return decide({
    productId: parsed.data.productId,
    action: "staff_pause",
    reason: parsed.data.reason,
  })
}

/**
 * A five minute download link for one of a vendor's private files, plus the
 * audit row that records who took it.
 */
export async function getReviewFileDownloadUrlAction(input: unknown): Promise<ReviewFileUrlResult> {
  const guard = await requireActor("products:review")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(fileIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("product_files")
      .select("id, storage_key, original_name")
      .eq("id", parsed.data.fileId)
      .maybeSingle()

    if (error) {
      return failed(error)
    }

    const row = asRecord(data)

    if (row === null) {
      return failed("not_found")
    }

    const storageKey = readString(row, "storage_key")
    const originalName = readString(row, "original_name")

    if (storageKey === null || originalName === null) {
      return { ok: false, error: GENERIC_ERROR }
    }

    // The audit row is written before the link exists, so a link cannot be
    // handed out without a record of it.
    const audit = await getSupabaseAdminClient().rpc("log_product_file_admin_access", {
      p_actor: guard.actor.userId,
      p_file: parsed.data.fileId,
    })

    if (audit.error) {
      return failed(audit.error)
    }

    const url = await getR2Storage().presignGetUrl({
      key: storageKey,
      filename: originalName,
      expiresInSeconds: 300,
    })

    return { ok: true, url, expiresInSeconds: 300 }
  } catch (error) {
    logger.error("catalog_review_download_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}
