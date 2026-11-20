"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import {
  abortFileUploadAction,
  deleteFileAction,
  getFileScanStatusesAction,
} from "@/lib/catalog/actions/vendor"
import type { FileScanStatus, ProductFile } from "@/lib/catalog/action-types"
import { fileStatusLabel, formatBytes, isScanPending } from "@/lib/catalog/format"
import { takeChosenFiles } from "@/lib/catalog/file-input"
import {
  ALLOWED_FILE_TYPES,
  MAX_FILES_PER_PRODUCT,
  PROVIDER_SCAN_LIMIT_BYTES,
} from "@/lib/catalog/files"
import { ScanStatusLine, UploadRow, type LocalUpload } from "@/components/catalog/upload-row"
import { uploadFile } from "@/lib/catalog/upload-client"
import { createUploadTransport } from "@/components/catalog/upload-transport"

// The product's files: what is already attached, and what is being uploaded now.
//
// One upload at a time. A big file already saturates a vendor's connection, and
// running three at once only makes each of them look slower. The parts inside a
// multipart upload do run three at a time; that is where the throughput comes
// from.

const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_FILE_TYPES).join(", ")

/** The provider's per-file ceiling, written out for the drop zone. */
const MAX_FILE_MB = PROVIDER_SCAN_LIMIT_BYTES / (1024 * 1024)

/** While a scan is running the screen asks the server this often. */
const SCAN_POLL_MS = 5000

export function FileManager({
  productId,
  files,
  readOnlyReason,
}: {
  productId: string
  files: readonly ProductFile[]
  /** Set when the product cannot take new files (archived, or being reviewed). */
  readOnlyReason?: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const controllers = useRef(new Map<string, AbortController>())

  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Scan states the server has sent since the page was rendered. They win over
  // the rows that came with the page, so a scan that finishes is shown without
  // a full reload.
  const [liveScan, setLiveScan] = useState<Record<string, FileScanStatus>>({})

  const shown = files.map((file) => {
    const live = liveScan[file.id]

    if (live === undefined) {
      return file
    }

    return {
      ...file,
      scanStatus: live.scanStatus,
      scanDetail: live.scanDetail,
      scannedAt: live.scannedAt,
    }
  })

  const scanPending = shown.some((file) => isScanPending(file.scanStatus))

  // Poll only while an answer is still owed, and stop on unmount. When the last
  // file settles, the page is refreshed once so the readiness list and the
  // submit button agree with the scan states.
  useEffect(() => {
    if (!scanPending) {
      return
    }

    let cancelled = false

    const timer = setInterval(() => {
      void (async () => {
        const result = await getFileScanStatusesAction({ productId })

        if (cancelled || !result.ok) {
          return
        }

        setLiveScan((current) => {
          const next: Record<string, FileScanStatus> = { ...current }

          for (const file of result.files) {
            next[file.id] = file
          }

          return next
        })

        if (!result.files.some((file) => isScanPending(file.scanStatus))) {
          router.refresh()
        }
      })()
    }, SCAN_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [scanPending, productId, router])

  const atLimit = files.length >= MAX_FILES_PER_PRODUCT
  const disabled = readOnlyReason !== undefined || atLimit

  function patch(id: string, next: Partial<LocalUpload>): void {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }

  async function runOne(id: string, file: File): Promise<void> {
    const controller = new AbortController()

    controllers.current.set(id, controller)
    patch(id, { status: "uploading" })

    const outcome = await uploadFile({
      productId,
      source: {
        name: file.name,
        size: file.size,
        slice: (start, end) => file.slice(start, end),
      },
      transport: createUploadTransport(),
      signal: controller.signal,
      onProgress: (progress) => patch(id, { status: "uploading", loaded: progress.loaded, total: progress.total }),
    })

    controllers.current.delete(id)

    if (outcome.ok) {
      // The list comes back from the server, so the finished upload is removed
      // here rather than shown twice.
      setUploads((current) => current.filter((item) => item.id !== id))
      setNotice(`${file.name} was uploaded.`)

      return
    }

    if (outcome.reason === "cancelled") {
      setUploads((current) => current.filter((item) => item.id !== id))
      setNotice(`${file.name} was cancelled. Nothing was kept.`)

      return
    }

    patch(id, { status: "failed", message: outcome.message })
  }

  async function accept(list: readonly File[]): Promise<void> {
    if (list.length === 0) {
      return
    }

    setError(null)
    setNotice(null)

    const chosen = [...list]
    const room = MAX_FILES_PER_PRODUCT - files.length

    if (chosen.length > room) {
      setError(
        room <= 0
          ? `A product can have at most ${MAX_FILES_PER_PRODUCT} files.`
          : `You can add ${room} more file${room === 1 ? "" : "s"} to this product.`,
      )

      return
    }

    const batch: LocalUpload[] = chosen.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: file.size,
      status: "queued",
      loaded: 0,
      total: file.size,
      message: null,
    }))

    setUploads((current) => [...current, ...batch])

    for (let index = 0; index < chosen.length; index += 1) {
      const entry = batch[index]
      const file = chosen[index]

      if (entry !== undefined && file !== undefined) {
        await runOne(entry.id, file)
      }
    }

    router.refresh()
  }

  return (
    <div className="space-y-5">
      {error === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice ?? ""}
      </p>

      {readOnlyReason === undefined ? null : (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">{readOnlyReason}</p>
      )}

      <div
        onDragOver={(event) => {
          if (!disabled) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          if (disabled) {
            return
          }

          event.preventDefault()
          // A drop has no input to reset, but the same copy keeps the two paths
          // identical.
          void accept(Array.from(event.dataTransfer.files))
        }}
        className="rounded-md border border-dashed border-border px-4 py-6"
      >
        <div className="flex flex-col items-start gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Choose files
          </button>

          <p className="text-xs leading-5 text-muted-foreground">
            Or drop files here. Files can be up to {MAX_FILE_MB} MB. Up to {MAX_FILES_PER_PRODUCT} files
            per product. Allowed: {ALLOWED_EXTENSIONS}.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Files to upload"
          onChange={(event) => {
            // The files are copied out before the input is cleared: the FileList
            // is live, and clearing it first empties the list being uploaded.
            void accept(takeChosenFiles(event.target))
          }}
        />
      </div>

      {uploads.length === 0 ? null : (
        <ul className="space-y-3">
          {uploads.map((upload) => (
            <UploadRow
              key={upload.id}
              upload={upload}
              onCancel={() => controllers.current.get(upload.id)?.abort()}
              onDismiss={() => setUploads((current) => current.filter((item) => item.id !== upload.id))}
            />
          ))}
        </ul>
      )}

      <div>
        <h3 className="text-sm font-medium text-brand-ink">Attached files</h3>

        {files.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No files yet. A product needs at least one.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border border-t border-border">
            {shown.map((file) => {
              const pending = file.status === "pending"

              return (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-brand-ink">{file.originalName}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatBytes(file.sizeBytes)}</span>
                      <span>{fileStatusLabel(file.status)}</span>
                      <ScanStatusLine status={file.scanStatus} detail={file.scanDetail} />
                    </p>
                  </div>

                  {pending ? (
                    <ConfirmDialog
                      title="Remove this unfinished upload?"
                      description="The upload never finished. Removing it clears the space reserved for it, and the daily cleanup job would remove it anyway."
                      confirmLabel="Remove"
                      tone="destructive"
                      trigger={<span>Remove</span>}
                      triggerClassName="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      onConfirm={async () => {
                        const result = await abortFileUploadAction({ fileId: file.id })

                        if (!result.ok) {
                          setError(result.error)

                          return false
                        }

                        router.refresh()

                        return true
                      }}
                    />
                  ) : (
                    <ConfirmDialog
                      title="Remove this file?"
                      description="The file is deleted from storage. A product that is live must keep at least one file."
                      confirmLabel="Remove file"
                      tone="destructive"
                      trigger={<span>Remove</span>}
                      triggerClassName="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      onConfirm={async () => {
                        const result = await deleteFileAction({ fileId: file.id })

                        if (!result.ok) {
                          setError(result.error)

                          return false
                        }

                        router.refresh()

                        return true
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
