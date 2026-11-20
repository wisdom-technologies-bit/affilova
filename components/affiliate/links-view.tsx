"use client"

import Link from "next/link"
import { useState } from "react"

import { CopyButton } from "@/components/affiliate/copy-button"
import { DataTable, type Column } from "@/components/affiliate/data-table"
import { LinkActions } from "@/components/affiliate/link-actions"
import { SkeletonRows } from "@/components/affiliate/skeletons"
import { ErrorNotice, StatusPill } from "@/components/affiliate/status-pill"
import { shortLinkUrl } from "@/lib/affiliate/links"
import { getLinkStatsAction } from "@/lib/affiliate/read-actions"
import { LINK_STATUS_WORDS, type LinkStat, type Page } from "@/lib/affiliate/read-types"
import { formatCount } from "@/lib/affiliate/definitions"
import { formatNaira } from "@/lib/catalog/money"

// The affiliate's own links, one page at a time.
//
// The table holds the link, its short URL with a copy button, the four numbers
// and the status. On a phone the same rows become cards. Every row also carries
// its own QR, share and parameter actions, because that is where an affiliate
// looks when they want to promote one particular link.

function shortUrlFor(link: LinkStat): string {
  return shortLinkUrl(link.alias ?? link.code)
}

export function LinksView({
  initialPage,
  initialError,
  from,
  to,
  loading: initialLoading = false,
}: {
  initialPage: Page<LinkStat>
  initialError: string | null
  from: string
  to: string
  /** True while the first page is still on its way. */
  loading?: boolean
}) {
  const [items, setItems] = useState<LinkStat[]>([...initialPage.items])
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) {
      return
    }

    setLoading(true)
    setError(null)

    const result = await getLinkStatsAction({ from, to, limit: 20, cursor })

    if (result.ok) {
      setItems((current) => [...current, ...result.data.items])
      setCursor(result.data.nextCursor)
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  if (initialLoading) {
    return <SkeletonRows rows={4} label="Loading your links" />
  }

  if (error !== null) {
    return <ErrorNotice message={error} />
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-ink">You have no links yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Find a product in the marketplace, choose Get link, and the link you create appears here
          with its clicks, orders and commission.
        </p>
        <p className="mt-3">
          <Link
            href="/marketplace"
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Go to the marketplace
          </Link>
        </p>
      </div>
    )
  }

  const columns: readonly Column<LinkStat>[] = [
    {
      key: "label",
      header: "Link",
      render: (link) => (
        <span className="text-brand-ink">
          {link.label ?? "No name"}
          <span className="block text-xs font-normal text-muted-foreground">
            {link.productTitle}
          </span>
        </span>
      ),
    },
    {
      key: "url",
      header: "Short link",
      render: (link) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="break-all text-xs text-muted-foreground">{shortUrlFor(link)}</span>
          <CopyButton value={shortUrlFor(link)} label="Copy" />
        </span>
      ),
    },
    { key: "clicks", header: "Clicks", align: "end", render: (link) => formatCount(link.clicks) },
    {
      key: "unique",
      header: "Unique clicks",
      align: "end",
      render: (link) => formatCount(link.uniqueClicks),
    },
    { key: "orders", header: "Orders", align: "end", render: (link) => formatCount(link.orders) },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      render: (link) => formatNaira(link.commissionKobo),
    },
    {
      key: "status",
      header: "Status",
      render: (link) => (
        <StatusPill status={link.status} label={LINK_STATUS_WORDS[link.status]} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      card: false,
      render: (link) => <LinkActions link={link} url={shortUrlFor(link)} />,
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every link you have made, with its numbers for the selected days. Use Parameters on a row
        to tag a campaign with s1, s2 and s3.
      </p>

      <DataTable
        caption="Your affiliate links, busiest first"
        columns={columns}
        rows={items}
        rowKey={(link) => link.linkId}
        emptyMessage="No links yet."
      />

      {loading ? <SkeletonRows rows={2} label="Loading more links" /> : null}

      {cursor !== null && !loading ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              void loadMore()
            }}
            className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Load more links
          </button>
        </div>
      ) : null}
    </div>
  )
}
