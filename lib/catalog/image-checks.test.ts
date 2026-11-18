import { describe, expect, it, vi } from "vitest"

import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_EDGE,
  describeImageFileProblem,
  describeImagePixelProblem,
  measureImageFile,
  type ImageMeasureDeps,
} from "./image-checks"

describe("the constants are the ones the server uses", () => {
  it("allows three image types", () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"])
  })

  it("allows 5 MB and needs a 400 pixel edge", () => {
    expect(MAX_IMAGE_BYTES).toBe(5242880)
    expect(MIN_IMAGE_EDGE).toBe(400)
  })
})

describe("the file type rule", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    it(`accepts ${type}`, () => {
      expect(describeImageFileProblem({ type, size: 1024 })).toBeNull()
    })
  }

  it("accepts a type written in capitals", () => {
    expect(describeImageFileProblem({ type: "IMAGE/JPEG", size: 1024 })).toBeNull()
  })

  it("turns a HEIC photo into instructions", () => {
    expect(describeImageFileProblem({ type: "image/heic", size: 1024 })).toEqual({
      message: "Convert iPhone photos to JPG first, then upload.",
      code: "heic",
    })
  })

  it("treats HEIF the same way", () => {
    expect(describeImageFileProblem({ type: "image/heif", size: 1024 })?.code).toBe("heic")
  })

  it("refuses a GIF", () => {
    expect(describeImageFileProblem({ type: "image/gif", size: 1024 })).toEqual({
      message: "Use a JPG, PNG or WebP image.",
      code: "format",
    })
  })

  it("refuses a file the browser could not name", () => {
    expect(describeImageFileProblem({ type: "", size: 1024 })?.code).toBe("format")
  })

  it("refuses a PDF renamed to an image", () => {
    expect(describeImageFileProblem({ type: "application/pdf", size: 1024 })?.code).toBe("format")
  })
})

describe("the size rule", () => {
  it("accepts exactly 5 MB", () => {
    expect(describeImageFileProblem({ type: "image/png", size: MAX_IMAGE_BYTES })).toBeNull()
  })

  it("refuses 5 MB and one byte", () => {
    expect(describeImageFileProblem({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toEqual({
      message: "That image is too large. The limit is 5 MB.",
      code: "size",
    })
  })

  it("refuses an empty file on size only after the type passes", () => {
    // Zero bytes is not a size fault; the decode check is what catches it.
    expect(describeImageFileProblem({ type: "image/png", size: 0 })).toBeNull()
  })

  it("names the type before the size when both are wrong", () => {
    expect(describeImageFileProblem({ type: "image/gif", size: MAX_IMAGE_BYTES + 1 })?.code).toBe("format")
  })
})

describe("measuring an image", () => {
  it("uses createImageBitmap when it is there, and closes the bitmap", async () => {
    const close = vi.fn()
    const deps: ImageMeasureDeps = {
      createBitmap: async () => ({ width: 800, height: 600, close }),
      createObjectUrl: () => {
        throw new Error("the fallback should not run")
      },
      loadImage: async () => {
        throw new Error("the fallback should not run")
      },
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toEqual({ width: 800, height: 600 })
    expect(close).toHaveBeenCalledOnce()
  })

  it("falls back to an img element when the bitmap decode throws, and revokes the URL", async () => {
    const revokeObjectUrl = vi.fn()
    const deps: ImageMeasureDeps = {
      createBitmap: async () => {
        throw new Error("bitmap decode failed")
      },
      createObjectUrl: () => "blob:test-1",
      revokeObjectUrl,
      loadImage: async (url) => {
        expect(url).toBe("blob:test-1")

        return { width: 1024, height: 768 }
      },
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toEqual({ width: 1024, height: 768 })
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test-1")
  })

  it("falls back when createImageBitmap is missing entirely", async () => {
    const deps: ImageMeasureDeps = {
      createObjectUrl: () => "blob:test-2",
      revokeObjectUrl: () => {},
      loadImage: async () => ({ width: 640, height: 480 }),
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toEqual({ width: 640, height: 480 })
  })

  it("falls back when the bitmap comes back with no size", async () => {
    const deps: ImageMeasureDeps = {
      createBitmap: async () => null,
      createObjectUrl: () => "blob:test-3",
      revokeObjectUrl: () => {},
      loadImage: async () => ({ width: 400, height: 400 }),
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toEqual({ width: 400, height: 400 })
  })

  it("answers null when the image will not decode, and still revokes the URL", async () => {
    const revokeObjectUrl = vi.fn()
    const deps: ImageMeasureDeps = {
      createObjectUrl: () => "blob:test-4",
      revokeObjectUrl,
      loadImage: async () => {
        throw new Error("image_decode_failed")
      },
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledOnce()
  })

  it("answers null when there is no way to decode at all", async () => {
    await expect(measureImageFile(new Blob(), {})).resolves.toBeNull()
  })

  it("ignores a bitmap that reports a zero width", async () => {
    const deps: ImageMeasureDeps = {
      createBitmap: async () => ({ width: 0, height: 0 }),
      createObjectUrl: () => "blob:test-5",
      revokeObjectUrl: () => {},
      loadImage: async () => ({ width: 500, height: 500 }),
    }

    await expect(measureImageFile(new Blob(), deps)).resolves.toEqual({ width: 500, height: 500 })
  })
})

describe("the pixel rule", () => {
  it("accepts exactly 400 by 400", () => {
    expect(describeImagePixelProblem({ width: 400, height: 400 })).toBeNull()
  })

  it("accepts a long thin image that is still 400 on both sides", () => {
    expect(describeImagePixelProblem({ width: 1600, height: 400 })).toBeNull()
  })

  it("refuses 399 pixels on the short side", () => {
    expect(describeImagePixelProblem({ width: 800, height: 399 })).toEqual({
      message: "The image must be at least 400 x 400 pixels.",
      code: "dimensions",
    })
  })

  it("says plainly when the file could not be read", () => {
    expect(describeImagePixelProblem(null)).toEqual({
      message: "That file could not be read as an image. Try another one.",
      code: "unreadable",
    })
  })
})
