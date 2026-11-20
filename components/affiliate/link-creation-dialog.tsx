"use client"

import { useState } from "react"

import { CopyButton } from "@/components/affiliate/copy-button"
import { QrDialog } from "@/components/affiliate/qr-dialog"
import { ShareLinks } from "@/components/affiliate/share-links"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createLinkAction } from "@/lib/affiliate/actions"
import { shortLinkUrl } from "@/lib/affiliate/links"
import type { MarketplaceItem } from "@/lib/affiliate/read-types"

// Create a tracked link for one product, then show it.
//
// The alias is validated as it is typed, with the same rule the database
// enforces, so a typo is caught before the request. The label is the affiliate's
// own name for the link. After the link exists, the dialog stays open and shows
// the short link with copy, QR and share, because that is the moment the
// affiliate wants it.

const ALIAS = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/

const ALIAS_HINT = "4 to 40 lowercase letters, numbers or hyphens, starting and ending with a letter or number."

type Created = { linkId: string; code: string; alias: string | null }

export function LinkCreationDialog({
  item,
  onClose,
}: {
  item: MarketplaceItem | null
  onClose: () => void
}) {
  const [label, setLabel] = useState("")
  const [alias, setAlias] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)

  const aliasProblem = alias.trim() !== "" && !ALIAS.test(alias.trim())
  const url = created === null ? "" : shortLinkUrl(created.alias ?? created.code)

  function close(): void {
    if (working) {
      return
    }

    setLabel("")
    setAlias("")
    setError(null)
    setCreated(null)
    onClose()
  }

  async function submit(): Promise<void> {
    if (item === null || working || aliasProblem) {
      return
    }

    setWorking(true)
    setError(null)

    const result = await createLinkAction({
      productId: item.productId,
      label: label.trim() === "" ? undefined : label.trim(),
      alias: alias.trim() === "" ? undefined : alias.trim(),
    })

    if (result.ok) {
      setCreated({ linkId: result.linkId, code: result.code, alias: result.alias })
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  return (
    <Dialog open={item !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get a link</DialogTitle>
          <DialogDescription>
            {item === null
              ? ""
              : `Create a tracked link for ${item.title}. Every click it records is counted for you.`}
          </DialogDescription>
        </DialogHeader>

        {created === null ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="link-label" className="block text-sm font-medium text-brand-ink">
                Name this link <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                For you only, to tell two links for the same product apart.
              </p>
              <input
                id="link-label"
                value={label}
                onChange={(event) => setLabel(event.target.value.slice(0, 60))}
                maxLength={60}
                className="mt-2 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              />
            </div>

            <div>
              <label htmlFor="link-alias" className="block text-sm font-medium text-brand-ink">
                Custom short name <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/r/</span>
                <input
                  id="link-alias"
                  value={alias}
                  onChange={(event) => setAlias(event.target.value.toLowerCase().slice(0, 40))}
                  maxLength={40}
                  aria-describedby="link-alias-hint"
                  aria-invalid={aliasProblem}
                  className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                />
              </div>
              <p id="link-alias-hint" className="mt-1 text-xs text-muted-foreground">
                {ALIAS_HINT}
              </p>
              {aliasProblem ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  That short name is not allowed yet. {ALIAS_HINT}
                </p>
              ) : null}
            </div>

            {error === null ? null : (
              <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={working}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void submit()
                }}
                disabled={working || aliasProblem}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {working ? "Creating…" : "Create link"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p role="status" className="text-sm text-brand-ink">
              Your link is ready. It works straight away.
            </p>

            <p className="break-all rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
              {url}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <CopyButton value={url} label="Copy link" />
              <QrDialog linkId={created.linkId} url={url} title={item?.title ?? "Affiliate link"} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Share
              </p>
              <ShareLinks url={url} title={item?.title ?? "Affiliate link"} />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
