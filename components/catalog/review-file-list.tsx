"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { getReviewFileDownloadUrlAction, reviewFileScanAction } from "@/lib/catalog/actions/admin"
import type { ProductFile } from "@/lib/catalog/action-types"
import { fileStatusLabel, formatBytes } from "@/lib/catalog/format"
import { ScanStatusLine } from "@/components/catalog/upload-row"

// The files in a review, each downloadable for inspection.
//
// The download link is asked for one file at a time, and it expires in minutes.
// Reviewers are told that the access is recorded, because it is.
//
// A file the scanner could not settle is decided here: one held for manual
// review, or one whose scan failed. A file found infected is never decidable:
// its own verdict stands, and the download button is not offered at all.

const MIN_REASON_LENGTH = 10

type Decision = "clean" | "reject"

/** A file nobody may download: the verdict is already decided against it. */
function isBlocked(file: ProductFile): boolean {
  return file.scanStatus === "infected" || file.scanStatus === "rejected"
}

/** A file a member of staff may decide by hand. */
function isDecidable(file: ProductFile): boolean {
  return file.scanStatus === "needs_review" || file.scanStatus === "error"
}

function blockedReason(file: ProductFile): string {
  return file.scanStatus === "infected"
    ? "Not available: this file was found to contain malware."
    : "Not available: this file type or its contents are not allowed."
}

export function ReviewFileList({ files }: { files: readonly ProductFile[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<{ fileId: string; decision: Decision } | null>(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

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

  function startDecision(fileId: string, decision: Decision): void {
    setError(null)
    setReason("")
    setDeciding({ fileId, decision })
  }

  function cancelDecision(): void {
    setDeciding(null)
    setReason("")
  }

  async function submitDecision(): Promise<void> {
    if (deciding === null || reason.trim().length < MIN_REASON_LENGTH) {
      return
    }

    setSaving(true)
    setError(null)

    const result = await reviewFileScanAction({
      fileId: deciding.fileId,
      decision: deciding.decision,
      reason: reason.trim(),
    })

    setSaving(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setDeciding(null)
    setReason("")
    router.refresh()
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
        {files.map((file) => {
          const blocked = isBlocked(file)
          const open_ = deciding !== null && deciding.fileId === file.id

          return (
            <li key={file.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-ink">{file.originalName}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatBytes(file.sizeBytes)}</span>
                    <span>{fileStatusLabel(file.status)}</span>
                    <ScanStatusLine status={file.scanStatus} detail={file.scanDetail} />
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {blocked ? (
                    <p className="text-xs leading-5 text-destructive">{blockedReason(file)}</p>
                  ) : (
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
                  )}

                  {isDecidable(file) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => startDecision(file.id, "clean")}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      >
                        Mark clean
                      </button>
                      <button
                        type="button"
                        onClick={() => startDecision(file.id, "reject")}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-destructive/40 px-4 text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {open_ ? (
                <div className="mt-3 rounded-md border border-border p-3">
                  <label
                    htmlFor={`scan-reason-${file.id}`}
                    className="block text-sm font-medium text-brand-ink"
                  >
                    {deciding.decision === "clean"
                      ? "Why is this file safe to release?"
                      : "Why is this file being rejected?"}
                  </label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    At least {MIN_REASON_LENGTH} characters. This reason is kept with the file and
                    shown to the vendor when the file is rejected.
                  </p>
                  <textarea
                    id={`scan-reason-${file.id}`}
                    value={reason}
                    rows={3}
                    onChange={(event) => setReason(event.target.value)}
                    aria-describedby={`scan-reason-help-${file.id}`}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  />
                  <span id={`scan-reason-help-${file.id}`} className="sr-only">
                    {reason.trim().length < MIN_REASON_LENGTH
                      ? `The reason needs ${MIN_REASON_LENGTH - reason.trim().length} more characters.`
                      : "The reason is long enough."}
                  </span>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || reason.trim().length < MIN_REASON_LENGTH}
                      onClick={() => {
                        void submitDecision()
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      {saving
                        ? "Saving…"
                        : deciding.decision === "clean"
                          ? "Confirm: mark this file clean"
                          : "Confirm: reject this file"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelDecision}
                      className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
