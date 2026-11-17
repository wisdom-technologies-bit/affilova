"use client"

import { formatBytes } from "@/lib/catalog/format"

// One file in the upload queue: its name, its size, a progress bar while bytes
// are moving, and either Cancel or Dismiss.
//
// The bar is a progressbar with a live aria-valuenow, so a screen reader hears
// the number, and the percentage is also in the text beside it.

export type LocalUpload = {
  id: string
  name: string
  size: number
  status: "queued" | "uploading" | "uploaded" | "failed" | "cancelled"
  loaded: number
  total: number
  message: string | null
}

export function UploadRow({
  upload,
  onCancel,
  onDismiss,
}: {
  upload: LocalUpload
  onCancel: () => void
  onDismiss: () => void
}) {
  const percent = upload.total <= 0 ? 0 : Math.min(Math.round((upload.loaded / upload.total) * 100), 100)
  const moving = upload.status === "uploading" || upload.status === "queued"

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-brand-ink">{upload.name}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{formatBytes(upload.size)}</p>
      </div>

      {moving ? (
        <>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% of ${formatBytes(upload.size)} uploaded`}
            aria-label={`Upload progress for ${upload.name}`}
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {upload.status === "queued" ? "Waiting to start" : `${percent}% uploaded`}
            </p>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-destructive">{upload.message ?? "The upload failed."}</p>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  )
}
