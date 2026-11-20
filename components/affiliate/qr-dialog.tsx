"use client"

import { QrCode } from "lucide-react"
import { useState } from "react"

import { CopyButton } from "@/components/affiliate/copy-button"
import { ShareLinks } from "@/components/affiliate/share-links"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { getLinkQrAction } from "@/lib/affiliate/read-actions"
import { isSafeQrSvg } from "@/lib/affiliate/qr"

// The QR code for one link, made on the server for that link only.
//
// There is no public QR endpoint: the server action checks that the signed-in
// affiliate owns the link and returns the SVG as a string. This dialog renders
// that string inline, and offers it as an SVG file or as a PNG drawn from the
// same SVG on a canvas.

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function QrDialog({
  linkId,
  url,
  title,
  triggerLabel = "QR code",
}: {
  linkId: string
  url: string
  title: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string>("")

  async function load(): Promise<void> {
    if (state === "loading" || state === "ready") {
      return
    }

    setState("loading")
    setError("")

    const result = await getLinkQrAction({ linkId })

    if (result.ok && isSafeQrSvg(result.data.svg)) {
      setSvg(result.data.svg)
      setState("ready")
      return
    }

    setError(result.ok ? "The QR code could not be drawn." : result.error)
    setState("error")
  }

  function downloadSvg(): void {
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "affiliate-link.svg")
  }

  function downloadPng(): void {
    const image = new Image()

    image.onload = () => {
      const canvas = document.createElement("canvas")

      canvas.width = 1024
      canvas.height = 1024

      const context = canvas.getContext("2d")

      if (context === null) {
        setError("This browser could not draw the PNG.")
        return
      }

      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)

      canvas.toBlob((blob) => {
        if (blob !== null) {
          downloadBlob(blob, "affiliate-link.png")
        }
      }, "image/png")
    }

    image.onerror = () => setError("This browser could not draw the PNG.")
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (next) {
          void load()
        }
      }}
    >
      <DialogTrigger className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
        <QrCode aria-hidden="true" className="h-4 w-4" />
        {triggerLabel}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription>
            Scan this to open the link. It points at {url}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[256px] items-center justify-center rounded-md border border-border bg-white p-4">
          {state === "loading" || state === "idle" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Drawing the QR code…
            </p>
          ) : null}

          {state === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {state === "ready" ? (
            <div
              className="h-64 w-64 [&>svg]:h-full [&>svg]:w-full"
              // The string was produced by the QR library and checked by
              // isSafeQrSvg: no script, no foreignObject, no event attribute.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={url} label="Copy link" />
          <button
            type="button"
            onClick={downloadSvg}
            disabled={state !== "ready"}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Download SVG
          </button>
          <button
            type="button"
            onClick={downloadPng}
            disabled={state !== "ready"}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Download PNG
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Share
          </p>
          <ShareLinks url={url} title={title} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
