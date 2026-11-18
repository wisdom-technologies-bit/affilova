// What to say when an image upload fails, and a reference for support.
//
// A Cloudinary answer can carry hours of debugging and also a copy of the
// request, so its text is never shown. The stage says where the failure
// happened, the remote text (already cut down by the caller) only ever picks a
// sentence, and the code is the short word a person can quote to support.

export type ImageUploadStage = "network" | "http" | "response"

export type ImageUploadFailureInput = {
  stage: ImageUploadStage
  /** The HTTP status, when there was a response at all. */
  status?: number
  /** Cloudinary's own error message, used only to choose a sentence. */
  cloudinaryMessage?: string
}

export type ImageUploadFailure = {
  /** One sentence a person can act on. Never contains remote text. */
  message: string
  /** Short, stable, safe to show and to search for. */
  code: string
}

const NETWORK: ImageUploadFailure = {
  message: "Could not reach the image service. Check your connection and try again.",
  code: "network",
}

const SIGNATURE: ImageUploadFailure = {
  message: "Upload could not be authorised. Please contact support.",
  code: "signature",
}

const CONFIG: ImageUploadFailure = {
  message: "The image service is not configured correctly. Please contact support.",
  code: "config",
}

const FORMAT: ImageUploadFailure = {
  message: "Use a JPG, PNG or WebP image.",
  code: "format",
}

const SIZE: ImageUploadFailure = {
  message: "That image is too large. The limit is 5 MB.",
  code: "size",
}

const RESPONSE: ImageUploadFailure = {
  message: "The image service returned an unexpected answer. Try again.",
  code: "response",
}

/** The sentences an HTTP answer maps to, checked in this order. */
const HTTP_RULES: readonly { phrase: string; failure: ImageUploadFailure }[] = [
  { phrase: "invalid signature", failure: SIGNATURE },
  { phrase: "cloud_name", failure: CONFIG },
  { phrase: "invalid api_key", failure: CONFIG },
  { phrase: "must supply api_key", failure: CONFIG },
  { phrase: "format", failure: FORMAT },
  { phrase: "file size too large", failure: SIZE },
]

/**
 * Maps one failed upload to a sentence and a code.
 *
 * A missing status or message is not input to the mapping: the stage alone
 * decides. Matching ignores case, because Cloudinary is not consistent about
 * it, and an unrecognised answer becomes the generic rejection with its status
 * in it, so no wording from the service can reach the page.
 */
export function describeImageUploadFailure(input: ImageUploadFailureInput): ImageUploadFailure {
  if (input.stage === "network") {
    return NETWORK
  }

  if (input.stage === "response") {
    return RESPONSE
  }

  if (input.status === 413) {
    return SIZE
  }

  const text = (input.cloudinaryMessage ?? "").toLowerCase()

  for (const rule of HTTP_RULES) {
    if (text.includes(rule.phrase)) {
      return rule.failure
    }
  }

  return {
    message:
      input.status === undefined
        ? "The image service rejected the upload."
        : `The image service rejected the upload (code ${input.status}).`,
    code: "rejected",
  }
}
