// The image rules a browser can check before anything is uploaded.
//
// Type and size are read off the file itself, so a wrong file costs nothing.
// The pixel check needs a decode, which is slower, so it happens only after
// the cheap rules have passed. Nothing here talks to the server.

export const ALLOWED_IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"]

/** 5 MB, the same limit the server enforces. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** The shortest side a product image may have. */
export const MIN_IMAGE_EDGE = 400

/** iPhone HEIC and HEIF photos, which no browser can show or Cloudinary accept. */
const APPLE_IMAGE_TYPES: readonly string[] = ["image/heic", "image/heif"]

export type ImageFileProblem = {
  message: string
  code: "format" | "heic" | "size"
}

/**
 * The type and size rules, as a pure function.
 *
 * Called with the type and the byte count, so it can be read and tested
 * without a browser. A file that passes returns null.
 */
export function describeImageFileProblem(input: { type: string; size: number }): ImageFileProblem | null {
  const type = input.type.trim().toLowerCase()

  if (APPLE_IMAGE_TYPES.includes(type)) {
    return { message: "Convert iPhone photos to JPG first, then upload.", code: "heic" }
  }

  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return { message: "Use a JPG, PNG or WebP image.", code: "format" }
  }

  if (input.size > MAX_IMAGE_BYTES) {
    return { message: "That image is too large. The limit is 5 MB.", code: "size" }
  }

  return null
}

export type ImageSize = { width: number; height: number }

/** Where the decode gets its tools, injected so the fallback can be tested. */
export type ImageMeasureDeps = {
  /** createImageBitmap, when the browser has it. */
  createBitmap?: (file: Blob) => Promise<(ImageSize & { close?: () => void }) | null>
  createObjectUrl?: (file: Blob) => string
  revokeObjectUrl?: (url: string) => void
  /** An <img> decode from a URL, the fallback path. */
  loadImage?: (url: string) => Promise<ImageSize>
}

function isFiniteSize(value: unknown): value is ImageSize {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const { width, height } = value as { width?: unknown; height?: unknown }

  return (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  )
}

function closeBitmap(bitmap: { close?: () => void } | null): void {
  bitmap?.close?.()
}

/** The real browser tools, used when no dependencies are injected. */
export function browserImageDeps(): ImageMeasureDeps {
  const deps: ImageMeasureDeps = {}

  if (typeof createImageBitmap === "function") {
    deps.createBitmap = async (file) => {
      const bitmap = await createImageBitmap(file)

      return {
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    }
  }

  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    deps.createObjectUrl = (file) => URL.createObjectURL(file)
    deps.revokeObjectUrl = (url) => URL.revokeObjectURL(url)
  }

  if (typeof Image === "function") {
    deps.loadImage = (url) =>
      new Promise<ImageSize>((resolve, reject) => {
        const element = new Image()

        element.onload = () => resolve({ width: element.naturalWidth, height: element.naturalHeight })
        element.onerror = () => reject(new Error("image_decode_failed"))
        element.src = url
      })
  }

  return deps
}

/**
 * The pixel size of an image file, or null when it cannot be decoded.
 *
 * createImageBitmap first: it decodes off the main thread. Where it is missing
 * or refuses the file, an object URL and an <img> take over, and the URL is
 * always revoked so the file is not held in memory afterwards.
 */
export async function measureImageFile(
  file: Blob,
  deps: ImageMeasureDeps = browserImageDeps(),
): Promise<ImageSize | null> {
  if (deps.createBitmap !== undefined) {
    let bitmap: (ImageSize & { close?: () => void }) | null = null

    try {
      bitmap = await deps.createBitmap(file)

      if (bitmap !== null && isFiniteSize(bitmap)) {
        return { width: bitmap.width, height: bitmap.height }
      }
    } catch {
      // A browser that refuses this file here may still decode it in an <img>.
    } finally {
      // Released on every path: a decoded bitmap holds the whole image.
      closeBitmap(bitmap)
    }
  }

  if (deps.createObjectUrl === undefined || deps.loadImage === undefined) {
    return null
  }

  const url = deps.createObjectUrl(file)

  try {
    const size = await deps.loadImage(url)

    return isFiniteSize(size) ? size : null
  } catch {
    return null
  } finally {
    deps.revokeObjectUrl?.(url)
  }
}

export type PixelProblem = {
  message: string
  code: "unreadable" | "dimensions"
}

/**
 * The pixel rules: the file has to decode, and be at least 400 by 400.
 *
 * A file that cannot be decoded is reported separately from one that is simply
 * too small, because the two need different things from the person uploading.
 */
export function describeImagePixelProblem(size: ImageSize | null): PixelProblem | null {
  if (size === null) {
    return { message: "That file could not be read as an image. Try another one.", code: "unreadable" }
  }

  if (size.width < MIN_IMAGE_EDGE || size.height < MIN_IMAGE_EDGE) {
    return { message: "The image must be at least 400 x 400 pixels.", code: "dimensions" }
  }

  return null
}
