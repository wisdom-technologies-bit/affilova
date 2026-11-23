"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { ErrorNotice, StatusPill, pillStatus } from "@/components/affiliate/status-pill"
import { downloadMyFileAction, requestMyRefundAction } from "@/lib/account/actions"
import {
  isDownloadable,
  orderStatusLabel,
  taxBasisLabel,
  type EntitlementRow,
  type OrderDetail,
} from "@/lib/account/types"
import { formatBytes, formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { MIN_REFUND_REASON, refundReasonError } from "@/lib/refunds/validation"

// One purchase: what it was, what came with it, and what can be done with it.
//
// A file that has not passed its security scan is not offered as a download at
// all: it says "Unavailable while we check it" and there is no button. The same
// is true of a file that was withdrawn with a refund, and of a file whose
// downloads are used up.

const REFUND_STATUS_WORDS: Readonly<Record<string, string>> = {
  requested: "Your refund request is with the vendor, waiting for a decision.",
  approved: "Your refund was approved and is on its way back to you.",
  processed: "This order was refunded.",
  rejected: "Your refund request was declined.",
  failed: "The refund could not be completed. Please contact support.",
}

function fileState(entitlement: EntitlementRow): { words: string; canDownload: boolean } {
  if (entitlement.revoked) {
    return { words: "Withdrawn from this order", canDownload: false }
  }

  if (!entitlement.scanClean) {
    return { words: "Unavailable while we check it", canDownload: false }
  }

  if (entitlement.downloadsUsed >= entitlement.maxDownloads) {
    return { words: "No downloads left", canDownload: false }
  }

  return {
    words: `${entitlement.downloadsUsed} of ${entitlement.maxDownloads} downloads used`,
    canDownload: true,
  }
}

export function PurchaseDetail({
  detail,
  now,
  initialError = null,
}: {
  detail: OrderDetail
  /** The server's clock, so the refund window is decided the same way twice. */
  now: string
  initialError?: string | null
}) {
  const router = useRouter()
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [fileMessage, setFileMessage] = useState<string | null>(initialError)
  const [reason, setReason] = useState("")
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundWorking, setRefundWorking] = useState(false)

  const windowEnd = detail.refundWindowEndsAt
  const windowOpen =
    detail.status === "paid" && windowEnd !== null && Date.parse(now) <= Date.parse(windowEnd)

  async function download(entitlement: EntitlementRow): Promise<void> {
    setBusyFile(entitlement.entitlementId)
    setFileMessage(null)

    const result = await downloadMyFileAction({
      orderId: detail.orderId,
      entitlementId: entitlement.entitlementId,
    })

    if (result.ok) {
      // A presigned URL is a credential: it goes straight to the browser and is
      // never kept in state, in the DOM or in a log.
      window.location.assign(result.url)
      setFileMessage("Your download has started.")
    } else {
      setFileMessage(result.error)
    }

    setBusyFile(null)
  }

  async function requestRefund(): Promise<void> {
    setRefundError(null)

    const problem = refundReasonError(reason)

    if (problem !== null) {
      setRefundError(problem)
      return
    }

    setRefundWorking(true)

    const result = await requestMyRefundAction({ orderId: detail.orderId, reason: reason.trim() })

    if (result.ok) {
      setReason("")
      router.refresh()
    } else {
      setRefundError(result.error)
    }

    setRefundWorking(false)
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="purchase-summary" className="rounded-md border border-border px-4 py-4">
        <h2 id="purchase-summary" className="text-sm font-semibold text-brand-ink">
          Order {detail.number}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
            <dd className="mt-1">
              <StatusPill status={pillStatus(detail.status)} label={orderStatusLabel(detail.status)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {detail.paidAt === null ? "Created" : "Paid"}
            </dt>
            <dd className="mt-1 text-sm text-brand-ink">
              {formatLagosDateTime(detail.paidAt ?? detail.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Product</dt>
            <dd className="mt-1 text-sm text-brand-ink">
              {detail.items.map((item) => item.title).join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total paid</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-brand-ink">
              {formatNaira(detail.totalKobo)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="purchase-files" className="space-y-3">
        <h2 id="purchase-files" className="text-sm font-semibold text-brand-ink">
          Files
        </h2>

        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {fileMessage ?? ""}
        </p>

        {detail.entitlements.length === 0 ? (
          <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
            This purchase has no files.
          </p>
        ) : (
          <ul className="space-y-3">
            {detail.entitlements.map((entitlement) => {
              const state = fileState(entitlement)

              return (
                <li
                  key={entitlement.entitlementId}
                  className="rounded-md border border-border px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-brand-ink">
                        {entitlement.fileDisplayName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(entitlement.sizeBytes)} · {state.words}
                      </p>
                    </div>

                    {state.canDownload && isDownloadable(detail.status) ? (
                      <button
                        type="button"
                        onClick={() => {
                          void download(entitlement)
                        }}
                        disabled={busyFile === entitlement.entitlementId}
                        className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                      >
                        {busyFile === entitlement.entitlementId ? "Preparing…" : "Download"}
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="purchase-refund" className="rounded-md border border-border px-4 py-4">
        <h2 id="purchase-refund" className="text-sm font-semibold text-brand-ink">
          Refunds
        </h2>

        {detail.taxLines.length === 0 ? null : (
          <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
            {detail.taxLines.map((line) => (
              <div key={`${line.basis}-${line.rateBps}`} className="flex justify-between gap-3">
                <dt>
                  {taxBasisLabel(line.basis)} ({(line.rateBps / 100).toFixed(2)}%)
                </dt>
                <dd className="tabular-nums">{formatNaira(line.taxKobo)}</dd>
              </div>
            ))}
          </dl>
        )}

        {detail.refundRequest !== null ? (
          <p className="mt-3 text-sm text-brand-ink">
            {REFUND_STATUS_WORDS[detail.refundRequest.status] ?? "This order has a refund request."}
          </p>
        ) : windowOpen ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              You can ask for a refund until {formatLagosDateTime(windowEnd)} (Lagos time).
            </p>

            <div>
              <label htmlFor="refund-reason" className="block text-sm font-medium text-brand-ink">
                Why are you asking for a refund?
              </label>
              <textarea
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value.slice(0, 1000))}
                maxLength={1000}
                rows={3}
                aria-describedby="refund-reason-help"
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              />
              <p id="refund-reason-help" className="mt-1 text-xs text-muted-foreground">
                At least {MIN_REFUND_REASON} characters. The vendor reads this before deciding.
              </p>
            </div>

            {refundError === null ? null : <ErrorNotice message={refundError} />}

            <button
              type="button"
              onClick={() => {
                void requestRefund()
              }}
              disabled={refundWorking}
              className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {refundWorking ? "Sending…" : "Request a refund"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {detail.status === "paid" && windowEnd !== null
              ? `The refund window closed on ${formatLagosDateTime(windowEnd)} (Lagos time).`
              : "A refund can be requested on a paid order, inside its refund window."}
          </p>
        )}
      </section>
    </div>
  )
}
