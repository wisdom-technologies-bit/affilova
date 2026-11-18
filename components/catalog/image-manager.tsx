"use client"

import * as Sentry from "@sentry/nextjs"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"

import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import { describedBy, FormField } from "@/components/forms/form-field"
import {
  registerImageAction,
  removeImageAction,
  setCoverImageAction,
  signImageUploadAction,
} from "@/lib/catalog/actions/vendor"
import type { ProductImage } from "@/lib/catalog/action-types"
import {
  describeImageFileProblem,
  describeImagePixelProblem,
  measureImageFile,
} from "@/lib/catalog/image-checks"
import { describeImageUploadFailure, type ImageUploadStage } from "@/lib/catalog/image-upload-errors"

// Product images. The browser uploads straight to Cloudinary with a signature
// the server made for this product, then tells the server which public id
// arrived; the server reads the real size and dimensions back from Cloudinary
// before it accepts the image.
//
// Every image needs a description before it can be added: it is the alt text,
// and an image without one is not finished.
//
// A failure says where it happened and carries a short reference, so a person
// can quote one word to support instead of a sentence that could mean six
// different things.

const MAX_IMAGES = 6
const MAX_ALT = 140

type Pending = {
  id: string
  publicId: string
  previewUrl: string
  alt: string
  saving: boolean
  /** What the server said when the image was registered: shown on this row. */
  rowError: string | null
}

/** The sentence on screen, and the word support can look up. */
type UploadError = {
  message: string
  reference: string | null
}

const MAX_REMOTE_MESSAGE = 200

/**
 * Cloudinary's own message, cut down and used only to choose a sentence.
 *
 * It is read defensively: the answer is JSON from another site, so its shape
 * is a claim, not a promise, and it is never put on the screen.
 */
function remoteMessage(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined
  }

  const error = (json as { error?: unknown }).error

  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const message = (error as { message?: unknown }).message

  return typeof message === "string" ? message.slice(0, MAX_REMOTE_MESSAGE) : undefined
}

/**
 * One failure, reported to Sentry without anything about the person or the
 * file: a stage, a code and the status. Without a DSN the SDK has no client
 * and every call here returns at once.
 */
function reportUploadFailure(input: { stage: ImageUploadStage; code: string; status?: number }): void {
  try {
    if (Sentry.getClient() === undefined) {
      return
    }

    Sentry.captureMessage("catalog_image_upload_failed", {
      level: "warning",
      tags: { image_upload_stage: input.stage, image_upload_code: input.code },
      ...(input.status === undefined ? {} : { extra: { httpStatus: input.status } }),
    })
  } catch {
    // Reporting must never be the thing that breaks the screen.
  }
}

function thumbnailUrl(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_400,h_300,f_auto,q_auto/${publicId}`
}

export function ImageManager({
  productId,
  cloudName,
  images,
  readOnlyReason,
}: {
  productId: string
  /** Read on the server from the server-only env and passed in. */
  cloudName: string | null
  images: readonly ProductImage[]
  readOnlyReason?: string
}) {
  const router = useRouter()
  const fileInputId = useId()

  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState<UploadError | null>(null)
  const [uploading, setUploading] = useState(false)

  const atLimit = images.length + pending.length >= MAX_IMAGES
  const disabled = readOnlyReason !== undefined || cloudName === null || atLimit

  async function accept(list: FileList | null): Promise<void> {
    if (list === null || list.length === 0 || cloudName === null) {
      return
    }

    setError(null)

    const room = MAX_IMAGES - images.length - pending.length
    const chosen = [...list].slice(0, Math.max(room, 0))

    if (chosen.length === 0) {
      setError({ message: `A product can have at most ${MAX_IMAGES} images.`, reference: null })

      return
    }

    setUploading(true)

    try {
      for (const file of chosen) {
        // The rules a browser can check on its own, before anything is asked
        // of the server or the network.
        const fileProblem = describeImageFileProblem({ type: file.type, size: file.size })

        if (fileProblem !== null) {
          setError({ message: fileProblem.message, reference: null })

          return
        }

        const size = await measureImageFile(file)
        const pixelProblem = describeImagePixelProblem(size)

        if (pixelProblem !== null) {
          setError({ message: pixelProblem.message, reference: null })

          return
        }

        const signature = await signImageUploadAction({ productId })

        if (!signature.ok) {
          setError({ message: signature.error, reference: null })

          return
        }

        const body = new FormData()
        body.set("file", file)
        body.set("api_key", signature.apiKey)
        body.set("timestamp", String(signature.timestamp))
        body.set("signature", signature.signature)
        body.set("folder", signature.folder)
        body.set("allowed_formats", signature.allowedFormats)

        let response: Response

        try {
          response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
            method: "POST",
            body,
          })
        } catch {
          // Thrown, so nothing came back at all: offline, a blocked request, or
          // an origin this deployment's CSP does not allow.
          const failure = describeImageUploadFailure({ stage: "network" })

          reportUploadFailure({ stage: "network", code: failure.code })
          setError({ message: failure.message, reference: failure.code })

          return
        }

        if (!response.ok) {
          // Another site wrote this body, so only its message is read, only to
          // choose a sentence, and only the first 200 characters of it.
          let cloudinaryMessage: string | undefined

          try {
            cloudinaryMessage = remoteMessage(await response.json())
          } catch {
            cloudinaryMessage = undefined
          }

          const failure = describeImageUploadFailure({
            stage: "http",
            status: response.status,
            cloudinaryMessage,
          })

          reportUploadFailure({ stage: "http", code: failure.code, status: response.status })
          setError({ message: failure.message, reference: failure.code })

          return
        }

        let json: unknown

        try {
          json = await response.json()
        } catch {
          const failure = describeImageUploadFailure({ stage: "response" })

          reportUploadFailure({ stage: "response", code: failure.code, status: response.status })
          setError({ message: failure.message, reference: failure.code })

          return
        }

        const publicId =
          typeof json === "object" && json !== null && typeof (json as { public_id?: unknown }).public_id === "string"
            ? (json as { public_id: string }).public_id
            : null

        if (publicId === null) {
          const failure = describeImageUploadFailure({ stage: "response" })

          reportUploadFailure({ stage: "response", code: failure.code, status: response.status })
          setError({ message: failure.message, reference: failure.code })

          return
        }

        setPending((current) => [
          ...current,
          {
            id: `${Date.now()}-${publicId}`,
            publicId,
            previewUrl: thumbnailUrl(signature.cloudName, publicId),
            alt: "",
            saving: false,
            rowError: null,
          },
        ])
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      {error === null ? null : (
        <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2">
          <p className="text-sm font-medium text-destructive">{error.message}</p>
          {error.reference === null ? null : (
            <p className="mt-1 text-xs text-muted-foreground">Reference: {error.reference}</p>
          )}
        </div>
      )}

      {readOnlyReason === undefined ? null : (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">{readOnlyReason}</p>
      )}

      {cloudName === null ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
          Image uploads are not configured on this deployment yet.
        </p>
      ) : (
        <div>
          <label
            htmlFor={fileInputId}
            className={`inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-600 focus-within:ring-offset-2 ${
              disabled ? "opacity-50" : "cursor-pointer hover:bg-accent"
            }`}
          >
            {uploading ? "Uploading…" : "Add image"}
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files
              event.target.value = ""
              void accept(chosen)
            }}
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Up to {MAX_IMAGES} images. JPG, PNG or WebP, at least 400 by 400 pixels and no more than 5 MB.
          </p>
        </div>
      )}

      {pending.length === 0 ? null : (
        <ul className="space-y-4">
          {pending.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap gap-4">
                {/* A Cloudinary URL for an image that is not attached yet. */}
                <img
                  src={item.previewUrl}
                  alt={item.alt === "" ? "Preview of the image you selected" : item.alt}
                  width={160}
                  height={120}
                  className="h-[120px] w-40 rounded-md border border-border object-cover"
                />

                <div className="min-w-[16rem] flex-1">
                  <FormField
                    id={`alt-${item.id}`}
                    label="Image description"
                    required
                    hint={`${item.alt.trim().length} of ${MAX_ALT} characters. Read out to people who cannot see the image.`}
                  >
                    <input
                      id={`alt-${item.id}`}
                      type="text"
                      value={item.alt}
                      maxLength={MAX_ALT}
                      onChange={(event) =>
                        setPending((current) =>
                          current.map((entry) =>
                            entry.id === item.id ? { ...entry, alt: event.target.value } : entry,
                          ),
                        )
                      }
                      aria-describedby={describedBy(`alt-${item.id}`)}
                      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    />
                  </FormField>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={item.saving || item.alt.trim() === ""}
                      onClick={() => {
                        void (async () => {
                          setPending((current) =>
                            current.map((entry) => (entry.id === item.id ? { ...entry, saving: true } : entry)),
                          )

                          const result = await registerImageAction({
                            productId,
                            publicId: item.publicId,
                            alt: item.alt.trim(),
                            makeCover: images.length === 0 && pending.length === 1,
                          })

                          if (!result.ok) {
                            setPending((current) =>
                              current.map((entry) =>
                                entry.id === item.id ? { ...entry, saving: false, rowError: result.error } : entry,
                              ),
                            )

                            return
                          }

                          setPending((current) => current.filter((entry) => entry.id !== item.id))
                          router.refresh()
                        })()
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      {item.saving ? "Adding…" : "Add this image"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}
                      className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      Discard
                    </button>
                  </div>

                  {item.rowError === null ? null : (
                    <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                      {item.rowError}
                    </p>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    Not attached to the product until you add it.
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No images yet. A product needs a cover image before it can be submitted.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {images.map((image) => (
            <li key={image.id} className="rounded-md border border-border p-3">
              {cloudName === null ? null : (
                // A Cloudinary URL, already cropped by its own transformation.
                <img
                  src={thumbnailUrl(cloudName, image.publicId)}
                  alt={image.alt ?? "Product image without a description"}
                  width={400}
                  height={300}
                  className="h-[150px] w-full rounded-md border border-border object-cover"
                />
              )}

              <div className="mt-2 flex items-start justify-between gap-2">
                <p className="text-sm text-brand-ink">{image.alt ?? "No description"}</p>
                {image.isCover ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-brand-600 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
                    Cover
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {image.isCover ? null : (
                  <button
                    type="button"
                    disabled={readOnlyReason !== undefined}
                    onClick={() => {
                      void (async () => {
                        const result = await setCoverImageAction({ imageId: image.id })

                        if (!result.ok) {
                          setError({ message: result.error, reference: null })

                          return
                        }

                        router.refresh()
                      })()
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    Make cover
                  </button>
                )}

                <ConfirmDialog
                  title="Remove this image?"
                  description="It is deleted from Cloudinary. If it is the cover image, the product cannot be submitted until another image is the cover."
                  confirmLabel="Remove image"
                  tone="destructive"
                  disabled={readOnlyReason !== undefined}
                  disabledReason={readOnlyReason}
                  trigger={<span>Remove</span>}
                  triggerClassName="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
                  onConfirm={async () => {
                    const result = await removeImageAction({ imageId: image.id })

                    if (!result.ok) {
                      setError({ message: result.error, reference: null })

                      return false
                    }

                    router.refresh()

                    return true
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
