import Link from "next/link"

import { StatusPill } from "@/components/affiliate/status-pill"
import { formatBpsPercent } from "@/lib/affiliate/definitions"
import { ACCESS_WORDS, APPROVAL_WORDS, accessExplanation, type MarketplaceItem } from "@/lib/affiliate/read-types"
import { formatNaira } from "@/lib/catalog/money"

// One product in the marketplace: what it is, who sells it, what it pays, and
// what this affiliate may do about it.
//
// The action depends on two stored facts and nothing else: the product's
// approval mode and this affiliate's own access row. Blocked and declined show
// the reason and no button, because there is nothing the affiliate can press to
// change a vendor's decision.

export function MarketplaceCard({
  item,
  coverUrl,
  onGetLink,
  onRequestAccess,
}: {
  item: MarketplaceItem
  coverUrl: string | null
  onGetLink?: (item: MarketplaceItem) => void
  onRequestAccess?: (item: MarketplaceItem) => void
}) {
  const canPromote = item.affiliateApproval === "open" || item.myAccess === "approved"
  const explanation = accessExplanation(item.myAccess)

  return (
    <li className="flex flex-col rounded-md border border-border bg-background">
      <div className="flex gap-4 p-4">
        {coverUrl === null ? (
          <div
            aria-hidden="true"
            className="h-[72px] w-24 shrink-0 rounded border border-border bg-muted"
          />
        ) : (
          <img
            src={coverUrl}
            alt={`Cover of ${item.title}`}
            width={96}
            height={72}
            className="h-[72px] w-24 shrink-0 rounded border border-border object-cover"
          />
        )}

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-brand-ink">
            <Link
              href={`/p/${item.slug}`}
              // A 44px target even though the words are one line: the title is
              // the way to the product page, and a text-sized link is a miss.
              className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              {item.title}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.vendorName}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.shortDescription}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Price</dt>
          <dd className="tabular-nums text-brand-ink">{formatNaira(item.priceKobo)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Commission</dt>
          <dd className="tabular-nums text-brand-ink">{formatBpsPercent(item.commissionBps)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Access</dt>
          <dd className="mt-1">
            <StatusPill status={item.myAccess} label={ACCESS_WORDS[item.myAccess]} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Your links</dt>
          <dd className="tabular-nums text-brand-ink">{item.myLinkCount}</dd>
        </div>
      </dl>

      <div className="mt-auto space-y-3 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">{APPROVAL_WORDS[item.affiliateApproval]}</p>

        {explanation === null ? null : (
          <p className="text-sm text-brand-ink">{explanation}</p>
        )}

        {canPromote ? (
          <button
            type="button"
            onClick={() => onGetLink?.(item)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Get link
          </button>
        ) : null}

        {!canPromote && item.myAccess === "none" && item.affiliateApproval === "approval" ? (
          <button
            type="button"
            onClick={() => onRequestAccess?.(item)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Request access
          </button>
        ) : null}

        {item.myAccess === "pending" ? (
          <p className="text-sm text-muted-foreground">
            The vendor has your request. You can create a link once they approve it.
          </p>
        ) : null}

        {item.myAccess === "none" && item.affiliateApproval === "invite" ? (
          <p className="text-sm text-muted-foreground">
            This product is invite only. Ask the vendor for an invitation link.
          </p>
        ) : null}
      </div>
    </li>
  )
}
