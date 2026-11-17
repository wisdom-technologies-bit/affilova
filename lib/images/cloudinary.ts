import "server-only"

import { v2 as cloudinary } from "cloudinary"

import { getCloudinaryEnv } from "@/lib/env"

// Product images. The browser uploads straight to Cloudinary with a signature
// made here; the server never touches the bytes. Everything the server relies on
// (size, format, dimensions) is read back through the Admin API, because a
// client can claim anything in the upload form.

/** The largest image that may be attached to a product. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** The shortest side an image may have. */
export const MIN_IMAGE_DIMENSION = 400

const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp"] as const

/** The exact string that is signed and sent as `allowed_formats`. */
export const ALLOWED_FORMATS_PARAM = ALLOWED_FORMATS.join(",")

export type ImageRejectionCode =
  | "image_missing"
  | "image_too_large"
  | "image_format"
  | "image_too_small"

export class ImageRejectedError extends Error {
  readonly code: ImageRejectionCode

  constructor(code: ImageRejectionCode) {
    super(code)
    this.name = "ImageRejectedError"
    this.code = code
  }
}

export interface ImageUploadSignature {
  cloudName: string
  apiKey: string
  timestamp: number
  signature: string
  folder: string
  allowedFormats: string
}

export interface UploadedImage {
  width: number
  height: number
  bytes: number
  format: string
}

export interface CloudinaryAsset {
  width?: number
  height?: number
  bytes?: number
  format?: string
}

export interface CloudinaryImagesDependencies {
  cloudName: string
  apiKey: string
  apiSecret: string
  /** Cloudinary's signing helper: api_sign_request(params, secret). */
  sign: (params: Record<string, string | number>, secret: string) => string
  /** Admin API lookup for one public id. */
  fetchAsset: (publicId: string) => Promise<CloudinaryAsset | null>
  /** Admin API destroy. */
  destroyAsset: (publicId: string) => Promise<void>
  /** Injectable clock, so a test can pin the timestamp. */
  now?: () => number
}

export interface CloudinaryImages {
  signImageUpload: (input: { productId: string }) => ImageUploadSignature
  verifyUploadedImage: (publicId: string) => Promise<UploadedImage>
  /** Remove an asset the product no longer references. */
  deleteImage: (publicId: string) => Promise<void>
}

export function createCloudinaryImages(deps: CloudinaryImagesDependencies): CloudinaryImages {
  const { cloudName, apiKey, apiSecret, sign, fetchAsset, destroyAsset } = deps
  const now = deps.now ?? (() => Date.now())

  return {
    signImageUpload: ({ productId }) => {
      const timestamp = Math.floor(now() / 1000)
      const folder = `products/${productId}`

      // The signature covers exactly the parameters the browser will send. Add a
      // parameter to the upload without adding it here and the upload fails,
      // which is the point.
      const signature = sign(
        { timestamp, folder, allowed_formats: ALLOWED_FORMATS_PARAM },
        apiSecret,
      )

      return {
        cloudName,
        apiKey,
        timestamp,
        signature,
        folder,
        allowedFormats: ALLOWED_FORMATS_PARAM,
      }
    },

    verifyUploadedImage: async (publicId) => {
      const asset = await fetchAsset(publicId)

      if (!asset || typeof asset.width !== "number" || typeof asset.height !== "number") {
        throw new ImageRejectedError("image_missing")
      }

      const format = typeof asset.format === "string" ? asset.format.toLowerCase() : ""
      const bytes = typeof asset.bytes === "number" ? asset.bytes : 0

      const reject = async (code: ImageRejectionCode): Promise<never> => {
        // A rejected image is removed: leaving it in the account would keep an
        // unusable asset around and let the same id be retried forever.
        try {
          await destroyAsset(publicId)
        } catch {
          // A failed cleanup must not change the answer to the person.
        }

        throw new ImageRejectedError(code)
      }

      if (!(ALLOWED_FORMATS as readonly string[]).includes(format)) {
        return reject("image_format")
      }

      if (bytes > MAX_IMAGE_BYTES) {
        return reject("image_too_large")
      }

      if (asset.width < MIN_IMAGE_DIMENSION || asset.height < MIN_IMAGE_DIMENSION) {
        return reject("image_too_small")
      }

      return { width: asset.width, height: asset.height, bytes, format }
    },

    deleteImage: async (publicId) => {
      await destroyAsset(publicId)
    },
  }
}

let images: CloudinaryImages | undefined

/** The real Cloudinary integration, built from the environment on first use. */
export function getCloudinaryImages(): CloudinaryImages {
  if (images) {
    return images
  }

  const env = getCloudinaryEnv()

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  })

  images = createCloudinaryImages({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    sign: (params, secret) => cloudinary.utils.api_sign_request(params, secret),
    fetchAsset: async (publicId) => {
      try {
        const asset = await cloudinary.api.resource(publicId, { resource_type: "image" })

        return {
          width: typeof asset.width === "number" ? asset.width : undefined,
          height: typeof asset.height === "number" ? asset.height : undefined,
          bytes: typeof asset.bytes === "number" ? asset.bytes : undefined,
          format: typeof asset.format === "string" ? asset.format : undefined,
        }
      } catch {
        // A missing asset is a rejection, not a crash.
        return null
      }
    },
    destroyAsset: async (publicId) => {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" })
    },
  })

  return images
}
