"use client"

import {
  Archive,
  LinkSimple,
  ShareNetwork,
} from "@/components/ds/icons"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { CopyButton } from "@/components/affiliate/copy-button"
import { QrDialog } from "@/components/affiliate/qr-dialog"
import { ShareLinks } from "@/components/affiliate/share-links"
import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { archiveLinkAction } from "@/lib/affiliate/actions"
import type { LinkStat } from "@/lib/affiliate/read-types"

// What an affiliate can do with one link: show its QR, share it, add campaign
// parameters, or archive it.
//
// Archiving asks first and says what it costs: the link stops recording clicks
// and cannot be brought back, though the clicks it already recorded stay in the
// reports. A link that is already archived offers nothing.

const BUTTON =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

export function LinkActions({ link, url }: { link: LinkStat; url: string }) {
  const router = useRouter()
  const [shareOpen, setShareOpen] = useState(false)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = link.label === null ? link.productTitle : `${link.label} · ${link.productTitle}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <QrDialog linkId={link.linkId} url={url} title={title} triggerLabel="QR" />

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogTrigger className={BUTTON}>
          <ShareNetwork aria-hidden="true" className="h-4 w-4" />
          Share
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this link</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          <p className="break-all rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
            {url}
          </p>
          <CopyButton value={url} label="Copy link" />
          <ShareLinks url={url} title={title} />
        </DialogContent>
      </Dialog>

      <Dialog open={parametersOpen} onOpenChange={setParametersOpen}>
        <DialogTrigger className={BUTTON}>
          <LinkSimple aria-hidden="true" className="h-4 w-4" />
          Parameters
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tag a campaign</DialogTitle>
            <DialogDescription>
              Add s1, s2 and s3 to the link and the click records them. Use them to tell your
              campaigns apart: the Analytics page breaks the numbers down by s1.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-3">
            {[
              { key: "s1", example: "instagram", meaning: "the channel, for example instagram" },
              { key: "s2", example: "story", meaning: "the placement, for example story" },
              { key: "s3", example: "launch-week", meaning: "the campaign, for example launch-week" },
            ].map((row) => {
              const exampleUrl = `${url}?${row.key}=${row.example}`

              return (
                <li key={row.key} className="rounded-md border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.key}: {row.meaning}
                  </p>
                  <p className="mt-1 break-all text-sm text-brand-ink">{exampleUrl}</p>
                  <div className="mt-2">
                    <CopyButton value={exampleUrl} label={`Copy ${row.key} example`} />
                  </div>
                </li>
              )
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            Values are up to 60 characters. Leave one out and that column reads Not set.
          </p>
        </DialogContent>
      </Dialog>

      {link.status === "active" ? (
        <ConfirmDialog
          trigger={
            <>
              <Archive aria-hidden="true" className="h-4 w-4" />
              Archive
            </>
          }
          triggerClassName={BUTTON}
          title="Archive this link?"
          description="It stops recording clicks straight away and cannot be brought back. The clicks and orders it already recorded stay in your reports."
          confirmLabel="Archive link"
          tone="destructive"
          onConfirm={async () => {
            const result = await archiveLinkAction({ linkId: link.linkId })

            if (result.ok) {
              router.refresh()
              return true
            }

            setError(result.error)
            return false
          }}
        />
      ) : null}

      {error === null ? null : (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
