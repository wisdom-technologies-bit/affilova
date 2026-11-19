import Link from "next/link"

import { formatBytes, formatLagosDateTime } from "@/lib/catalog/format"
import type { AccessGrant } from "@/lib/commerce/access"

import { DownloadButton } from "./download-button"
import { RefundForm } from "./refund-form"

// The page behind a download link.
//
// It shows what the buyer paid for and nothing else: the product title, each
// file's name and size, and how many downloads are left. An invalid link is not
// explained: it says the link does not work and offers a new one, which is the
// same answer for a token that was tampered with and one that has expired.

export interface AccessViewProps {
  grant: AccessGrant
  token: string
  /** The instant the refund window is measured against. */
  now: Date
}

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

const SECONDARY =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

function Neutral(props: { heading: string; body: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{props.heading}</h1>
      <p className="mt-3 text-base text-foreground">{props.body}</p>
      <p className="mt-6">
        <Link href="/access/resend" className={`${SECONDARY} ${FOCUS}`}>
          Send me a new link
        </Link>
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Still stuck?{" "}
        <Link href="/contact" className={`underline underline-offset-2 ${FOCUS}`}>
          Contact us
        </Link>
        .
      </p>
    </main>
  )
}

export function AccessView({ grant, token, now }: AccessViewProps) {
  if (grant.kind === "invalid") {
    return (
      <Neutral
        heading="This link does not work"
        body="It may have expired, or it may have been copied incompletely. Enter your email and we will send a fresh link."
      />
    )
  }

  if (grant.kind === "not_paid") {
    return (
      <Neutral
        heading="This purchase is not active"
        body="The order behind this link is not active, so the files are not available. If you think that is wrong, contact us and quote your order number."
      />
    )
  }

  const order = grant.order
  const files = order.items.flatMap((item) => item.files.map((file) => ({ item, file })))

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <p className="text-sm text-muted-foreground">Order {order.number}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Your downloads</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Paid {formatLagosDateTime(order.paidAt)} (West Africa Time).
      </p>

      {files.length === 0 ? (
        <p className="mt-6 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
          There is nothing to download on this order yet. If a file is being checked, it appears here
          when the check finishes. Contact us if it does not.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {files.map(({ item, file }) => {
            const remaining = Math.max(file.maxDownloads - file.downloadsUsed, 0)

            return (
              <li key={file.entitlementId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">
                    {file.displayName} · {formatBytes(file.sizeBytes)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {remaining === 0
                      ? "No downloads left for this file"
                      : `${remaining} of ${file.maxDownloads} downloads left`}
                  </p>
                </div>
                <DownloadButton token={token} entitlementId={file.entitlementId} displayName={file.displayName} />
              </li>
            )
          })}
        </ul>
      )}

      <section aria-labelledby="refund-heading" className="mt-10 rounded-lg border border-border p-5">
        <h2 id="refund-heading" className="text-lg font-semibold text-foreground">
          Refunds
        </h2>

        {order.refundStatus !== null ? (
          <p className="mt-2 text-sm text-foreground">
            A refund request already exists on this order, so a second one cannot be opened.
          </p>
        ) : order.refundOpen ? (
          <>
            <p className="mt-2 text-sm text-foreground">
              Refund requests are accepted until{" "}
              {order.refundWindowEndsAt === null ? "the window closes" : formatLagosDateTime(order.refundWindowEndsAt)}{" "}
              (West Africa Time).
            </p>
            <div className="mt-4">
              <RefundForm token={token} />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-foreground">
            The refund window for this order has passed
            {order.refundWindowEndsAt === null
              ? "."
              : ` (it closed on ${formatLagosDateTime(order.refundWindowEndsAt)}, West Africa Time).`}{" "}
            If something is wrong with the files, contact us through our contact page and we will look
            into it.
          </p>
        )}
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        This page was opened on {formatLagosDateTime(now.toISOString())}. The link is personal to your
        order; anyone who opens it can download the files.
      </p>
    </main>
  )
}
