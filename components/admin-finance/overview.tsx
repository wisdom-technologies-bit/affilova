import Link from "next/link"

import { formatLagosDate } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"
import { attentionItems, type AttentionItem, type DailyPoint, type Overview } from "@/lib/admin/screen-types"

import { EmptyBlock, Section, StatusTag } from "./ui"

// The overview: the numbers, the days, and what needs a person.
//
// Server rendered on purpose. Nothing here changes without a reload, so there is
// no client state to get wrong and the whole page works before JavaScript loads.

const KPI: readonly { key: keyof Overview; label: string; definition: string; money: boolean }[] = [
  {
    key: "gmvKobo",
    label: "Gross sales",
    definition: "Every paid order in the range, before refunds.",
    money: true,
  },
  { key: "orders", label: "Orders", definition: "Paid orders in the range.", money: false },
  {
    key: "platformRevenueKobo",
    label: "Platform revenue",
    definition: "Platform fees and withdrawal fees posted in the range, net of reversals.",
    money: true,
  },
  {
    key: "processorFeesKobo",
    label: "Processor fees",
    definition: "What Paystack kept on the payments in the range.",
    money: true,
  },
  {
    key: "netMarginKobo",
    label: "Net margin",
    definition: "Platform revenue minus processor fees. Before tax and operating costs.",
    money: true,
  },
  {
    key: "refundsKobo",
    label: "Refunds",
    definition: "Refunds that actually moved money in the range.",
    money: true,
  },
  {
    key: "vendorPayablesKobo",
    label: "Vendor payables",
    definition: "What the ledger owes vendors right now, all time.",
    money: true,
  },
  {
    key: "affiliatePayablesKobo",
    label: "Affiliate payables",
    definition: "What the ledger owes affiliates right now, all time.",
    money: true,
  },
]

function figure(overview: Overview, key: keyof Overview, money: boolean): string {
  const value = overview[key]

  if (money) {
    return formatNaira(value as bigint)
  }

  return new Intl.NumberFormat("en-NG").format(value as number)
}

/** The daily bars: one column per day, height by gross sales. */
export function DailyChart({ points }: { points: readonly DailyPoint[] }) {
  if (points.length === 0) {
    return <EmptyBlock title="No days in this range" hint="Choose a range that includes at least one day." />
  }

  const busiest = points.reduce((max, point) => (point.gmvKobo > max ? point.gmvKobo : max), BigInt(0))
  const total = points.reduce((sum, point) => sum + point.gmvKobo, BigInt(0))

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {`Gross sales per day from ${points[0]?.day ?? ""} to ${points[points.length - 1]?.day ?? ""}. Total ${formatNaira(total)}. Busiest day ${formatNaira(busiest)}.`}
      </figcaption>
      <div className="flex h-40 items-end gap-1 overflow-x-auto" aria-hidden="true">
        {points.map((point) => {
          const height = busiest === BigInt(0) ? 0 : Number((point.gmvKobo * BigInt(100)) / busiest)

          return (
            <div key={point.day} className="flex min-w-2 flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t bg-brand-600"
                style={{ height: `${Math.max(height, point.gmvKobo > BigInt(0) ? 2 : 0)}%` }}
              />
            </div>
          )
        })}
      </div>
    </figure>
  )
}

/** The same days as a table, so no number is only a picture. */
export function DailyTable({ points }: { points: readonly DailyPoint[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-dense">
        <caption className="sr-only">Gross sales, orders, refunds and platform revenue per Lagos day.</caption>
        <thead>
          <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-text-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Day
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Orders
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Gross sales
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Refunds
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Platform revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                {formatLagosDate(`${point.day}T12:00:00+01:00`)}
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{point.orders}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(point.gmvKobo)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(point.refundsKobo)}</td>
              <td className="py-2 text-right tabular-nums">{formatNaira(point.platformRevenueKobo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AttentionPanel({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-success/40 bg-success-subtle px-4 py-3">
        <p className="flex items-center gap-2 text-dense font-semibold text-foreground">
          <span aria-hidden="true">✓</span>
          Nothing needs attention
        </p>
        <p className="mt-1 text-dense text-text-muted">
          No withdrawal, refund, dispute, review or job is waiting on a person.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3"
        >
          <span className="text-dense text-foreground">
            <span aria-hidden="true" className="mr-2 font-semibold">
              !
            </span>
            {item.sentence}
          </span>
          <Link href={item.href} className="text-dense font-semibold text-brand-600 underline underline-offset-2">
            {item.linkLabel}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function OverviewPanel({
  overview,
  points,
  range,
}: {
  overview: Overview
  points: readonly DailyPoint[]
  range: { from: string; to: string }
}) {
  const items = attentionItems(overview)

  return (
    <div className="space-y-6">
      <Section
        title="Needs attention"
        description="Each line is a counter that is not zero, and where to go to clear it."
      >
        <AttentionPanel items={items} />
      </Section>

      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          Key figures
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {KPI.map((kpi) => (
            <div key={kpi.key} className="rounded-md border border-border bg-background px-4 py-3">
              <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                <span title={kpi.definition} className="cursor-help">
                  {kpi.label}
                </span>
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {figure(overview, kpi.key, kpi.money)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-caption text-text-muted">
          Hover a name for what it counts. Payables are current balances; the rest are the selected days.
        </p>
      </section>

      <Section
        title="Day by day"
        description={`Lagos days, ${formatLagosDate(`${range.from}T12:00:00+01:00`)} to ${formatLagosDate(`${range.to}T12:00:00+01:00`)}.`}
      >
        <div className="space-y-4">
          <DailyChart points={points} />
          <DailyTable points={points} />
        </div>
      </Section>

      <Section title="How these are calculated">
        <dl className="space-y-2 text-dense text-text-muted">
          <div>
            <dt className="inline font-medium text-foreground">Gross sales: </dt>
            <dd className="inline">paid orders in the range, whatever happened to them afterwards.</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Platform revenue: </dt>
            <dd className="inline">
              platform and withdrawal fee postings in the range, minus anything reversed. A refund reverses the fee it
              took.
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Processor fees: </dt>
            <dd className="inline">what Paystack kept, from the payment records themselves.</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Net margin: </dt>
            <dd className="inline">platform revenue minus processor fees, before VAT and operating costs.</dd>
          </div>
        </dl>
      </Section>
    </div>
  )
}

/** The header figure used by the transactions and VAT pages. */
export function InlineStat({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-dense text-text-muted">{label}</span>
      <StatusTag tone={tone ?? "neutral"}>{value}</StatusTag>
    </div>
  )
}
