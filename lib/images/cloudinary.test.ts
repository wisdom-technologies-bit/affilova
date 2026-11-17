import { describe, expect, it, vi } from "vitest"

import {
  ALLOWED_FORMATS_PARAM,
  createCloudinaryImages,
  ImageRejectedError,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_DIMENSION,
} from "./cloudinary"

const SECRET = "cloudinary-secret"

function fakeImages(options: {
  asset?: { width?: number; height?: number; bytes?: number; format?: string } | null
  destroyError?: Error
} = {}) {
  const signCalls: { params: Record<string, string | number>; secret: string }[] = []
  const destroyed: string[] = []
  const fetched: string[] = []

  const images = createCloudinaryImages({
    cloudName: "affilova",
    apiKey: "api-key",
    apiSecret: SECRET,
    now: () => 1_700_000_000_000,
    sign: (params, secret) => {
      signCalls.push({ params, secret })

      return `signed-${Object.keys(params).length}`
    },
    fetchAsset: async (publicId) => {
      fetched.push(publicId)

      return options.asset ?? null
    },
    destroyAsset: async (publicId) => {
      if (options.destroyError) {
        throw options.destroyError
      }

      destroyed.push(publicId)
    },
  })

  return { images, signCalls, destroyed, fetched }
}

const GOOD_ASSET = { width: 1200, height: 800, bytes: 220_000, format: "jpg" }

describe("signImageUpload", () => {
  it("signs exactly the parameters the browser will send", () => {
    const { images, signCalls } = fakeImages()

    const signature = images.signImageUpload({ productId: "product-1" })

    expect(signature).toEqual({
      cloudName: "affilova",
      apiKey: "api-key",
      timestamp: 1_700_000_000,
      signature: "signed-3",
      folder: "products/product-1",
      allowedFormats: ALLOWED_FORMATS_PARAM,
    })

    expect(signCalls).toHaveLength(1)
    expect(signCalls[0]?.secret).toBe(SECRET)
    expect(signCalls[0]?.params).toEqual({
      timestamp: 1_700_000_000,
      folder: "products/product-1",
      allowed_formats: "jpg,jpeg,png,webp",
    })
  })

  it("only allows the four image formats", () => {
    expect(ALLOWED_FORMATS_PARAM).toBe("jpg,jpeg,png,webp")
  })

  it("puts the asset in a folder named after the product", () => {
    const { images } = fakeImages()

    expect(images.signImageUpload({ productId: "abc" }).folder).toBe("products/abc")
  })
})

describe("verifyUploadedImage", () => {
  it("returns the real metadata for a good image", async () => {
    const { images, destroyed } = fakeImages({ asset: GOOD_ASSET })

    await expect(images.verifyUploadedImage("products/p/one")).resolves.toEqual({
      width: 1200,
      height: 800,
      bytes: 220_000,
      format: "jpg",
    })

    expect(destroyed).toEqual([])
  })

  it("accepts a webp at exactly the limits", async () => {
    const { images } = fakeImages({
      asset: { width: MIN_IMAGE_DIMENSION, height: MIN_IMAGE_DIMENSION, bytes: MAX_IMAGE_BYTES, format: "webp" },
    })

    await expect(images.verifyUploadedImage("products/p/one")).resolves.toMatchObject({
      format: "webp",
    })
  })

  it("rejects and deletes an image that is too large", async () => {
    const { images, destroyed } = fakeImages({
      asset: { ...GOOD_ASSET, bytes: MAX_IMAGE_BYTES + 1 },
    })

    await expect(images.verifyUploadedImage("products/p/big")).rejects.toBeInstanceOf(
      ImageRejectedError,
    )
    expect(destroyed).toEqual(["products/p/big"])
  })

  it("rejects and deletes an image in the wrong format", async () => {
    const { images, destroyed } = fakeImages({
      asset: { ...GOOD_ASSET, format: "gif" },
    })

    await expect(images.verifyUploadedImage("products/p/anim")).rejects.toMatchObject({
      code: "image_format",
    })
    expect(destroyed).toEqual(["products/p/anim"])
  })

  it("rejects and deletes an image that is too small", async () => {
    const { images, destroyed } = fakeImages({
      asset: { ...GOOD_ASSET, width: MIN_IMAGE_DIMENSION - 1 },
    })

    await expect(images.verifyUploadedImage("products/p/tiny")).rejects.toMatchObject({
      code: "image_too_small",
    })
    expect(destroyed).toEqual(["products/p/tiny"])
  })

  it("rejects an asset that does not exist", async () => {
    const { images, destroyed } = fakeImages({ asset: null })

    await expect(images.verifyUploadedImage("products/p/missing")).rejects.toMatchObject({
      code: "image_missing",
    })
    expect(destroyed).toEqual([])
  })

  it("still rejects when the cleanup itself fails", async () => {
    const { images } = fakeImages({
      asset: { ...GOOD_ASSET, format: "gif" },
      destroyError: new Error("cloudinary is down"),
    })

    await expect(images.verifyUploadedImage("products/p/anim")).rejects.toMatchObject({
      code: "image_format",
    })
  })

  it("reads the format case-insensitively", async () => {
    const { images } = fakeImages({ asset: { ...GOOD_ASSET, format: "JPG" } })

    await expect(images.verifyUploadedImage("products/p/one")).resolves.toMatchObject({
      format: "jpg",
    })
  })
})

describe("deleteImage", () => {
  it("destroys the asset", async () => {
    const { images, destroyed } = fakeImages()

    await images.deleteImage("products/p/one")

    expect(destroyed).toEqual(["products/p/one"])
  })

  it("lets a failure surface, so the caller can log it", async () => {
    const { images } = fakeImages({ destroyError: new Error("nope") })

    await expect(images.deleteImage("products/p/one")).rejects.toThrow("nope")
  })
})

describe("dependency injection", () => {
  it("never touches the network by itself", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const { images } = fakeImages({ asset: GOOD_ASSET })

    images.signImageUpload({ productId: "p" })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
