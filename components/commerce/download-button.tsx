"use client"

import { useState } from "react"

import { downloadFileAction } from "@/app/access/[token]/actions"

// One download button.
//
// The URL it receives is short lived and is never put in the page: it goes
// straight to window.location.assign, so it is not in the DOM, not in the
// history entry of this page, and not in a copy of the page.

export interface DownloadButtonProps {
  token: string
  entitlementId: string
  displayName: string
}

export function DownloadButton({ token, entitlementId, displayName }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  async function handleClick(): Promise<void> {
    if (busy) {
      return
    }

    setBusy(true)
    setMessage("")

    try {
      const result = await downloadFileAction({ token, entitlementId })

      if (result.ok && typeof result.url === "string") {
        window.location.assign(result.url)
        return
      }

      setMessage(result.error ?? "We could not prepare the download. Please try again in a moment.")
    } catch {
      setMessage("We could not prepare the download. Please try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`Download ${displayName}`}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Preparing…" : "Download"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-destructive">
        {message}
      </p>
    </div>
  )
}
