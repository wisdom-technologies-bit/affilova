import { describe, expect, it } from "vitest"

import { describeImageUploadFailure } from "./image-upload-errors"

describe("a failure with no connection", () => {
  it("says the service could not be reached", () => {
    expect(describeImageUploadFailure({ stage: "network" })).toEqual({
      message: "Could not reach the image service. Check your connection and try again.",
      code: "network",
    })
  })

  it("ignores a status and a message that came with it", () => {
    expect(
      describeImageUploadFailure({ stage: "network", status: 500, cloudinaryMessage: "Invalid Signature" }),
    ).toEqual({
      message: "Could not reach the image service. Check your connection and try again.",
      code: "network",
    })
  })
})

describe("a rejected signature", () => {
  it("asks the person to contact support", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 401, cloudinaryMessage: "Invalid Signature abc123" }),
    ).toEqual({
      message: "Upload could not be authorised. Please contact support.",
      code: "signature",
    })
  })

  it("matches whatever case Cloudinary used", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 401, cloudinaryMessage: "INVALID SIGNATURE" }).code,
    ).toBe("signature")
  })

  it("wins over a message that also mentions the format", () => {
    expect(
      describeImageUploadFailure({
        stage: "http",
        status: 401,
        cloudinaryMessage: "Invalid Signature: format is jpg",
      }).code,
    ).toBe("signature")
  })
})

describe("a misconfigured account", () => {
  it("names a missing cloud_name", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "cloud_name is disabled" }).code,
    ).toBe("config")
  })

  it("names an invalid api_key", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 401, cloudinaryMessage: "Invalid api_key 1234" }).code,
    ).toBe("config")
  })

  it("names a missing api_key", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "Must supply api_key" }).code,
    ).toBe("config")
  })

  it("uses the same sentence for every configuration fault", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "Must supply api_key" }).message,
    ).toBe("The image service is not configured correctly. Please contact support.")
  })
})

describe("a file the service will not take", () => {
  it("names the allowed formats", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "Unsupported image format gif" }),
    ).toEqual({ message: "Use a JPG, PNG or WebP image.", code: "format" })
  })

  it("reports the size limit from the message", () => {
    expect(
      describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "File size too large. Got 9 MB" }),
    ).toEqual({ message: "That image is too large. The limit is 5 MB.", code: "size" })
  })

  it("reports the size limit from a 413 even with no message", () => {
    expect(describeImageUploadFailure({ stage: "http", status: 413 })).toEqual({
      message: "That image is too large. The limit is 5 MB.",
      code: "size",
    })
  })
})

describe("anything else", () => {
  it("shows the status and nothing from the service", () => {
    const printed = describeImageUploadFailure({
      stage: "http",
      status: 502,
      cloudinaryMessage: "upstream timeout while reading request body for product 9f8",
    })

    expect(printed).toEqual({ message: "The image service rejected the upload (code 502).", code: "rejected" })
    expect(printed.message).not.toContain("upstream")
  })

  it("still answers when the status is missing", () => {
    expect(describeImageUploadFailure({ stage: "http" })).toEqual({
      message: "The image service rejected the upload.",
      code: "rejected",
    })
  })

  it("still answers when the message is missing", () => {
    expect(describeImageUploadFailure({ stage: "http", status: 400 }).code).toBe("rejected")
  })

  it("treats an empty message like no message", () => {
    expect(describeImageUploadFailure({ stage: "http", status: 400, cloudinaryMessage: "" }).code).toBe("rejected")
  })
})

describe("a 2xx answer with nothing usable in it", () => {
  it("says the answer was unexpected", () => {
    expect(describeImageUploadFailure({ stage: "response", status: 200 })).toEqual({
      message: "The image service returned an unexpected answer. Try again.",
      code: "response",
    })
  })

  it("ignores a message that arrived with it", () => {
    expect(describeImageUploadFailure({ stage: "response", cloudinaryMessage: "Invalid Signature" }).code).toBe(
      "response",
    )
  })
})

describe("every sentence is safe to show", () => {
  const inputs = [
    { stage: "network" as const },
    { stage: "http" as const, status: 400, cloudinaryMessage: "Invalid Signature" },
    { stage: "http" as const, status: 400, cloudinaryMessage: "Must supply api_key" },
    { stage: "http" as const, status: 400, cloudinaryMessage: "Unsupported format" },
    { stage: "http" as const, status: 413 },
    { stage: "http" as const, status: 500, cloudinaryMessage: "java.lang.NullPointerException" },
    { stage: "response" as const },
  ]

  it("never repeats remote text", () => {
    for (const input of inputs) {
      const printed = describeImageUploadFailure(input)

      expect(printed.message).not.toContain("Invalid Signature")
      expect(printed.message).not.toContain("java.lang")
      expect(printed.message.length).toBeLessThan(120)
      expect(printed.code).toMatch(/^[a-z]+$/)
    }
  })
})
