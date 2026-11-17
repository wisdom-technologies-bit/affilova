"use server"

import { randomUUID } from "node:crypto"

import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { getCloudinaryImages, ImageRejectedError } from "@/lib/images/cloudinary"
import { getR2Storage } from "@/lib/storage/r2"

import type {
  AbortFileUploadResult,
  ConfirmFileUploadResult,
  CreateProductDraftResult,
  DeleteFileResult,
  GetProductForEditResult,
  ImageSignatureResult,
  ListVendorProductsResult,
  PartUrlsResult,
  ProductDetail,
  ProductFile,
  ProductImage,
  ProductSummary,
  RegisterImageResult,
  RemoveImageResult,
  SetCoverImageResult,
  StartFileUploadResult,
  TransitionProductResult,
  UpdateProductResult,
} from "@/lib/catalog/action-types"
import { decodeCursor, encodeCursor } from "@/lib/catalog/cursor"
import { actionFailure, catalogErrorMessage, GENERIC_ERROR } from "@/lib/catalog/errors"
import { toSqlProductFields } from "@/lib/catalog/fields"
import {
  buildStorageKey,
  MULTIPART_THRESHOLD_BYTES,
  PART_SIZE_BYTES,
  validateUpload,
} from "@/lib/catalog/files"
import {
  type GuardedActor,
  parseInput,
  requireActor,
  withinBudget,
} from "@/lib/catalog/guard"
import {
  asRecord,
  readString,
  toProductDetail,
  toProductFile,
  toProductImage,
  toProductReadiness,
  toProductSummary,
} from "@/lib/catalog/rows"
import {
  completeMultipartSchema,
  createProductDraftSchema,
  fileIdSchema,
  getPartUrlsSchema,
  imageIdSchema,
  listVendorProductsSchema,
  productIdSchema,
  productStatusSchema,
  registerImageSchema,
  signImageUploadSchema,
  startFileUploadSchema,
  transitionProductSchema,
  updateProductSchema,
} from "@/lib/catalog/schemas"

// Every action here follows the same order:
//
//   1. who is calling (from the session, never from the input)
//   2. may they (area:merchant)
//   3. is the input well formed
//   4. have they used up their allowance
//   5. the database, through a function, with p_actor set to the real user
//
// Nothing throws to the client: each action answers { ok: true, ... } or
// { ok: false, error } with a sentence that never carries database text.

const FILE_COLUMNS =
  "id, original_name, content_type, size_bytes, status, scan_status, created_at, storage_key, multipart_upload_id"
const IMAGE_COLUMNS = "id, cloudinary_public_id, alt_text, width, height, sort, is_cover"
const PRODUCT_COLUMNS =
  "id, title, slug, short_description, description, price_kobo, compare_at_price_kobo, currency, commission_bps, affiliate_approval, refund_window_hours, max_downloads, status, reject_reason, submitted_at, published_at, updated_at, category_id"

type OwnedProduct = { id: string; status: string }

function failed(error: unknown): { ok: false; error: string } {
  return actionFailure(error)
}

/** The product, if it belongs to this vendor. */
async function loadOwnedProduct(
  productId: string,
  actor: GuardedActor,
): Promise<{ ok: true; product: OwnedProduct } | { ok: false; error: string }> {
  const { data, error } = await getSupabaseAdminClient()
    .from("products")
    .select("id, vendor_id, status")
    .eq("id", productId)
    .maybeSingle()

  if (error) {
    return failed(error)
  }

  const row = asRecord(data)

  if (row === null) {
    return failed("not_found")
  }

  if (readString(row, "vendor_id") !== actor.userId) {
    // Another vendor's product is reported as "no access", never as "not found",
    // because its existence is not this caller's business either way.
    return failed("forbidden")
  }

  return {
    ok: true,
    product: { id: productId, status: readString(row, "status") ?? "" },
  }
}

type FileRow = {
  id: string
  productId: string
  storageKey: string
  originalName: string
  contentType: string
  sizeBytes: number
  status: string
  multipartUploadId: string | null
}

/** The file row, if the product it belongs to belongs to this vendor. */
async function loadOwnedFile(
  fileId: string,
  actor: GuardedActor,
): Promise<{ ok: true; file: FileRow } | { ok: false; error: string }> {
  const { data, error } = await getSupabaseAdminClient()
    .from("product_files")
    .select(`${FILE_COLUMNS}, product_id`)
    .eq("id", fileId)
    .maybeSingle()

  if (error) {
    return failed(error)
  }

  const row = asRecord(data)

  if (row === null) {
    return failed("not_found")
  }

  const productId = readString(row, "product_id")
  const storageKey = readString(row, "storage_key")
  const originalName = readString(row, "original_name")
  const contentType = readString(row, "content_type")
  const status = readString(row, "status")
  const sizeBytes = row.size_bytes

  if (
    productId === null ||
    storageKey === null ||
    originalName === null ||
    contentType === null ||
    status === null ||
    typeof sizeBytes !== "number"
  ) {
    return { ok: false, error: GENERIC_ERROR }
  }

  const product = await loadOwnedProduct(productId, actor)

  if (!product.ok) {
    return product
  }

  const uploadId = readString(row, "multipart_upload_id")

  return {
    ok: true,
    file: {
      id: fileId,
      productId,
      storageKey,
      originalName,
      contentType,
      sizeBytes,
      status,
      multipartUploadId: uploadId === "" ? null : uploadId,
    },
  }
}

/**
 * The one place an upload becomes "uploaded": look at the object that actually
 * arrived, compare its size with the reservation, then confirm.
 *
 * A mismatch deletes the object and the row, so a failed attempt leaves nothing
 * behind and the vendor can simply try again.
 */
async function confirmUploadedObject(
  file: FileRow,
  actor: GuardedActor,
): Promise<ConfirmFileUploadResult> {
  const storage = getR2Storage()

  let head: { sizeBytes: number } | null

  try {
    head = await storage.headObject(file.storageKey)
  } catch (error) {
    logger.error("catalog_upload_head_failed", { reason: error })
    return failed("storage_failed")
  }

  if (head === null) {
    await getSupabaseAdminClient().rpc("purge_pending_file", { p_id: file.id })

    return failed("upload_missing")
  }

  if (head.sizeBytes !== file.sizeBytes) {
    try {
      await storage.deleteObject(file.storageKey)
    } catch (error) {
      logger.error("catalog_upload_cleanup_failed", { reason: error })
    }

    await getSupabaseAdminClient().rpc("purge_pending_file", { p_id: file.id })

    return failed("size_mismatch")
  }

  const { error } = await getSupabaseAdminClient().rpc("confirm_product_file", {
    p_actor: actor.userId,
    p_file: file.id,
    p_actual_size: head.sizeBytes,
  })

  if (error) {
    return failed(error)
  }

  return { ok: true, fileId: file.id }
}

// ---------------------------------------------------------------------------
// Drafts and edits
// ---------------------------------------------------------------------------

export async function createProductDraftAction(input: unknown): Promise<CreateProductDraftResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(createProductDraftSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("draft", guard.actor.userId))) {
    return failed("rate_limited")
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("create_product_draft", {
      p_actor: guard.actor.userId,
      p_fields: toSqlProductFields(parsed.data.fields),
    })

    if (error) {
      return failed(error)
    }

    if (typeof data !== "string") {
      return { ok: false, error: GENERIC_ERROR }
    }

    return { ok: true, productId: data }
  } catch (error) {
    logger.error("catalog_create_draft_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function updateProductAction(input: unknown): Promise<UpdateProductResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(updateProductSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("update_product", {
      p_actor: guard.actor.userId,
      p_product: parsed.data.productId,
      p_fields: toSqlProductFields(parsed.data.fields),
    })

    if (error) {
      return failed(error)
    }

    return { ok: true }
  } catch (error) {
    logger.error("catalog_update_product_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

/** submit, withdraw, pause, resume and archive. Review decisions live in admin.ts. */
export async function transitionProductAction(input: unknown): Promise<TransitionProductResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(transitionProductSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("product_transition", {
      p_actor: guard.actor.userId,
      p_product: parsed.data.productId,
      p_action: parsed.data.action,
      p_reason: null,
    })

    if (error) {
      return failed(error)
    }

    if (typeof data !== "string") {
      return { ok: false, error: GENERIC_ERROR }
    }

    const status = productStatusSchema.safeParse(data)

    if (!status.success) {
      return { ok: false, error: GENERIC_ERROR }
    }

    return { ok: true, status: status.data }
  } catch (error) {
    logger.error("catalog_transition_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function listVendorProductsAction(input: unknown): Promise<ListVendorProductsResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(listVendorProductsSchema, input ?? {})

  if (!parsed.ok) {
    return parsed
  }

  const limit = parsed.data.limit ?? 20
  const cursor = decodeCursor(parsed.data.cursor)

  try {
    let query = getSupabaseAdminClient()
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("vendor_id", guard.actor.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1)

    if (parsed.data.status !== undefined) {
      query = query.eq("status", parsed.data.status)
    }

    if (cursor !== null) {
      // Keyset pagination on (created_at, id): a page never shifts when a product
      // is created while somebody is scrolling.
      query = query.or(
        `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`,
      )
    }

    const { data, error } = await query

    if (error) {
      return failed(error)
    }

    const rows = Array.isArray(data) ? data : []
    const items: ProductSummary[] = []

    for (const row of rows) {
      const record = asRecord(row)
      const summary = record === null ? null : toProductSummary(record)

      if (summary !== null) {
        items.push(summary)
      }
    }

    const page = items.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor =
      items.length > limit && last !== undefined
        ? encodeCursor({ at: last.createdAt, id: last.id })
        : null

    return { ok: true, items: page, nextCursor }
  } catch (error) {
    logger.error("catalog_list_products_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function getProductForEditAction(input: unknown): Promise<GetProductForEditResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(productIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const owned = await loadOwnedProduct(parsed.data.productId, guard.actor)

  if (!owned.ok) {
    return owned
  }

  try {
    const supabase = getSupabaseAdminClient()

    const [productResult, filesResult, imagesResult, readinessResult] = await Promise.all([
      supabase.from("products").select(PRODUCT_COLUMNS).eq("id", parsed.data.productId).maybeSingle(),
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

    if (product === null) {
      return failed("not_found")
    }

    const files: ProductFile[] = []
    const fileRows = Array.isArray(filesResult.data) ? filesResult.data : []

    for (const row of fileRows) {
      const record = asRecord(row)
      const file = record === null ? null : toProductFile(record)

      if (file !== null) {
        files.push(file)
      }
    }

    const images: ProductImage[] = []
    const imageRows = Array.isArray(imagesResult.data) ? imagesResult.data : []

    for (const row of imageRows) {
      const record = asRecord(row)
      const image = record === null ? null : toProductImage(record)

      if (image !== null) {
        images.push(image)
      }
    }

    return {
      ok: true,
      product,
      files,
      images,
      readiness: toProductReadiness(readinessResult.error ? null : readinessResult.data),
    }
  } catch (error) {
    logger.error("catalog_get_product_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function startFileUploadAction(input: unknown): Promise<StartFileUploadResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(startFileUploadSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("fileUpload", guard.actor.userId))) {
    return failed("rate_limited")
  }

  const owned = await loadOwnedProduct(parsed.data.productId, guard.actor)

  if (!owned.ok) {
    return owned
  }

  if (owned.product.status === "archived") {
    return failed("bad_state")
  }

  const validation = validateUpload({
    filename: parsed.data.filename,
    sizeBytes: parsed.data.sizeBytes,
  })

  if (!validation.ok) {
    return failed(validation.code)
  }

  const fileId = randomUUID()
  const key = buildStorageKey(owned.product.id, fileId, validation.sanitizedName)
  const multipart = parsed.data.sizeBytes > MULTIPART_THRESHOLD_BYTES
  const storage = getR2Storage()

  let uploadId: string | null = null

  try {
    if (multipart) {
      uploadId = await storage.createMultipartUpload({ key, contentType: validation.contentType })
    }

    const { error } = await getSupabaseAdminClient().rpc("register_product_file", {
      p_actor: guard.actor.userId,
      p_product: owned.product.id,
      p_file_id: fileId,
      p_storage_key: key,
      p_original_name: validation.sanitizedName,
      p_content_type: validation.contentType,
      p_size_bytes: parsed.data.sizeBytes,
      p_multipart_upload_id: uploadId,
    })

    if (error) {
      // Nothing was reserved, so the multipart upload must not be left open.
      if (uploadId !== null) {
        await storage.abortMultipartUpload({ key, uploadId }).catch(() => undefined)
      }

      return failed(error)
    }

    if (!multipart) {
      const url = await storage.presignPutUrl({
        key,
        contentType: validation.contentType,
        sizeBytes: parsed.data.sizeBytes,
      })

      return {
        ok: true,
        fileId,
        key,
        contentType: validation.contentType,
        plan: { kind: "single", method: "PUT", url, expiresInSeconds: 900 },
      }
    }

    const partCount = Math.ceil(parsed.data.sizeBytes / PART_SIZE_BYTES)
    const parts: { partNumber: number; url: string }[] = []

    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const url = await storage.presignPartUrl({
        key,
        uploadId: uploadId as string,
        partNumber,
      })

      parts.push({ partNumber, url })
    }

    return {
      ok: true,
      fileId,
      key,
      contentType: validation.contentType,
      plan: {
        kind: "multipart",
        uploadId: uploadId as string,
        partSizeBytes: PART_SIZE_BYTES,
        expiresInSeconds: 3600,
        parts,
      },
    }
  } catch (error) {
    logger.error("catalog_start_upload_failed", { reason: error })

    if (uploadId !== null) {
      await storage.abortMultipartUpload({ key, uploadId }).catch(() => undefined)
    }

    return failed("storage_failed")
  }
}

/** Fresh URLs for parts that expired, or that failed to upload. */
export async function getPartUrlsAction(input: unknown): Promise<PartUrlsResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(getPartUrlsSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const loaded = await loadOwnedFile(parsed.data.fileId, guard.actor)

  if (!loaded.ok) {
    return loaded
  }

  if (loaded.file.multipartUploadId === null) {
    return failed("bad_state")
  }

  if (loaded.file.status !== "pending") {
    return failed("bad_state")
  }

  try {
    const storage = getR2Storage()
    const parts: { partNumber: number; url: string }[] = []

    for (const partNumber of parsed.data.partNumbers) {
      const url = await storage.presignPartUrl({
        key: loaded.file.storageKey,
        uploadId: loaded.file.multipartUploadId,
        partNumber,
      })

      parts.push({ partNumber, url })
    }

    return { ok: true, parts }
  } catch (error) {
    logger.error("catalog_part_urls_failed", { reason: error })

    return failed("storage_failed")
  }
}

export async function completeMultipartAction(input: unknown): Promise<ConfirmFileUploadResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(completeMultipartSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const loaded = await loadOwnedFile(parsed.data.fileId, guard.actor)

  if (!loaded.ok) {
    return loaded
  }

  if (loaded.file.multipartUploadId === null) {
    return failed("bad_state")
  }

  try {
    await getR2Storage().completeMultipartUpload({
      key: loaded.file.storageKey,
      uploadId: loaded.file.multipartUploadId,
      parts: parsed.data.parts,
    })
  } catch (error) {
    logger.error("catalog_complete_multipart_failed", { reason: error })

    return failed("storage_failed")
  }

  return confirmUploadedObject(loaded.file, guard.actor)
}

export async function confirmFileUploadAction(input: unknown): Promise<ConfirmFileUploadResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(fileIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const loaded = await loadOwnedFile(parsed.data.fileId, guard.actor)

  if (!loaded.ok) {
    return loaded
  }

  if (loaded.file.status === "uploaded") {
    // A retried confirmation is not an error.
    return { ok: true, fileId: loaded.file.id }
  }

  return confirmUploadedObject(loaded.file, guard.actor)
}

export async function abortFileUploadAction(input: unknown): Promise<AbortFileUploadResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(fileIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const loaded = await loadOwnedFile(parsed.data.fileId, guard.actor)

  if (!loaded.ok) {
    return loaded
  }

  if (loaded.file.status === "uploaded") {
    return failed("bad_state")
  }

  if (loaded.file.multipartUploadId !== null) {
    try {
      await getR2Storage().abortMultipartUpload({
        key: loaded.file.storageKey,
        uploadId: loaded.file.multipartUploadId,
      })
    } catch (error) {
      // An upload that cannot be aborted is still removed from the product; the
      // storage cleanup sweep will clear the parts later.
      logger.error("catalog_abort_multipart_failed", { reason: error })
    }
  }

  const { error } = await getSupabaseAdminClient().rpc("purge_pending_file", {
    p_id: loaded.file.id,
  })

  if (error) {
    return failed(error)
  }

  return { ok: true }
}

export async function deleteFileAction(input: unknown): Promise<DeleteFileResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(fileIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("delete_product_file", {
      p_actor: guard.actor.userId,
      p_file: parsed.data.fileId,
    })

    if (error) {
      return failed(error)
    }

    if (typeof data === "string" && data !== "") {
      // The row is gone; the object goes second. A failure here leaves an
      // orphaned object, which is harmless, rather than a row pointing at
      // nothing.
      await getR2Storage()
        .deleteObject(data)
        .catch((error: unknown) => logger.error("catalog_file_delete_failed", { reason: error }))
    }

    return { ok: true }
  } catch (error) {
    logger.error("catalog_delete_file_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function signImageUploadAction(input: unknown): Promise<ImageSignatureResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(signImageUploadSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  if (!(await withinBudget("imageSign", guard.actor.userId))) {
    return failed("rate_limited")
  }

  const owned = await loadOwnedProduct(parsed.data.productId, guard.actor)

  if (!owned.ok) {
    return owned
  }

  if (owned.product.status === "archived") {
    return failed("bad_state")
  }

  try {
    const signature = getCloudinaryImages().signImageUpload({ productId: owned.product.id })

    return {
      ok: true,
      cloudName: signature.cloudName,
      apiKey: signature.apiKey,
      timestamp: signature.timestamp,
      signature: signature.signature,
      folder: signature.folder,
      allowedFormats: signature.allowedFormats,
    }
  } catch (error) {
    logger.error("catalog_image_sign_failed", { reason: error })

    return failed("image_upload_failed")
  }
}

export async function registerImageAction(input: unknown): Promise<RegisterImageResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(registerImageSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  const owned = await loadOwnedProduct(parsed.data.productId, guard.actor)

  if (!owned.ok) {
    return owned
  }

  if (owned.product.status === "archived") {
    return failed("bad_state")
  }

  if (!parsed.data.publicId.startsWith(`products/${owned.product.id}/`)) {
    return failed("key_mismatch")
  }

  try {
    const verified = await getCloudinaryImages().verifyUploadedImage(parsed.data.publicId)

    const { data, error } = await getSupabaseAdminClient().rpc("add_product_image", {
      p_actor: guard.actor.userId,
      p_product: owned.product.id,
      p_public_id: parsed.data.publicId,
      p_alt: parsed.data.alt ?? null,
      p_width: verified.width,
      p_height: verified.height,
      p_bytes: verified.bytes,
      p_format: verified.format,
      p_make_cover: parsed.data.makeCover ?? false,
    })

    if (error) {
      return failed(error)
    }

    if (typeof data !== "string") {
      return { ok: false, error: GENERIC_ERROR }
    }

    return { ok: true, imageId: data }
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      return failed(error.code)
    }

    logger.error("catalog_register_image_failed", { reason: error })

    return failed("image_missing")
  }
}

export async function removeImageAction(input: unknown): Promise<RemoveImageResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(imageIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("remove_product_image", {
      p_actor: guard.actor.userId,
      p_image: parsed.data.imageId,
    })

    if (error) {
      return failed(error)
    }

    if (typeof data === "string" && data !== "") {
      // The row is gone first, then the asset. A failure here leaves an unused
      // image in the account, which is harmless and can be cleared by hand.
      await getCloudinaryImages()
        .deleteImage(data)
        .catch((error: unknown) => logger.error("catalog_image_delete_failed", { reason: error }))
    }

    return { ok: true }
  } catch (error) {
    logger.error("catalog_remove_image_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}

export async function setCoverImageAction(input: unknown): Promise<SetCoverImageResult> {
  const guard = await requireActor("area:merchant")

  if (!guard.ok) {
    return guard
  }

  const parsed = parseInput(imageIdSchema, input)

  if (!parsed.ok) {
    return parsed
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("set_cover_image", {
      p_actor: guard.actor.userId,
      p_image: parsed.data.imageId,
    })

    if (error) {
      return failed(error)
    }

    return { ok: true }
  } catch (error) {
    logger.error("catalog_set_cover_failed", { reason: error })

    return { ok: false, error: GENERIC_ERROR }
  }
}
