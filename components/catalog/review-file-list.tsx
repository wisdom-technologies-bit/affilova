"use client"

import { useState } from "react"

import { getReviewFileDownloadUrlAction } from "@/lib/catalog/actions/admin"
import type { ProductFile } from "@/lib/catalog/action-types"
import { fileStatusLabel, formatBytes, scanStatusLabel } from "@/lib/catalog/format"

// The files in a review, each downloadable for inspection.
//
// The download link is asked for one file at a time, and it expires in minutes.
// Reviewers are told that the access is recorded, because it is.

export function ReviewFileList({ files }: { files: readonly ProductFile[] }) {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  async function open(fileId: string): Promise<void> {
    setOpening(fileId)
    setError(null)

    const result = await getReviewFileDownloadUrlAction({ fileId })

    setOpening(null)

    if (!result.ok) {
      setError(result.error)

      return
    }

    window.open(result.url, "_blank", "noopener,noreferrer")
  }

  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">This product has no files.</p>
  }

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-sm text-muted-foreground">This access is logged.</p>

      <ul className="divide-y divide-border border-t border-border">
        {files.map((file) => (
          <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-brand-ink">{file.originalName}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{formatBytes(file.sizeBytes)}</span>
                <span>{fileStatusLabel(file.status)}</span>
                <span>{scanStatusLabel(file.scanStatus)}</span>
              </p>
            </div>

            <button
              type="button"
              disabled={file.status !== "uploaded" || opening === file.id}
              onClick={() => {
                void open(file.id)
              }}
              className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {opening === file.id ? "Opening…" : "Download for inspection"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
