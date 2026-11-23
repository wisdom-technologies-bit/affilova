import Link from "next/link"

import { PrintButton } from "@/components/account/print-button"
import { orderStatusLabel, taxBasisLabel, type OrderDetail } from "@/lib/account/types"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { LEGAL } from "@/lib/site-config"

import styles from "./receipt.module.css"

// A receipt a buyer can print or keep.
//
// It says who sold, what was bought, when, how it was paid, what tax was in the
// price and that Affilova is the platform. The legal identity line is printed
// only when lib/site-config.ts actually holds one: an empty field is not
// something to invent words around.

export function Receipt({ detail }: { detail: OrderDetail }) {
  const vendors = [...new Set(detail.items.map((item) => item.vendorName).filter((name) => name !== ""))]

  return (
    <div className={`${styles.sheet} rounded-md border border-border px-6 py-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-ink">Receipt</h2>
          <p className="mt-1 text-sm text-muted-foreground">Order {detail.number}</p>
        </div>
        <div className={styles.noPrint}>
          <PrintButton />
        </div>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Date</dt>
          <dd className="mt-1 text-sm text-brand-ink">
            {formatLagosDateTime(detail.paidAt ?? detail.createdAt)} (Lagos time)
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
          <dd className="mt-1 text-sm text-brand-ink">{orderStatusLabel(detail.status)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Seller</dt>
          <dd className="mt-1 text-sm text-brand-ink">
            {vendors.length === 0 ? "Not recorded" : vendors.join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Payment channel</dt>
          <dd className="mt-1 text-sm capitalize text-brand-ink">{detail.channel ?? "Not recorded"}</dd>
        </div>
      </dl>

      <table className="mt-6 w-full border-collapse text-sm">
        <caption className="sr-only">What this receipt covers</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              Item
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((item) => (
            <tr key={item.orderItemId} className="border-b border-border">
              <th scope="row" className="py-3 pr-4 text-left font-medium text-brand-ink">
                {item.title}
                <span className="block text-xs font-normal text-muted-foreground">
                  {item.vendorName}
                </span>
              </th>
              <td className="py-3 pr-0 text-right tabular-nums text-brand-ink">
                {formatNaira(item.unitPriceKobo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 space-y-1 text-sm">
        {detail.taxLines.map((line) => (
          <div key={`${line.basis}-${line.rateBps}`} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {taxBasisLabel(line.basis)} ({(line.rateBps / 100).toFixed(2)}%,
              {line.included ? " included in the price" : " added to the price"})
            </dt>
            <dd className="tabular-nums text-brand-ink">{formatNaira(line.taxKobo)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <dt className="font-medium text-brand-ink">Total paid</dt>
          <dd className="font-semibold tabular-nums text-brand-ink">
            {formatNaira(detail.totalKobo)}
          </dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>Platform: Affilova</p>
        {LEGAL.entityName === "" ? null : (
          <p className="mt-1">
            {LEGAL.entityName}
            {LEGAL.registrationNumber === "" ? "" : ` · Registration ${LEGAL.registrationNumber}`}
            {LEGAL.registeredAddress === "" ? "" : ` · ${LEGAL.registeredAddress}`}
          </p>
        )}
        <p className="mt-2">
          This receipt records a payment made through Affilova. Keep it for your records.
        </p>
      </div>

      <p className={`${styles.noPrint} mt-6 text-sm`}>
        <Link
          href="/receipts"
          className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Back to receipts
        </Link>
      </p>
    </div>
  )
}
